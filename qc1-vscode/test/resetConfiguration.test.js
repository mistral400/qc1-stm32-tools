const assert = require("node:assert/strict");
const test = require("node:test");
const {
  defaultResetProfile,
  isResetProfileSupportedByStFlash,
  normalizeStoredResetProfile,
  ProjectResetProfileStore,
  resetProfileStorageKey,
  validateResetProfile,
} = require("../out/qc1/resetConfiguration");

test("reset profiles accept documented modes and bounded integer timing values", () => {
  assert.deepEqual(validateResetProfile({ mode: "software", adapterSpeedKHz: 1000 }), { mode: "software", adapterSpeedKHz: 1000 });
  assert.deepEqual(validateResetProfile({ mode: "hardware-nrst", srstPulseWidthMs: 10, srstDelayMs: 100 }), {
    mode: "hardware-nrst", srstPulseWidthMs: 10, srstDelayMs: 100,
  });
  for (const profile of [
    { mode: "magic" }, { mode: "connect-under-reset", adapterSpeedKHz: 0 },
    { mode: "hardware-nrst", srstPulseWidthMs: 1.5 }, { mode: "backend-default", srstDelayMs: 10001 },
    { mode: "software", command: "reset; erase" },
  ]) assert.throws(() => validateResetProfile(profile));
});

test("project reset profiles are isolated and Windows path keys are case-insensitive", async () => {
  const values = new Map();
  const store = new ProjectResetProfileStore({
    get: (key) => values.get(key),
    update: async (key, value) => { values.set(key, value); },
  }, "win32");
  await store.update("C:\\Course\\F103", { mode: "hardware-nrst", srstDelayMs: 125 });
  assert.deepEqual(store.get("c:\\course\\f103\\."), { mode: "hardware-nrst", srstDelayMs: 125 });
  assert.deepEqual(store.get("C:\\Course\\H755"), defaultResetProfile);
  assert.match(resetProfileStorageKey("C:\\Course\\F103", "win32"), /^qc1\.resetProfile\.[a-f0-9]{64}$/);
  assert.equal(resetProfileStorageKey("", "win32"), "");
  assert.doesNotMatch([...values.keys()][0], /Course|F103/i);
});

test("malformed persisted data falls back to backend defaults and st-flash rejects unsupported options", () => {
  assert.deepEqual(normalizeStoredResetProfile({ mode: "unknown" }), defaultResetProfile);
  assert.equal(isResetProfileSupportedByStFlash(defaultResetProfile), true);
  assert.equal(isResetProfileSupportedByStFlash({ mode: "software" }), false);
  assert.equal(isResetProfileSupportedByStFlash({ mode: "backend-default", adapterSpeedKHz: 500 }), false);
});
