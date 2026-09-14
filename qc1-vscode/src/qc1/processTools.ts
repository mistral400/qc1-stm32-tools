/** Shell-free, bounded processes and executable resolution shared by diagnosis/builds. */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
  truncated: boolean;
}
export function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    maxBytes?: number;
    signal?: AbortSignal;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams | undefined;
    let stdout = "",
      stderr = "",
      settled = false,
      timedOut = false,
      truncated = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const max = options.maxBytes ?? 128 * 1024;
    const finish = (exitCode: number | null, error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({ exitCode, stdout, stderr, timedOut, truncated, error });
    };
    const stop = (): void => {
      try {
        child?.kill("SIGKILL");
        child?.stdout.destroy();
        child?.stderr.destroy();
        child?.unref();
      } catch {
        /* already closed */
      }
    };
    const abort = (): void => {
      stop();
      finish(null, "Cancelled");
    };
    if (options.signal?.aborted) {
      finish(null, "Cancelled");
      return;
    }
    try {
      // Windows batch wrappers require a shell; never silently enable shell execution.
      if (os.platform() === "win32" && /\.(cmd|bat)$/i.test(executable)) {
        finish(
          null,
          "Batch wrapper unsupported: configure the native executable (.exe).",
        );
        return;
      }
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        shell: false,
      });
      child.stdin.end();
      timer = setTimeout(() => {
        timedOut = true;
        stop();
        finish(null, "Process timeout");
      }, options.timeoutMs ?? 4000);
      options.signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (buffer: Buffer) => {
        const chunk = buffer.toString();
        truncated ||= stdout.length + chunk.length > max;
        stdout = (stdout + chunk).slice(-max);
        try {
          options.onStdout?.(chunk);
        } catch {
          stop();
          finish(null, "Output callback failed");
        }
      });
      child.stderr.on("data", (buffer: Buffer) => {
        const chunk = buffer.toString();
        truncated ||= stderr.length + chunk.length > max;
        stderr = (stderr + chunk).slice(-max);
        try {
          options.onStderr?.(chunk);
        } catch {
          stop();
          finish(null, "Output callback failed");
        }
      });
      child.on("error", (error) => finish(null, error.message));
      child.on("close", (code) => finish(code));
    } catch (error) {
      finish(
        null,
        error instanceof Error ? error.message : "Process creation failed",
      );
    }
  });
}
export function pathCandidates(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: string = os.platform(),
): string[] {
  const api = platform === "win32" ? path.win32 : path.posix;
  const envKey = Object.keys(env).find((key) =>
    platform === "win32" ? key.toUpperCase() === "PATH" : key === "PATH",
  );
  const dirs = (envKey ? env[envKey] || "" : "")
    .split(api.delimiter)
    .map((v) => v.replace(/^"|"$/g, ""))
    .filter(Boolean);
  const extKey = Object.keys(env).find(
    (key) => key.toUpperCase() === "PATHEXT",
  );
  const extensions =
    platform === "win32"
      ? (env[extKey || "PATHEXT"] || ".EXE;.COM;.CMD;.BAT").split(";")
      : [""];
  const suffixes =
    platform === "win32" &&
    extensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()))
      ? [""]
      : extensions;
  return dirs.flatMap((dir) =>
    suffixes.map((ext) => api.join(dir, name + ext)),
  );
}
export function executableExists(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(
      file,
      os.platform() === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}
export function resolveExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (path.isAbsolute(name)) return executableExists(name) ? name : "";
  return pathCandidates(name, env).find(executableExists) || "";
}
/** Header evidence for the host executable, distinct from the compiler's target triple. */
export function executableArchitecture(file: string): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const b = Buffer.alloc(4096);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    if (n < 20) return "unknown";
    if (b.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) {
      const machine = b[5] === 2 ? b.readUInt16BE(18) : b.readUInt16LE(18);
      return (
        (
          { 3: "ia32", 40: "arm", 62: "x64", 183: "arm64" } as Record<
            number,
            string
          >
        )[machine] || "unknown"
      );
    }
    if (b.readUInt16LE(0) === 0x5a4d && n > 64) {
      const pe = b.readUInt32LE(60);
      if (pe + 6 <= n && b.toString("ascii", pe, pe + 2) === "PE")
        return (
          (
            { 0x8664: "x64", 0xaa64: "arm64", 0x14c: "ia32" } as Record<
              number,
              string
            >
          )[b.readUInt16LE(pe + 4)] || "unknown"
        );
    }
    const magic = b.readUInt32BE(0);
    if (magic === 0xcafebabe || magic === 0xcafebabf) return "universal";
    if ([0xcffaedfe, 0xcefaedfe].includes(magic))
      return b.readUInt32LE(4) === 0x100000c
        ? "arm64"
        : b.readUInt32LE(4) === 0x1000007
          ? "x64"
          : "unknown";
    return b.toString("ascii", 0, 2) === "#!" ? "script" : "unknown";
  } catch {
    return "unknown";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
export interface ToolReport {
  name: string;
  detected: boolean;
  source: string;
  path: string;
  executable: string;
  version: string;
  architecture: string;
  target: string;
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  probeStatus: string;
}
export interface ToolOptions {
  env?: NodeJS.ProcessEnv;
  configured?: Record<string, string>;
  sources?: Record<string, string>;
  directories?: string[];
  trusted?: boolean;
}
const specs: { name: string; names: string[]; args: string[] }[] = [
  ...[
    "cmake",
    "ninja",
    "make",
    "arm-none-eabi-gcc",
    "arm-none-eabi-g++",
    "arm-none-eabi-as",
    "arm-none-eabi-ld",
    "arm-none-eabi-gdb",
    "arm-none-eabi-objcopy",
    "arm-none-eabi-objdump",
    "arm-none-eabi-size",
    "openocd",
    "st-info",
    "st-flash",
    "pyocd",
    "dfu-util",
    "clang",
    "lldb",
    "gdb",
    "git",
  ].map((name) => ({ name, names: [name], args: ["--version"] })),
  {
    name: "STM32CubeProgrammer",
    names: ["STM32_Programmer_CLI"],
    args: ["--version"],
  },
  {
    name: "J-Link",
    names:
      os.platform() === "win32" ? ["JLink.exe", "JLinkExe.exe"] : ["JLinkExe"],
    args: ["-?"],
  },
  { name: "Python", names: ["python3", "python", "py"], args: ["--version"] },
  ...["bash", "zsh", "fish"].map((name) => ({
    name,
    names: [name],
    args: ["--version"],
  })),
  {
    name: "PowerShell",
    names: ["pwsh", "powershell"],
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$PSVersionTable.PSVersion.ToString()",
    ],
  },
  { name: "cmd", names: ["cmd.exe"], args: ["/d", "/c", "ver"] },
];
const cache = new Map<string, { time: number; value: ToolReport }>();
export async function collectTools(
  options: ToolOptions = {},
): Promise<ToolReport[]> {
  const results: ToolReport[] = [];
  const knownDirectories =
    os.platform() === "darwin"
      ? [
          path.join("/opt", "homebrew", "bin"),
          path.join("/usr", "local", "bin"),
          path.join("/Applications", "SEGGER", "JLink"),
          path.join(
            "/Applications",
            "STMicroelectronics",
            "STM32Cube",
            "STM32CubeProgrammer",
            "STM32CubeProgrammer.app",
            "Contents",
            "MacOs",
            "bin",
          ),
        ]
      : os.platform() === "win32"
        ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
            .filter((value): value is string => Boolean(value))
            .flatMap((root) => [
              path.join(root, "SEGGER", "JLink"),
              path.join(
                root,
                "STMicroelectronics",
                "STM32Cube",
                "STM32CubeProgrammer",
                "bin",
              ),
              path.join(root, "CMake", "bin"),
            ])
        : [
            path.join("/usr", "local", "bin"),
            path.join("/opt", "SEGGER", "JLink"),
          ];
  let index = 0;
  const worker = async (): Promise<void> => {
    while (index < specs.length) {
      const spec = specs[index++];
      const configured = options.configured?.[spec.name];
      let file = configured
        ? path.isAbsolute(configured)
          ? configured
          : resolveExecutable(configured, options.env)
        : "";
      let source = configured
        ? options.sources?.[spec.name] || "configuration QC1"
        : "PATH";
      if (!configured)
        for (const name of spec.names) {
          file = resolveExecutable(name, options.env);
          if (file) break;
          for (const dir of [
            ...(options.directories || []),
            ...knownDirectories,
          ]) {
            const candidate = path.join(
              dir,
              os.platform() === "win32" && !/\.exe$/i.test(name)
                ? `${name}.exe`
                : name,
            );
            if (executableExists(candidate)) {
              file = candidate;
              source = "installation connue / extension";
              break;
            }
          }
          if (file) break;
        }
      const detected = Boolean(file && executableExists(file));
      let signature = "";
      try {
        const stat = fs.statSync(file);
        signature = `${stat.size}:${stat.mtimeMs}`;
      } catch {
        /* absent */
      }
      const key = JSON.stringify([
        file,
        signature,
        spec.name,
        spec.args,
        source,
        options.env,
        options.trusted,
      ]);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.time < 15000) {
        results.push(cached.value);
        continue;
      }
      const processResult =
        detected && options.trusted !== false
          ? await runProcess(file, spec.args, { env: options.env })
          : undefined;
      const target =
        detected &&
        spec.name === "arm-none-eabi-gcc" &&
        options.trusted !== false
          ? await runProcess(file, ["-dumpmachine"], { env: options.env })
          : undefined;
      const result: ToolReport = {
        name: spec.name,
        detected,
        source: detected || configured ? source : "introuvable",
        path: file || configured || "",
        executable: file,
        version: processResult
          ? `${processResult.stdout}\n${processResult.stderr}`
              .trim()
              .split(/\r?\n/)[0]
              ?.slice(0, 300) || "unknown"
          : "unknown",
        architecture: file ? executableArchitecture(file) : "unknown",
        target: target?.stdout.trim() || "unknown",
        exitCode: processResult?.exitCode ?? null,
        stderr: `${processResult?.error || ""}\n${processResult?.stderr || ""}`
          .trim()
          .slice(0, 1000),
        timedOut: processResult?.timedOut || false,
        probeStatus:
          options.trusted === false
            ? "not-run: untrusted workspace"
            : processResult
              ? processResult.exitCode === 0
                ? "ok"
                : "failed"
              : "not-found",
      };
      if (cache.size > 128) cache.clear();
      cache.set(key, { time: Date.now(), value: result });
      results.push(result);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
