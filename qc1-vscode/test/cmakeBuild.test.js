const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveExecutable, runProcess } = require("../out/qc1/processTools");
const { readFileApi } = require("../out/qc1/cmakeFileApi");

test("real native CMake configures and builds a renamed artifact in a Unicode path", async t => {
  const cmake = resolveExecutable("cmake");
  if (!cmake) { t.skip("CMake not installed"); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-cmake-école (Ω)-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const build = path.join(root, "build output");
  const query = path.join(build, ".cmake", "api", "v1", "query", "client-qc1");
  fs.mkdirSync(query, { recursive: true });
  for (const name of ["codemodel-v2", "toolchains-v1"]) fs.writeFileSync(path.join(query, name), "");
  fs.writeFileSync(path.join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)\nproject(native_test C)\nadd_executable(application main.c)\nset_target_properties(application PROPERTIES OUTPUT_NAME renamed)\n");
  fs.writeFileSync(path.join(root, "main.c"), "int main(void) { return 0; }\n");
  const configure = await runProcess(cmake, ["-S", root, "-B", build], { timeoutMs: 60000 });
  assert.equal(configure.exitCode, 0, configure.stderr || configure.error);
  const compilation = await runProcess(cmake, ["--build", build, "--config", "Debug"], { timeoutMs: 60000 });
  assert.equal(compilation.exitCode, 0, compilation.stderr || compilation.error);
  const snapshot = readFileApi(build, root);
  const target = snapshot.targets.find(target => target.name === "application" && (!target.configuration || target.configuration === "Debug"));
  assert.ok(target);
  assert.ok(target.artifacts.some(file => path.basename(file).startsWith("renamed") && fs.existsSync(file)));
  assert.ok(target.sources.includes(path.join(root, "main.c")));
});
