const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { inspectCmakePresets } = require("../out/qc1/cmakePresets");

test("selects a CubeMX build preset and resolves inherited binaryDir", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-presets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "CMakePresets.json"), JSON.stringify({
    version: 3,
    configurePresets: [
      { name: "base", hidden: true, generator: "Ninja", binaryDir: "${sourceDir}/build/${presetName}" },
      { name: "Debug", inherits: "base" }
    ],
    buildPresets: [{ name: "Debug", configurePreset: "Debug" }]
  }));
  const selected = inspectCmakePresets(root, "Debug");
  assert.equal(selected.configurePreset, "Debug");
  assert.equal(selected.buildPreset, "Debug");
  assert.equal(selected.binaryDir, path.join(root, "build", "Debug"));
});

test("does not invent a preset when no visible matching configure preset exists", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-presets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "CMakePresets.json"), JSON.stringify({ configurePresets: [{ name: "base", hidden: true }] }));
  assert.equal(inspectCmakePresets(root, "Debug"), undefined);
});
