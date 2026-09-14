const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  inspectStm32Project,
  findStm32Project,
  isUsableStm32Project,
} = require("../out/qc1/projectDiscovery");
const { parseCmake } = require("../out/qc1/cmakeInspection");
const {
  inspectProjectDetails,
  inspectLinker,
} = require("../out/qc1/projectDiagnostics");
const {
  checkSpelling,
  scanProject,
  inside,
  resolveUserPath,
} = require("../out/qc1/filesystem");
const {
  runProcess,
  pathCandidates,
  executableExists,
  executableArchitecture,
  collectTools,
} = require("../out/qc1/processTools");
const {
  serialNames,
  parseOsRelease,
  classifyEnvironment,
  probeType,
} = require("../out/qc1/systemInspection");
const {
  readStlinkProbeStatus,
  getOpenOcdProgramArgs,
} = require("../out/qc1/hardware");
const {
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue,
  buildDiagnosticJson,
  buildDiagnosticReport,
} = require("../out/qc1/diagnosticReport");
const { readFileApi } = require("../out/qc1/cmakeFileApi");

function fixture(t, name = "école été (ARM)-l'appli Ω") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "qc1-portability-"));
  const root = path.join(base, name);
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return {
    root,
    write(relative, text = "") {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return file;
    },
  };
}
for (const directory of [
  "src",
  "Src",
  "SRC",
  "Core/Src",
  "Core/src",
  "source",
  "sources",
  "application-custom/logic",
]) {
  test(`source layout ${directory} in Unicode project`, (t) => {
    const f = fixture(t);
    f.write(
      "CMakeLists.txt",
      `project(firmware)\nadd_executable(firmware "${directory}/main.c" startup.s)\ntarget_link_options(firmware PRIVATE -Tmemory.ld)`,
    );
    f.write(`${directory}/main.c`);
    f.write("startup.s");
    f.write("memory.ld");
    const p = inspectStm32Project(f.root);
    assert.equal(p.srcPath, path.join(f.root, directory));
    assert.equal(p.layout, "native-cmake");
    assert.ok(isUsableStm32Project(p));
    assert.equal(p.findings.length, 0);
  });
}
test("CMake variables, target_sources, recursive GLOB, subdirectory and custom vector assembly", (t) => {
  const f = fixture(t, "project-custom");
  f.write(
    "CMakeLists.txt",
    "project(example)\nset(APP application)\nadd_subdirectory(${APP})",
  );
  f.write(
    "application/CMakeLists.txt",
    'file(GLOB_RECURSE CS CONFIGURE_DEPENDS "source/*.c")\nadd_executable(real_target ${CS})\ntarget_sources(real_target PRIVATE reset.S)\nset(LINK "${CMAKE_CURRENT_SOURCE_DIR}/memory layout.ld")\ntarget_link_options(real_target PRIVATE "-T${LINK}")',
  );
  f.write("application/source/nested/main.c");
  f.write("application/reset.S", ".global Reset_Handler");
  f.write(
    "application/memory layout.ld",
    "MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 128K\nRAM (rwx) : ORIGIN = 0x20000000, LENGTH = 20K\n}",
  );
  const p = inspectStm32Project(f.root);
  assert.equal(p.projectName, "real_target");
  assert.equal(p.sources.length, 1);
  assert.equal(p.startupPath, path.join(f.root, "application/reset.S"));
  assert.equal(
    p.linkerScriptPath,
    path.join(f.root, "application/memory layout.ld"),
  );
  assert.equal(inspectLinker(p.linkerScriptPath).memory.length, 2);
});
test("missing startup and generated sources do not disqualify native CMake", (t) => {
  const f = fixture(t, "project-native");
  f.write(
    "CMakeLists.txt",
    'project(generated)\nadd_executable(firmware "${CMAKE_BINARY_DIR}/generated.c")',
  );
  const p = inspectStm32Project(f.root);
  assert.ok(isUsableStm32Project(p));
  assert.equal(p.startupPath, "");
  assert.equal(p.srcPath, "");
  assert.ok(
    p.findings.every((f) => f.level !== "error" && f.level !== "critical"),
  );
});
test("ambiguous startups and linker scripts are not chosen arbitrarily", (t) => {
  const f = fixture(t);
  f.write("src/main.c");
  f.write("startup_a.s");
  f.write("startup_b.S");
  f.write("a.ld");
  f.write("b.ld");
  const p = inspectStm32Project(f.root);
  assert.equal(p.startupPath, "");
  assert.equal(p.linkerScriptPath, "");
  assert.ok(p.findings.some((f) => f.title === "STARTUP_AMBIGUOUS"));
  assert.ok(p.findings.some((f) => f.title === "LINKER_AMBIGUOUS"));
});
test("case mismatch in CMake and quoted includes preserves actual spelling", (t) => {
  const f = fixture(t, "project-case-error");
  f.write("src/main.c", '#include "Device.h"');
  f.write("src/device.h");
  f.write("CMakeLists.txt", "project(case)\nadd_executable(fw Src/main.c)");
  const p = inspectStm32Project(f.root),
    details = inspectProjectDetails(p);
  assert.ok(
    details.findings.some(
      (f) => f.code === "QC1-PATH-001" && f.title === "CASE_MISMATCH",
    ),
  );
  assert.ok(
    details.findings.some(
      (f) => f.code === "QC1-PATH-002" && f.evidence.endsWith("device.h"),
    ),
  );
  assert.equal(
    checkSpelling(path.join(f.root, "Src/main.c")).actual,
    path.join(f.root, "src/main.c"),
  );
});
test("invalid CMake yields evidence without throwing", (t) => {
  const f = fixture(t);
  f.write("CMakeLists.txt", "project(broken\nadd_executable(");
  assert.ok(
    inspectStm32Project(f.root).findings.some(
      (f) => f.code === "QC1-CMAKE-001",
    ),
  );
  assert.equal(
    parseCmake("# ignored\nproject([=[hello (world)]=])").invalid,
    false,
  );
});
for (const [marker, layout] of [
  ["board.ioc", "cubemx"],
  [".cproject", "stm32cubeide"],
  ["Makefile", "makefile"],
  ["platformio.ini", "platformio"],
]) {
  test(`recognizes ${layout} markers`, (t) => {
    const f = fixture(t, "project-cube");
    f.write(marker);
    assert.equal(inspectStm32Project(f.root).layout, layout);
  });
}
test("bounded traversal avoids symlink cycles, external links and stale build files", (t) => {
  const f = fixture(t);
  f.write("src/main.c");
  f.write("build/stale.ld");
  f.write("node_modules/secret.c");
  try {
    fs.symlinkSync(f.root, path.join(f.root, "loop"), "junction");
    fs.symlinkSync(
      path.dirname(f.root),
      path.join(f.root, "outside"),
      "junction",
    );
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
  const scan = scanProject(f.root);
  assert.equal(scan.files.length, 1);
  assert.equal(scan.truncated, false);
  assert.equal(scanProject(f.root, 0).truncated, true);
  assert.equal(scanProject(f.root, 10, 1).truncated, true);
});
test("paths: Windows UNC, relative, home, spaces, case and dot-dot names", () => {
  assert.equal(
    resolveUserPath(
      "..\\projet été",
      "C:\\Work\\lab",
      "win32",
      "C:\\Users\\Alice",
    ),
    "C:\\Work\\projet été",
  );
  assert.equal(
    resolveUserPath("~\\code", "D:\\workspace", "win32", "C:\\Users\\Alice"),
    "C:\\Users\\Alice\\code",
  );
  assert.equal(
    resolveUserPath("\\\\server\\share\\code", "C:\\Work", "win32"),
    "\\\\server\\share\\code",
  );
  assert.ok(inside("C:\\Work", "c:\\work\\..notes", path.win32));
  assert.ok(!inside("C:\\Work", "C:\\Workspace", path.win32));
  assert.ok(inside("/project", "/project/..notes"));
  assert.ok(!inside("/project", "/project2"));
});
test("PATH resolution accepts Path on Windows and quoted directories with PATHEXT", () => {
  assert.deepEqual(
    pathCandidates(
      "gcc",
      { Path: '"C:\\Program Files\\ARM";D:\\bin', PATHEXT: ".EXE" },
      "win32",
    ),
    ["C:\\Program Files\\ARM\\gcc.EXE", "D:\\bin\\gcc.EXE"],
  );
  assert.deepEqual(pathCandidates("gcc", { PATH: "/a:/b" }, "linux"), [
    "/a/gcc",
    "/b/gcc",
  ]);
});
test("executable checks reject directories and nonexecutable files", (t) => {
  const f = fixture(t),
    file = f.write("tool", "hello");
  assert.equal(executableExists(f.root), false);
  if (os.platform() !== "win32") {
    fs.chmodSync(file, 0o600);
    assert.equal(executableExists(file), false);
  }
  assert.equal(executableArchitecture(file), "unknown");
});
test("process runner bounds output, catches spawn errors and synchronous invalid args", async () => {
  const large = await runProcess(
    process.execPath,
    ["-e", 'process.stdout.write("a".repeat(50000))'],
    { maxBytes: 256 },
  );
  assert.equal(large.exitCode, 0);
  assert.equal(large.stdout.length, 256);
  assert.equal(large.truncated, true);
  assert.ok((await runProcess("qc1-nonexistent-tool", [])).error);
  assert.ok((await runProcess("invalid\0exe", [])).error);
});
test("process timeout and pre-aborted requests always settle", async () => {
  const start = Date.now();
  const result = await runProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { timeoutMs: 80 },
  );
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - start < 1500);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await runProcess(process.execPath, ["-e", "process.exit(0)"], {
        signal: controller.signal,
      })
    ).error,
    "Cancelled",
  );
});
test("diagnostic inventory is complete and untrusted tool execution is skipped", async () => {
  const tools = await collectTools({
    trusted: false,
    env: { PATH: "" },
    configured: { cmake: process.execPath },
  });
  assert.ok(tools.length >= 28);
  assert.equal(tools.find((t) => t.name === "cmake").exitCode, null);
  assert.ok(
    tools.find((t) => t.name === "cmake").probeStatus.includes("untrusted"),
  );
  assert.ok(tools.some((t) => t.name === "arm-none-eabi-objdump"));
});
test("serial names across Windows Linux macOS and USB probe classes", () => {
  assert.deepEqual(serialNames("win32", ["COM1", "COM20", "invalid"]), [
    "COM1",
    "COM20",
  ]);
  assert.deepEqual(serialNames("linux", ["ttyACM0", "ttyUSB1", "tty0"]), [
    "ttyACM0",
    "ttyUSB1",
  ]);
  assert.deepEqual(
    serialNames("darwin", ["cu.usbmodem1", "tty.usbserial2", "disk0"]),
    ["cu.usbmodem1", "tty.usbserial2"],
  );
  assert.equal(probeType("SEGGER J-Link"), "J-Link");
  assert.equal(probeType("CMSIS-DAP"), "CMSIS-DAP");
});
test("Linux distro metadata and WSL/SSH environment", () => {
  assert.deepEqual(
    parseOsRelease(
      'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\nSECRET=private',
    ),
    { NAME: "Ubuntu", ID: "ubuntu", VERSION_ID: "24.04" },
  );
  assert.equal(
    classifyEnvironment("linux", "5.15-microsoft-WSL2", {
      SSH_CONNECTION: "private",
    }).wsl,
    true,
  );
  assert.equal(
    classifyEnvironment("linux", "6.1", { SSH_CONNECTION: "private" }).ssh,
    true,
  );
});
test("ST-Link presence is not inferred from an error or banner", () => {
  for (const message of [
    "ST-Link permission denied",
    "libusb access error ST-Link",
    "stlink v1.8.0",
    "unable to connect to ST-Link",
  ])
    assert.notEqual(readStlinkProbeStatus(message), "OK");
  assert.equal(readStlinkProbeStatus("Found 1 stlink programmers"), "OK");
  assert.equal(
    readStlinkProbeStatus("Found 0 stlink programmers"),
    "non détecté",
  );
});
test("OpenOCD paths cannot terminate the Tcl filename argument", () => {
  assert.throws(() => getOpenOcdProgramArgs("firmware} ; shutdown; {evil.elf"));
  assert.ok(
    getOpenOcdProgramArgs("C:\\My project\\été.elf")
      .at(-1)
      .includes("{C:/My project/été.elf}"),
  );
});
test("MCU conflicts use evidence and never invent capacity", (t) => {
  const f = fixture(t);
  f.write("startup_stm32f103xb.s");
  f.write("stm32f407_flash.ld");
  f.write("src/main.c");
  const details = inspectProjectDetails(inspectStm32Project(f.root));
  assert.ok(details.findings.some((f) => f.title === "MCU_CONFLICT"));
  assert.equal(details.mcu.exact, "unknown");
  assert.match(details.mcu.expectedFlash, /unknown/);
});
test("privacy redacts Windows/macOS/Linux paths, serials, PEM, emails and environment secrets", () => {
  const raw =
    "C:\\Users\\Alice\\secret.c /Users/alice/foo /home/bob/bar\nserial: ABC123\nGITHUB_TOKEN=abcdefg\nOPENAI_API_KEY=abcdefg\nalice@example.test\n-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----";
  const clean = sanitizeDiagnosticText(raw);
  assert.doesNotMatch(clean, /Alice|alice|bob|ABC123|abcdefg|private material/);
  const structured = sanitizeDiagnosticValue(
    {
      apiKey: "private",
      password: "private",
      hardware: { serialNumber: "unique" },
      path: "C:\\Users\\Alice\\project\\src\\main.c",
    },
    [{ value: "C:\\Users\\Alice\\project", replacement: "<PROJECT>" }],
  );
  assert.doesNotMatch(JSON.stringify(structured), /private|unique|Alice/);
});
test("versioned report JSON remains parseable after Windows-path redaction", () => {
  const input = {
    generatedAt: "now",
    issueDescription: "problem",
    extension: {},
    runtime: {},
    workspace: {},
    project: { path: "C:\\Users\\Alice\\project" },
    configuration: {},
    dashboard: {},
    artifacts: {},
    hardware: {},
    tools: [],
    vscodeProblems: [],
    gitSnapshot: "",
    projectTree: "",
    logs: "",
  };
  const rules = [
    { value: "C:\\Users\\Alice\\project", replacement: "<PROJECT>" },
  ];
  const json = JSON.parse(buildDiagnosticJson(input, rules));
  assert.equal(json.reportSchemaVersion, 2);
  assert.equal(json.project.path, "<PROJECT>");
  const markdown = buildDiagnosticReport(input, rules);
  assert.ok(markdown.includes("## Ports série"));
  assert.ok(markdown.includes("## Extensions installées"));
  assert.equal(
    JSON.parse(
      markdown
        .split("## Résumé JSON (reportSchemaVersion 2)")[1]
        .split("~~~~json\n")[1]
        .split("\n~~~~")[0],
    ).reportSchemaVersion,
    2,
  );
});

