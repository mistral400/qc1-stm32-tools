const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyTimelineResult, OperationTimeline, summarizeOperation, timelineFailureMessage } = require("../out/qc1/operationTimeline");

test("operation timeline keeps a bounded local summary without paths or probe identifiers", () => {
  const history = new OperationTimeline([], 2);
  history.append({
    id: "one", project: "firmware", occurredAt: "2026-11-04T12:00:00.000Z", operation: "Flash",
    durationMs: 5000, result: "failed", tools: ["OpenOCD"], backend: "OpenOCD",
    verification: "Verification interrompue", error: "Échec dans /Users/alice/private/fw.elf, serial: ABCDEF0123456789",
  });
  history.append({
    id: "two", project: "autre", occurredAt: "2026-11-04T12:01:00.000Z", operation: "Build",
    durationMs: 100, result: "success", tools: ["ARM GCC"], backend: "—", verification: "skipped", error: "",
  });
  history.append({
    id: "three", project: "troisième", occurredAt: "2026-11-04T12:02:00.000Z", operation: "Run",
    durationMs: -20, result: "partial", tools: [], backend: "—", verification: "unknown", error: "",
  });
  const entries = history.snapshot();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].project, "autre");
  assert.equal(entries[1].durationMs, 0);
  const json = JSON.stringify(entries);
  assert.doesNotMatch(json, /\/Users\/alice|private\/fw|ABCDEF0123456789/);
});

test("operation timeline rejects malformed persisted entries and maps QC1 commands", () => {
  const history = new OperationTimeline([
    { id: "bad", operation: "Flash", result: "great" },
    { id: "valid", project: "lab", occurredAt: "2026-11-04T12:00:00.000Z", operation: "Build", result: "success", durationMs: 20 },
  ]);
  assert.equal(history.snapshot().length, 1);
  assert.equal(summarizeOperation("flash-cm7"), "Flash");
  assert.equal(summarizeOperation("debug-cm4"), "Debug");
  assert.equal(summarizeOperation("unknown"), "Autre");
});

test("operation timeline distinguishes a verified Run from an incomplete flash and ignores stale failures", () => {
  const statuses = {
    build: { status: "success", message: "Build ok" },
    artifactValidation: { status: "success" },
    programming: { status: "success" },
    verification: { status: "success" },
    reset: { status: "success" },
    debugSession: { status: "failed", message: "Ancienne erreur debug" },
  };
  assert.equal(classifyTimelineResult("Run", statuses, true), "success");
  assert.equal(classifyTimelineResult("Run", { ...statuses, verification: { status: "failed" } }, false), "failed");
  assert.equal(classifyTimelineResult("Build", statuses, false), "success");
  assert.equal(timelineFailureMessage("Build", statuses), "");
  assert.equal(timelineFailureMessage("Debug", statuses), "Ancienne erreur debug");
});
