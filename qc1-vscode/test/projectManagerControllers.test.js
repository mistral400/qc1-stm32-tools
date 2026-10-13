const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { ProjectDiscoveryController } = require("../out/qc1/projectDiscoveryController");
const { ProjectConfigurationController, projectWriteTarget, assertOperationConfiguration } = require("../out/qc1/projectConfiguration");
const { RecentProjectsController } = require("../out/qc1/recentProjectsController");

const candidate = (name) => ({ path: path.resolve(name), name, family: "STM32F1", mcu: "STM32F103xB", architecture: "single-core", cores: [], confidence: 95, buildSystem: "make", evidence: [], missingComponents: [], warnings: [] });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("new scan aborts the previous request and ignores its late result", async () => {
  const calls = [], states = [];
  const controller = new ProjectDiscoveryController((state) => states.push(state), {
    discover: (options) => { const result = deferred(); calls.push({ options, result }); return result.promise; },
    analyze: async () => undefined,
  });
  const old = controller.scan(["old"]);
  const latest = controller.scan(["new"]);
  assert.equal(calls[0].options.signal.aborted, true);
  calls[1].result.resolve([candidate("new")]);
  await latest;
  calls[0].result.resolve([candidate("old")]);
  await old;
  assert.equal(controller.snapshot.status, "success");
  assert.equal(controller.snapshot.candidates[0].name, "new");
  assert.deepEqual(controller.snapshot.roots, ["new"]);
  assert.equal(states.at(-1).candidates[0].name, "new");
});

test("an old rejected scan cannot surface an error in a newer successful scan", async () => {
  const calls = [];
  const controller = new ProjectDiscoveryController(() => {}, {
    discover: () => { const result = deferred(); calls.push(result); return result.promise; }, analyze: async () => undefined,
  });
  const first = controller.scan(["first"]), second = controller.scan(["second"]);
  calls[1].resolve([]); await second;
  calls[0].reject(new Error("obsolete error")); await first;
  assert.equal(controller.snapshot.status, "success");
  assert.ok(!controller.snapshot.message.includes("obsolete"));
});

test("manual cancellation immediately publishes cancelled and ignores uncooperative results", async () => {
  const result = deferred();
  const controller = new ProjectDiscoveryController(() => {}, { discover: () => result.promise, analyze: async () => undefined });
  const scanning = controller.scan(["root"]);
  controller.cancel();
  result.resolve([candidate("late")]); await scanning;
  assert.equal(controller.snapshot.status, "cancelled");
  assert.deepEqual(controller.snapshot.candidates, []);
});

test("current real errors and AbortError have distinct user states", async () => {
  const controller = new ProjectDiscoveryController(() => {}, {
    discover: async () => { throw new Error("access denied"); }, analyze: async () => undefined,
  });
  await controller.scan(["root"]);
  assert.equal(controller.snapshot.status, "error");
  assert.match(controller.snapshot.message, /access denied/);
  const cancelled = new ProjectDiscoveryController(() => {}, {
    discover: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, analyze: async () => undefined,
  });
  await cancelled.scan(["root"]);
  assert.equal(cancelled.snapshot.status, "cancelled");
});

test("active analysis is cached until manual rescan or structural invalidation", async () => {
  let analyzed = 0;
  const controller = new ProjectDiscoveryController(() => {}, {
    discover: async () => [], analyze: async (root) => { analyzed++; return candidate(root); },
  });
  controller.setSelectedPath(path.resolve("project"));
  await controller.refreshActive(); await controller.refreshActive();
  assert.equal(analyzed, 1);
  controller.markStale(); await controller.refreshActive();
  await controller.rescan();
  assert.equal(analyzed, 3);
  assert.equal(controller.snapshot.stale, false);
});

test("selection and disposal prevent late active-project updates", async () => {
  const old = deferred(); let publications = 0;
  const controller = new ProjectDiscoveryController(() => publications++, {
    discover: async () => [], analyze: () => old.promise,
  });
  controller.setSelectedPath("old"); const analyzing = controller.refreshActive();
  controller.setSelectedPath("new"); controller.dispose();
  const count = publications;
  old.resolve(candidate("old")); await analyzing;
  assert.equal(publications, count);
  assert.equal(controller.snapshot.selectedPath, "new");
  assert.equal(controller.snapshot.activeCandidate, undefined);
});