test("CMake File API reads only indexed targets, real artifacts and toolchain evidence", (t) => {
  const f = fixture(t),
    build = path.join(f.root, "build", "qc1"),
    reply = path.join("build", "qc1", ".cmake", "api", "v1", "reply");
  const json = (name, data) =>
    f.write(path.join(reply, name), JSON.stringify(data));
  json("index-1.json", {
    cmake: { generator: { name: "Unix Makefiles" } },
    objects: [
      { kind: "codemodel", version: { major: 2 }, jsonFile: "model.json" },
      { kind: "toolchains", version: { major: 1 }, jsonFile: "tools.json" },
    ],
  });
  json("model.json", {
    paths: { source: f.root, build },
    configurations: [{ name: "Debug", targets: [{ jsonFile: "target.json" }] }],
  });
  json("target.json", {
    name: "real",
    type: "EXECUTABLE",
    artifacts: [{ path: "bin/renamed.elf" }],
    sources: [{ path: "src/main.c" }],
    compileGroups: [
      {
        defines: [{ define: "STM32F103xB" }],
        includes: [{ path: path.join(f.root, "inc") }],
      },
    ],
  });
  json("tools.json", {
    toolchains: [
      {
        language: "C",
        compiler: { path: "/toolchain/gcc", target: "arm-none-eabi" },
      },
    ],
  });
  json("target-unreferenced.json", { name: "stale", type: "EXECUTABLE" });
  const result = readFileApi(build, f.root);
  assert.equal(result.targets.length, 1);
  assert.equal(
    result.targets[0].artifacts[0],
    path.join(build, "bin", "renamed.elf"),
  );
  assert.equal(result.toolchains[0].compiler.target, "arm-none-eabi");
  assert.equal(
    readFileApi(build, path.join(f.root, "different")).targets.length,
    0,
  );
});
test("File API refuses traversal and malformed JSON", (t) => {
  const f = fixture(t),
    build = path.join(f.root, "build", "qc1"),
    reply = path.join("build", "qc1", ".cmake", "api", "v1", "reply");
  f.write(
    path.join(reply, "index-1.json"),
    JSON.stringify({
      objects: [
        {
          kind: "codemodel",
          version: { major: 2 },
          jsonFile: "../../outside.json",
        },
      ],
    }),
  );
  assert.equal(readFileApi(build, f.root).targets.length, 0);
  f.write(path.join(reply, "index-2.json"), "{not-json");
  assert.equal(readFileApi(build, f.root).targets.length, 0);
});
test("architecture detects ARM64 ELF and x64 PE from bounded headers", (t) => {
  const f = fixture(t);
  const elf = Buffer.alloc(64);
  elf.set([127, 69, 76, 70, 2, 1]);
  elf.writeUInt16LE(183, 18);
  const pe = Buffer.alloc(128);
  pe.writeUInt16LE(0x5a4d, 0);
  pe.writeUInt32LE(64, 60);
  pe.write("PE", 64);
  pe.writeUInt16LE(0x8664, 68);
  const a = f.write("arm-tool", elf),
    b = f.write("windows.exe", pe);
  assert.equal(executableArchitecture(a), "arm64");
  assert.equal(executableArchitecture(b), "x64");
});
test("JSON log secrets, long fences and serial arrays remain safe", () => {
  assert.doesNotMatch(
    sanitizeDiagnosticText(
      '{"apiKey":"secret_value","serial":"unique_serial"}',
    ),
    /secret_value|unique_serial/,
  );
  const clean = sanitizeDiagnosticValue({
    serial: [{ name: "/dev/ttyACM0", serial: "unique_serial" }],
  });
  assert.equal(clean.serial[0].name, "/dev/ttyACM0");
  assert.equal(clean.serial[0].serial, "<REDACTED>");
  assert.doesNotThrow(() =>
    buildDiagnosticReport({
      generatedAt: "now",
      issueDescription: "",
      extension: {},
      runtime: {},
      workspace: {},
      project: {},
      configuration: {},
      dashboard: {},
      artifacts: {},
      hardware: {},
      tools: [],
      vscodeProblems: [],
      gitSnapshot: "",
      projectTree: "",
      logs: "~ ".repeat(150000),
    }),
  );
});
