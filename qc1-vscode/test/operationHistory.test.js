const test = require("node:test");
const assert = require("node:assert/strict");
const { createInitialOperationStates } = require("../out/dashboard/dashboardState");
const {
  isFlashFullyConfirmed,
  ProjectOperationHistory,
  projectOperationKey,
  setOperationResult,
} = require("../out/qc1/operationHistory");

function snapshot(operations = createInitialOperationStates()) {
  return {
    build: {
      lastBuildTime: "Jamais", lastBuildSuccess: false, buildRuntimeMs: 0,
      errors: 0, warnings: 0, elfGenerated: false, binGenerated: false,
    },
    flash: { lastFlashTime: "Jamais", lastFlashSuccess: false, flashRuntimeMs: 0, method: "--", targetMCU: "--" },
    operations,
  };
}

test("Build success stays successful when a later programming stage fails", () => {
  let operations = createInitialOperationStates();
  operations = setOperationResult(operations, "build", { status: "success", message: "CMake exited 0" });
  operations = setOperationResult(operations, "programming", { status: "failed", message: "ST-Link unavailable" });
  assert.equal(operations.build.status, "success");
  assert.equal(operations.programming.status, "failed");
});

test("a flash is confirmed only after artifact validation, programming, verification and reset", () => {
  let operations = createInitialOperationStates();
  for (const name of ["programming", "verification", "reset"])
    operations = setOperationResult(operations, name, { status: "success" });
  assert.equal(isFlashFullyConfirmed(operations), false, "unproven artifact provenance prevents a final success");
  operations = setOperationResult(operations, "artifactValidation", { status: "success" });
  assert.equal(isFlashFullyConfirmed(operations), true);
  operations = setOperationResult(operations, "reset", { status: "unknown" });
  assert.equal(isFlashFullyConfirmed(operations), false);
});

test("operation history remains isolated by project and does not retain mutable references", () => {
  const history = new ProjectOperationHistory();
  const first = snapshot(setOperationResult(createInitialOperationStates(), "build", { status: "success" }));
  history.set("/projects/alpha", first);
  first.operations.build.status = "failed";
  history.set("/projects/beta", snapshot(setOperationResult(createInitialOperationStates(), "build", { status: "failed" })));
  assert.equal(history.get("/projects/alpha").operations.build.status, "success");
  assert.equal(history.get("/projects/beta").operations.build.status, "failed");
});

test("Windows project history keys compare case-insensitively and normalize dot segments", () => {
  assert.equal(
    projectOperationKey("C:\\Code\\Lab\\..\\Firmware", "win32"),
    projectOperationKey("c:\\code\\firmware", "win32"),
  );
});

test("project history has a fixed entry limit", () => {
  const history = new ProjectOperationHistory(2, "linux");
  history.set("/projects/one", snapshot());
  history.set("/projects/two", snapshot());
  history.set("/projects/three", snapshot());
  assert.equal(history.get("/projects/one"), undefined);
  assert.ok(history.get("/projects/two"));
  assert.ok(history.get("/projects/three"));
});
