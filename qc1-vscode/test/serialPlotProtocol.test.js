const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BoundedSerialPlotHistory,
  SerialPlotLineParser,
} = require("../out/qc1/serialPlotProtocol");

test("only explicit QC1 JSON Lines become plot samples, including split chunks", () => {
  const parser = new SerialPlotLineParser();
  assert.deepEqual(
    parser.push("temperature=21.5\n{\"qc1_plot\":1,\"time_ms\":10,\"values\":{\"temp_c\":21.5}}"),
    { samples: [], rejectedLines: 1, oversizedLines: 0 },
  );
  assert.deepEqual(parser.push("\n"),
    { samples: [{ timeMs: 10, values: { temp_c: 21.5 } }], rejectedLines: 0, oversizedLines: 0 });
});

test("plot protocol rejects unsupported versions, invalid numbers and too many series", () => {
  const parser = new SerialPlotLineParser();
  const lines = [
    JSON.stringify({ qc1_plot: 2, time_ms: 1, values: { x: 1 } }),
    "{\"qc1_plot\":1,\"time_ms\":null,\"values\":{\"x\":1}}",
    JSON.stringify({ qc1_plot: 1, time_ms: 1, values: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ["v" + i, i])) }),
    "{\"qc1_plot\":1,\"time_ms\":1,\"values\":{\"x\":1e999}}",
  ];
  const result = parser.push(lines.join("\n") + "\n");
  assert.equal(result.samples.length, 0);
  assert.equal(result.rejectedLines, 4);
});

test("oversized partial lines are dropped and parser memory is released at delimiter", () => {
  const parser = new SerialPlotLineParser();
  const result = parser.push("x".repeat(3000) + "\n" + JSON.stringify({ qc1_plot: 1, time_ms: 2, values: { x: 1 } }) + "\n");
  assert.deepEqual(result.samples, [{ timeMs: 2, values: { x: 1 } }]);
  assert.equal(result.oversizedLines, 1);
});

test("plot history retains only the configured sample window and returns detached snapshots", () => {
  const history = new BoundedSerialPlotHistory(3);
  for (let timeMs = 1; timeMs <= 5; timeMs += 1)
    assert.equal(history.append({ timeMs, values: { x: timeMs } }), true);
  const snapshot = history.snapshot();
  assert.deepEqual(snapshot.samples.map((sample) => sample.timeMs), [3, 4, 5]);
  snapshot.samples[0].values.x = 999;
  assert.equal(history.snapshot().samples[0].values.x, 3);
  assert.equal(history.size, 3);
  assert.equal(history.append({ timeMs: 6, values: { y: 6 } }), true);
  assert.equal(history.append({ timeMs: 7, values: { z: 7 } }), true);
  assert.equal(history.append({ timeMs: 8, values: { fourth: 8, fifth: 8, sixth: 8, seventh: 8, eighth: 8, ninth: 8 } }), false);
  history.clear();
  assert.deepEqual(history.snapshot(), { samples: [], series: [] });
});
