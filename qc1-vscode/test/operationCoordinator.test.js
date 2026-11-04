const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOutputFailureReason, executeSequentially, programmerOutputFailureReason, resolveBuildStatus } = require("../out/qc1/operationCoordinator");

test("a failed build stage prevents later flash stages from running", async () => {
  const started = [];
  await executeSequentially(["configure", "build", "flash"], async (stage) => {
    started.push(stage);
    return stage !== "build";
  });
  assert.deepEqual(started, ["configure", "build"]);
});

test("a later flash or debug failure cannot change a completed build result", () => {
  assert.equal(resolveBuildStatus({ requested: true, processSucceeded: true, commandFailed: true, failurePhase: "flashing" }), "success");
  assert.equal(resolveBuildStatus({ requested: true, processSucceeded: true, commandFailed: true }), "success");
});

test("a failed build is distinct from a build blocked before its process starts", () => {
  assert.equal(resolveBuildStatus({ requested: true, processSucceeded: false, commandFailed: true, failurePhase: "building" }), "failed");
  assert.equal(resolveBuildStatus({ requested: true, commandFailed: true }), "skipped");
  assert.equal(resolveBuildStatus({ requested: true, commandFailed: true, failurePhase: "cleaning" }), "skipped");
  assert.equal(resolveBuildStatus({ requested: false, commandFailed: false }), "not-run");
});

test("CMake and GCC errors in build output fail the stage even when the process can return zero", () => {
  assert.match(buildOutputFailureReason("", "main.c:14:2: error: expected ';' before '}' token"), /expected/);
  assert.match(buildOutputFailureReason("CMake Error at CMakeLists.txt:5 (add_executable):\n  No SOURCES given", ""), /signale une erreur/);
  assert.match(buildOutputFailureReason("", "ld: undefined reference to `Reset_Handler'"), /undefined reference/);
});

test("warnings alone do not fail a successful build stage", () => {
  assert.equal(buildOutputFailureReason("main.c:4:1: warning: unused variable 'x'", ""), undefined);
  assert.equal(buildOutputFailureReason("", "Error: ST-Link unavailable"), undefined, "hardware output is not build output");
});

test("explicit programmer errors are not hidden by a zero exit status", () => {
  assert.match(programmerOutputFailureReason("", "Error: init mode failed (unable to connect to ST-Link)"), /Error: init mode failed/);
  assert.match(programmerOutputFailureReason("st-flash: ERROR: verification failed", ""), /verification failed/);
  assert.equal(programmerOutputFailureReason("Info : STLINK V2J45\nTarget voltage: 3.3V", ""), undefined);
});
