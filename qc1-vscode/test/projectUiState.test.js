const assert = require("node:assert/strict");
const test = require("node:test");

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
  assert.deepEqual(buildDiscoveryRoots(
    ["/workspace"],
    "/workspace/firmware",
    ["/recent/one", "/workspace"],
  ), ["/workspace", "/workspace/firmware", "/recent/one"]);
});

test("keeps a small most-recent-first project history", () => {
  assert.deepEqual(
    rememberRecentProject(["/old", "/older"], "/new", 2),
    ["/new", "/old"],
  );
});
