const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { compareFirmwareReadback, snapshotFirmwareArtifact, validateFirmwareArtifact, validateStagedBinary } = require("../out/qc1/artifactValidation");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-artifact-evidence-"));
  const project = path.join(root, "project");
  const build = path.join(project, "build");
  const source = path.join(project, "Src", "main.c");
  const elf = path.join(build, "firmware.elf");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(source, "int main(void) { return 0; }\n");
  fs.writeFileSync(elf, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = {
    name: "firmware",
    configuration: "Debug",
    type: "EXECUTABLE",
    artifacts: [elf],
    sources: [source],
    includes: [], definitions: [], fragments: [],
  };
  return { root, project, build, source, elf, target };
}

test("proves an ELF belongs to the active executable target and captures its digest", t => {
  const item = fixture(t);
  const evidence = validateFirmwareArtifact({
    artifactPath: item.elf, projectRoot: item.project, buildRoot: item.build,
    sourceRoot: item.project, targets: [item.target],
  });
  assert.equal(evidence.valid, true, evidence.reason);
  assert.equal(evidence.targetName, "firmware");
  assert.equal(evidence.sha256, createHash("sha256").update(fs.readFileSync(item.elf)).digest("hex"));
});

test("rejects an existing ELF from another project and an unowned configured artifact", t => {
  const item = fixture(t);
  const other = path.join(item.root, "other");
  fs.mkdirSync(other);
  const foreignElf = path.join(other, "firmware.elf");
  fs.writeFileSync(foreignElf, "old firmware");
  const evidence = validateFirmwareArtifact({
    artifactPath: foreignElf, projectRoot: item.project, buildRoot: item.build,
    sourceRoot: item.project, targets: [item.target],
  });
  assert.equal(evidence.valid, false);
  assert.match(evidence.reason, /sort du projet|déclaré/);
});

test("rejects ambiguous targets, empty ELF files and mismatched wrapper sources", t => {
  const item = fixture(t);
  assert.match(validateFirmwareArtifact({
    artifactPath: item.elf, projectRoot: item.project, buildRoot: item.build,
    sourceRoot: item.project, targets: [item.target, { ...item.target, name: "duplicate" }],
  }).reason, /Plusieurs cibles/);
  fs.writeFileSync(item.elf, "");
  assert.match(validateFirmwareArtifact({
    artifactPath: item.elf, projectRoot: item.project, buildRoot: item.build,
    sourceRoot: item.project, targets: [item.target],
  }).reason, /vide/);
  fs.writeFileSync(item.elf, "ELF again");
  assert.match(validateFirmwareArtifact({
    artifactPath: item.elf, projectRoot: item.project, buildRoot: item.build,
    sourceRoot: path.join(item.root, "wrapper"), targets: [{ ...item.target, sources: [] }],
  }).reason, /source rattachée/);
});

test("attributes H7 artifacts to the requested core instead of accepting another core's ELF", t => {
  const item = fixture(t);
  const target = { ...item.target, name: "firmware_CM4", definitions: ["CORE_CM4"] };
  const evidence = validateFirmwareArtifact({
    artifactPath: item.elf, projectRoot: item.project, buildRoot: item.build,
    sourceRoot: item.project, targets: [target], core: "cm4",
  });
  assert.equal(evidence.valid, true, evidence.reason);
  assert.match(validateFirmwareArtifact({
    artifactPath: item.elf, projectRoot: item.project, buildRoot: item.build,
    sourceRoot: item.project, targets: [target], core: "cm7",
  }).reason, /cœur CM7/);
});

test("readback comparison requires exact bytes and length", () => {
  assert.equal(compareFirmwareReadback(Buffer.from([1, 2, 3]), Buffer.from([1, 2, 3])).matches, true);
  assert.equal(compareFirmwareReadback(Buffer.from([1, 2, 3]), Buffer.from([1, 2, 4])).matches, false);
  assert.match(compareFirmwareReadback(Buffer.from([1, 2, 3]), Buffer.from([1, 2])).reason, /Taille différente/);
  assert.equal(compareFirmwareReadback(Buffer.alloc(0), Buffer.alloc(0)).matches, false);
});

test("only a BIN created inside this operation's unique staging directory is eligible", t => {
  const item = fixture(t);
  const stage = path.join(item.root, "operation-unique");
  fs.mkdirSync(stage);
  const stagedBin = path.join(stage, "stm32.bin");
  const staleBin = path.join(item.build, "firmware.bin");
  fs.writeFileSync(stagedBin, Buffer.from([1, 2, 3]));
  fs.writeFileSync(staleBin, Buffer.from([9, 9, 9]));
  assert.equal(validateStagedBinary(stagedBin, stage).valid, true);
  assert.match(validateStagedBinary(staleBin, stage).reason, /sort du dossier isolé/);
});

test("ELF snapshots preserve the validated bytes and reject a changed source", async t => {
  const item = fixture(t);
  const stage = path.join(item.root, "operation-unique");
  fs.mkdirSync(stage);
  const evidence = validateFirmwareArtifact({
    artifactPath: item.elf, projectRoot: item.project, buildRoot: item.build,
    sourceRoot: item.project, targets: [item.target],
  });
  const snapshot = await snapshotFirmwareArtifact(evidence, stage, "firmware.elf");
  assert.equal(snapshot.valid, true, snapshot.reason);
  assert.deepEqual(fs.readFileSync(snapshot.artifactPath), fs.readFileSync(item.elf));

  fs.writeFileSync(item.elf, "changed after validation");
  const rejected = await snapshotFirmwareArtifact(evidence, stage, "changed.elf");
  assert.equal(rejected.valid, false);
  assert.match(rejected.reason, /a changé depuis sa validation/);
});