test("checking a recent project never changes the canonical selection mirror", async () => {
  const controller = new ProjectDiscoveryController(() => {}, {
    discover: async () => [], analyze: async (root) => candidate(root),
  });
  controller.setSelectedPath("current");
  const checked = await controller.inspectForSelection("external");
  assert.equal(checked.name, "external");
  assert.equal(controller.snapshot.selectedPath, "current");
});

test("a structural change cancels an in-flight scan and leaves the project stale", async () => {
  const result = deferred();
  const controller = new ProjectDiscoveryController(() => {}, { discover: () => result.promise, analyze: async () => undefined });
  const scanning = controller.scan(["root"]);
  controller.markStale(); result.resolve([candidate("root")]); await scanning;
  assert.equal(controller.snapshot.stale, true);
  assert.equal(controller.snapshot.status, "idle");
});

test("window policy uses workspace for external projects and user only without workspace", () => {
  assert.equal(projectWriteTarget(true), "workspace");
  assert.equal(projectWriteTarget(false), "global");
});

test("configuration remains persistent and never writes extra bridge fields", async () => {
  const persistent = { projectPath: "old" }, writes = [];
  const port = { hasWorkspace: () => true, update: async (key, value, target) => { persistent[key] = value; writes.push({ key, target }); } };
  const first = new ProjectConfigurationController(port);
  await first.update({ type: "updateProjectSettings", arbitrary: "bad", projectPath: "/outside/project", buildType: "Release", cmakePreset: "release" });
  new ProjectConfigurationController(port);
  assert.equal(persistent.projectPath, "/outside/project");
  assert.equal(persistent.buildType, "Release");
  assert.equal(persistent.type, undefined);
  assert.equal(persistent.arbitrary, undefined);
  assert.ok(writes.every((write) => write.target === "workspace"));
});

test("configuration writes are serialized and a failed write does not poison future saves", async () => {
  const wait = deferred(); const writes = [];
  const controller = new ProjectConfigurationController({
    hasWorkspace: () => false,
    update: async (key, value) => { writes.push(value); if (value === "first") await wait.promise; if (value === "bad") throw new Error("cannot write"); },
  });
  const first = controller.update({ projectPath: "first" });
  const second = controller.update({ projectPath: "second" });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(writes, ["first"]);
  wait.resolve(); await first; await second;
  assert.deepEqual(writes, ["first", "second"]);
  await assert.rejects(controller.update({ projectPath: "bad" }));
  await controller.update({ projectPath: "recovered" });
  assert.equal(writes.at(-1), "recovered");
});

test("invalid settings and changed operation configuration are rejected deterministically", () => {
  const controller = new ProjectConfigurationController({ hasWorkspace: () => true, update: async () => {} });
  assert.throws(() => controller.update({ projectPath: "x", buildType: "bad" }));
  assert.throws(() => controller.update({ projectPath: "x", baudRate: -1 }));
  assert.throws(() => controller.update({ projectPath: "x", discoveryRoots: Array(17).fill("x") }));
  assert.doesNotThrow(() => assertOperationConfiguration("same", "same"));
  assert.throws(() => assertOperationConfiguration("old", "new"), /annulées/);
});

test("recent projects purge absent paths but preserve unreadable entries without rescanning", async () => {
  const valid = path.resolve("/valid"), missing = path.resolve("/missing"), denied = path.resolve("/denied");
  let paths = [valid, missing, denied], checks = 0;
  const recent = new RecentProjectsController({ read: () => paths, write: async (value) => { paths = value; } }, async (root) => {
    checks++; return root === missing ? false : root === denied ? undefined : true;
  });
  recent.cacheMetadata([candidate("/valid")]);
  const result = await recent.load();
  assert.deepEqual(paths, [valid, denied]);
  assert.equal(result[0].mcu, "STM32F103xB");
  assert.equal(result[1].available, undefined);
  assert.equal(checks, 3);
});

test("recent mutations remain ordered with a maximum of eight entries", async () => {
  let paths = [];
  const recent = new RecentProjectsController({ read: () => paths, write: async (value) => { paths = value; } }, async () => true);
  await Promise.all(Array.from({ length: 10 }, (_, index) => recent.remember(candidate(`/project-${index}`))));
  assert.equal(paths.length, 8);
  assert.equal(paths[0], path.resolve("/project-9"));
  await recent.remove("/project-9");
  assert.equal(paths.includes(path.resolve("/project-9")), false);
});
