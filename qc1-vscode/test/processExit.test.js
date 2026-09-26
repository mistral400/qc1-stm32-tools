const test = require("node:test");
const assert = require("node:assert/strict");
const { runProcess, processSucceeded } = require("../out/qc1/processTools");

test("stderr stays available while a zero exit code succeeds", async () => {
  const result = await runProcess(process.execPath, ["-e", "process.stderr.write('Build context: CM7\\n')"], { timeoutMs: 5000 });
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /Build context: CM7/);
  assert.equal(processSucceeded(result), true);
});

test("a real nonzero exit code remains a failure with stderr diagnostics", async () => {
  const result = await runProcess(process.execPath, ["-e", "process.stderr.write('ninja: error...\\n'); process.exit(1)"], { timeoutMs: 5000 });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ninja: error/);
  assert.equal(processSucceeded(result), false);
  assert.equal(processSucceeded({ exitCode: null, error: "spawn failed", timedOut: false }), false);
});
