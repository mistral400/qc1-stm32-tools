const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { coreBuildArguments, configuredCoreTarget, configuredCoreArtifact, readCoreBuildMetadata, applyCoreBuildMetadata } = require("../out/qc1/coreBuild");
const { buildToolEnvironment } = require("../out/qc1/processTools");
const { inspectStm32Project } = require("../out/qc1/projectDiscovery");
const target = (name, extra = {}) => ({ name, type: "UTILITY", configuration: "Debug", artifacts: [], sources: [], definitions: [], fragments: [], ...extra });

test("arbitrary configured UTILITY targets replace unresolved expressions after configure", () => {
  const targets = [target("MyProject_CM7"), target("MyProject_CM4"), target("MyProject_CM7-install")];
  assert.equal(configuredCoreTarget(targets.slice(0, 2), "cm7"), "MyProject_CM7");
  assert.equal(configuredCoreTarget(targets.slice(0, 2), "cm4"), "MyProject_CM4");
  const args = coreBuildArguments(["--build", "--preset", "Debug", "--target", "${CMAKE_PROJECT_NAME}"], targets.slice(0, 2), "cm7");
  assert.deepEqual(args.slice(-2), ["--target", "MyProject_CM7"]);
  assert.ok(!args.some(arg => arg.includes("${")));
  assert.throws(() => coreBuildArguments([], [target("${CMAKE_PROJECT_NAME}_CM7")], "cm7"), /absente ou ambiguë/);
  assert.equal(configuredCoreTarget(targets, "cm7"), "MyProject_CM7", "prefer the project over ExternalProject step targets");
  assert.throws(() => coreBuildArguments([], [...targets, target("Other_CM7")], "cm7"), /ambiguë/);
});

test("PATH retains tools, spaces, old entries and platform separators without mutating its input", () => {
  for (const platform of ["darwin", "linux"]) {
    const base = { PATH: "/usr/bin:/bin", KEEP: "yes" };
    const env = buildToolEnvironment(["/tool suite/cmake/bin/cmake", "/tool suite/ninja/bin/ninja", "/arm/bin/arm-none-eabi-gcc", "/debug/bin/arm-none-eabi-gdb"], base, platform);
    assert.equal(env.PATH, "/tool suite/cmake/bin:/tool suite/ninja/bin:/arm/bin:/debug/bin:/usr/bin:/bin");
    assert.equal(env.KEEP, "yes"); assert.equal(base.PATH, "/usr/bin:/bin");
  }
  const env = buildToolEnvironment(["C:\\Tool Suite\\cmake.exe", "C:\\Ninja\\ninja.exe", "C:\\ARM\\gcc.exe"], { Path: "C:\\Windows", PATH: "D:\\old", Keep: "yes" }, "win32");
  assert.equal(env.PATH, "C:\\Tool Suite;C:\\Ninja;C:\\ARM;C:\\Windows;D:\\old");
  assert.equal(env.Path, undefined);
  const deduplicated = buildToolEnvironment(["", "C:\\ARM\\gcc.exe", "c:\\arm\\gdb.exe"], { Path: "C:\\ARM;D:\\existing" }, "win32");
  assert.equal(deduplicated.PATH, "C:\\ARM;D:\\existing");
});

test("CubeMX flash linkers win over SRAM and effective compile commands own flag diagnostics", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1 core metadata "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  write(path.join(root, "CMakeLists.txt"), "project(Custom)\n");
  write(path.join(root, "board.ioc"), "Mcu.Name=STM32H755ZITx");
  const build = path.join(root, "out root");
  let cache = `CMAKE_HOME_DIRECTORY:INTERNAL=${root}\nCMAKE_BUILD_TYPE:STRING=Debug\n`;
  for (const core of ["CM7", "CM4"]) {
    const source = path.join(root, core), output = path.join(root, "generated outputs", core);
    const elf = path.join(output, `Custom_${core}.elf`);
    write(path.join(source, "CMakeLists.txt"), `set(CMAKE_PROJECT_NAME Custom_${core})\nproject(\${CMAKE_PROJECT_NAME})\n# -mthumb deliberately only in static text\n`);
    write(path.join(source, `stm32h755xx_FLASH_${core}.ld`), "");
    write(path.join(source, `stm32h755xx_sram1_${core}.ld`), "");
    write(path.join(output, "CMakeCache.txt"), `CMAKE_HOME_DIRECTORY:INTERNAL=${source}\nCMAKE_BUILD_TYPE:STRING=Debug\n`);
    write(path.join(output, "compile_commands.json"), JSON.stringify([{ arguments: ["gcc", `-mcpu=cortex-m${core.slice(-1)}`, ...(core === "CM7" ? ["-mthumb"] : []), `-DCORE_${core}`, "-DSTM32H755xx"], file: "main.c" }]));
    write(elf, "ELF fixture");
    cache += `ST_DUAL_CORE_${core}_PROJECT_BUILD_TARGET:FILEPATH=${elf}\n`;
  }
  write(path.join(build, "CMakeCache.txt"), cache);
  const inspection = inspectStm32Project(root, build);
  for (const core of ["cm7", "cm4"]) {
    assert.match(inspection.architecture[core].linkerScriptPath, new RegExp(`_FLASH_${core}.ld$`, "i"));
    assert.equal(inspection.architecture[core].targetName, `Custom_${core.toUpperCase()}`);
  }
  assert.ok(!inspection.architecture.cm7.missingFlags.includes("-mthumb"));
  assert.ok(inspection.architecture.cm4.missingFlags.includes("-mthumb"), "static comments cannot hide a missing effective flag");
  const metadata = readCoreBuildMetadata(root, build, "Debug");
  const cm7 = configuredCoreArtifact(metadata, "cm7"), cm4 = configuredCoreArtifact(metadata, "cm4");
  assert.match(cm7, /Custom_CM7.elf$/); assert.match(cm4, /Custom_CM4.elf$/);
  assert.equal(configuredCoreArtifact(metadata, "cm4", cm7), "", "reject swapped explicit ELF");
  assert.equal(configuredCoreArtifact(metadata, "cm7", cm4), "");
  metadata.artifactTargets.push(target("second_CM7", { type: "EXECUTABLE", artifacts: [cm4], definitions: ["CORE_CM7"] }));
  assert.equal(configuredCoreArtifact(metadata, "cm7", cm4), "");
});

