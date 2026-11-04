const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatHardwareResourceConflicts,
  HardwareResourceCoordinator,
  probeOpenOcdEndpoints,
} = require("../out/qc1/hardwareResources");

test("known ST-Link sessions block only matching probes; unknown ownership blocks all", () => {
  const resources = new HardwareResourceCoordinator();
  const first = resources.acquire({ id: "debug-1", kind: "debug", owner: "Cortex-Debug", projectPath: "/f103", serialNumber: "AABBCCDDEEFF" });
  assert.equal(first.acquired, true);
  assert.equal(resources.acquire({ id: "flash-same", kind: "programming", owner: "Flash", projectPath: "/f103", serialNumber: "aabbccddeeff" }).acquired, false);
  assert.equal(resources.acquire({ id: "flash-other", kind: "programming", owner: "Flash", projectPath: "/h755", serialNumber: "001122334455" }).acquired, true);
  assert.equal(resources.acquire({ id: "flash-unknown", kind: "programming", owner: "Flash", projectPath: "/other" }).acquired, false);
  assert.match(formatHardwareResourceConflicts(resources.conflicts("AABBCCDDEEFF")), /ne l'arrêtera pas/);
  resources.release("debug-1");
  assert.equal(resources.conflicts("AABBCCDDEEFF").length, 0);
});

test("observed external debug sessions retain known versus unknown probe identity", () => {
  const resources = new HardwareResourceCoordinator();
  resources.observe({ id: "debug-external", kind: "debug", owner: "Session Debug externe", projectPath: "/project" });
  const conflicts = resources.conflicts("112233445566");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].certainty, "known", "the session is known even though its ST-Link is not identified");
});

test("OpenOCD port probing labels only standard ports that answer", async () => {
  const observed = [];
  const ports = await probeOpenOcdEndpoints(async (port, timeoutMs) => {
    observed.push({ port, timeoutMs });
    return port === 4444;
  }, 40);
  assert.deepEqual(ports, [4444]);
  assert.deepEqual(observed.map(({ port }) => port), [3333, 4444]);
  assert.ok(observed.every(({ timeoutMs }) => timeoutMs === 40));
});
