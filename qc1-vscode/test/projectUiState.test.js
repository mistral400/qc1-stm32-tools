const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const {
  buildDiscoveryRoots,
  mapProjectCandidate,
  rememberRecentProject,
} = require("../out/dashboard/projectUiState");

const candidate = {
  path: "/tmp/LabGPIO",
  name: "Lab GPIO",
  family: "STM32F1",
  mcu: "STM32F103xB",
  architecture: "single-core",
  cores: [{ id: "cortex-m3", name: "Cortex-M3", cpu: "cortex-m3", confidence: 100, startupFiles: [], linkerScripts: [], evidence: [] }],
  buildSystem: "make",
  confidence: 96,
  evidence: [],
  missingComponents: [],
  warnings: [],
};

test("maps confidence to a UI category without changing the candidate", () => {
  const mapped = mapProjectCandidate(candidate);
  assert.equal(mapped.confidenceLabel, "élevée");
  assert.equal(mapped.candidate, candidate);
});

test("builds bounded discovery roots in the requested priority order", () => {
  const workspace = path.resolve("workspace");
  const firmware = path.join(workspace, "firmware");
  const recent = path.resolve("recent", "one");
  assert.deepEqual(buildDiscoveryRoots(
    [workspace],
    firmware,
    [recent, workspace],
  ), [workspace, firmware, recent]);
});

test("keeps a small most-recent-first project history", () => {
  assert.deepEqual(
    rememberRecentProject([path.resolve("old"), path.resolve("older")], path.resolve("new"), 2),
    [path.resolve("new"), path.resolve("old")],
  );
});