test("File API compile options take precedence over link flags and include every compile group", () => {
  const architecture = { cm7: { expectedFlags: ["-mcpu=cortex-m7", "-mthumb"], expectedDefines: [] }, cm4: { expectedFlags: [], expectedDefines: [] } };
  applyCoreBuildMetadata(architecture, {
    buildTargets: [], compileCommands: { cm7: ["-mcpu=cortex-m7 -mthumb"], cm4: [] },
    artifactTargets: [target("App_CM7", { fragments: ["-mcpu=cortex-m7 -mthumb"], compileFragments: ["-mcpu=cortex-m7", "-mcpu=cortex-m7 -mthumb"] })]
  });
  assert.deepEqual(architecture.cm7.missingFlags, ["-mthumb"]);
});


test("wrong effective CPU flags remain visible even if a target name claims CM7", () => {
  const architecture = { cm7: { expectedFlags: ["-mcpu=cortex-m7", "-mthumb"], expectedDefines: [] }, cm4: { expectedFlags: [], expectedDefines: [] } };
  applyCoreBuildMetadata(architecture, {
    buildTargets: [], compileCommands: { cm7: [], cm4: [] },
    artifactTargets: [target("App_CM7", { fragments: ["-mcpu=cortex-m4 -mthumb"], compileFragments: ["-mcpu=cortex-m4 -mthumb"] })]
  });
  assert.deepEqual(architecture.cm7.missingFlags, ["-mcpu=cortex-m7"]);
});

test("contradictory core names and orphan explicit ELF paths are rejected", () => {
  const wrong = target("App_CM4", { type: "EXECUTABLE", artifacts: ["/build/App_CM4.elf"], definitions: ["CORE_CM7"] });
  assert.equal(configuredCoreTarget([wrong], "cm7"), "");
  const metadata = { buildTargets: [], artifactTargets: [], compileCommands: { cm7: [], cm4: [] } };
  assert.equal(configuredCoreArtifact(metadata, "cm7", "/somewhere/looks_CM7.elf"), "");
});

test("an ancestor folder named CM4 does not reclassify a CM7 project or ELF", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qc1 parent "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "CM4", "Firmware"), elf = path.join(project, "build", "App_CM7.elf");
  const write = (file, contents = "") => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); };
  write(path.join(project, "CMakeLists.txt"), "project(App)\n");
  write(path.join(project, "board.ioc"), "Mcu.Name=STM32H755ZITx\n");
  write(path.join(project, "CM7", "CMakeLists.txt"), "project(App_CM7)\n");
  write(path.join(project, "CM7", "startup_stm32h755xx_CM7.s"));
  write(path.join(project, "CM7", "stm32h755xx_flash_CM7.ld"));
  write(elf, "ELF fixture");
  const architecture = inspectStm32Project(project).architecture;
  assert.equal(architecture.coreMode, "cm7");
  assert.match(architecture.cm7.linkerScriptPath, /flash_CM7.ld$/);
  const metadata = { buildTargets: [], artifactTargets: [target("App_CM7", { type: "EXECUTABLE", artifacts: [elf] })], compileCommands: { cm7: [], cm4: [] } };
  assert.equal(configuredCoreArtifact(metadata, "cm7"), elf);
  assert.equal(configuredCoreArtifact(metadata, "cm4"), "");
});
