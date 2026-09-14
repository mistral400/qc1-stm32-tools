/** Read-only OS/USB/serial inventory. Only allowlisted device fields leave this module. */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { readText } from "./filesystem";
import { resolveExecutable, runProcess } from "./processTools";

export interface Device {
  name: string;
  type: string;
  vid: string;
  pid: string;
  manufacturer: string;
  product: string;
  serial: string;
  accessible: string;
  firmware: string;
}
export function probeType(text: string): string {
  if (/st-?link/i.test(text)) return "ST-Link";
  if (/j-?link|segger/i.test(text)) return "J-Link";
  if (/daplink/i.test(text)) return "DAPLink";
  if (/cmsis.?dap/i.test(text)) return "CMSIS-DAP";
  if (/dfu/i.test(text)) return "DFU";
  return "unknown";
}
export function parseOsRelease(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(ID|NAME|PRETTY_NAME|VERSION|VERSION_ID)=(.*)$/);
    if (m) result[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return result;
}
export function classifyEnvironment(
  platform: string,
  release: string,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  return {
    wsl: /microsoft|wsl/i.test(release) || Boolean(env.WSL_DISTRO_NAME),
    ssh: Boolean(env.SSH_CONNECTION || env.SSH_TTY),
    container:
      platform === "linux" &&
      Boolean(
        env.container ||
        fs.existsSync("/.dockerenv") ||
        /docker|kubepods|containerd/.test(readText("/proc/1/cgroup")),
      ),
    desktop:
      Boolean(env.DISPLAY || env.WAYLAND_DISPLAY) ||
      platform === "darwin" ||
      platform === "win32",
    shell: path.basename(env.SHELL || env.ComSpec || env.COMSPEC || "unknown"),
  };
}
export async function inspectSystem(): Promise<Record<string, unknown>> {
  const platform = os.platform();
  let version = os.version();
  let physicalArchitecture = os.machine();
  let translated: boolean | string = "unknown";
  if (platform === "darwin") {
    const result = await runProcess("/usr/bin/sw_vers", ["-productVersion"]);
    version = result.exitCode === 0 ? result.stdout.trim() : "unknown";
    const arm = await runProcess("/usr/sbin/sysctl", [
      "-n",
      "hw.optional.arm64",
    ]);
    if (arm.exitCode === 0)
      physicalArchitecture = arm.stdout.trim() === "1" ? "arm64" : "x64";
    const translation = await runProcess("/usr/sbin/sysctl", [
      "-n",
      "sysctl.proc_translated",
    ]);
    if (translation.exitCode === 0)
      translated = translation.stdout.trim() === "1";
  }
  return {
    platform,
    version,
    kernel: os.release(),
    architecture: os.arch(),
    physicalArchitecture,
    translated,
    cpu:
      platform === "darwin"
        ? physicalArchitecture === "arm64"
          ? "Apple Silicon"
          : "Intel"
        : "unknown",
    processArchitecture: process.arch,
    distribution:
      platform === "linux"
        ? parseOsRelease(readText("/etc/os-release", 16384))
        : "not applicable",
    hostname: "<HOSTNAME>",
    environment: classifyEnvironment(platform, os.release(), process.env),
  };
}
export function serialNames(platform: string, names: string[]): string[] {
  const pattern =
    platform === "darwin"
      ? /^(cu|tty)\./
      : platform === "linux"
        ? /^tty(?:USB|ACM)\d+$/
        : /^COM\d+$/i;
  return names.filter((n) => pattern.test(n)).sort();
}
function access(file: string): string {
  try {
    fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK);
    return "read/write permitted (device not opened)";
  } catch {
    return "permission denied or absent";
  }
}
function device(
  name: string,
  product = name,
  vid = "unknown",
  pid = "unknown",
  manufacturer = "unknown",
): Device {
  return {
    name,
    type: probeType(`${name} ${product} ${manufacturer}`),
    product,
    vid,
    pid,
    manufacturer,
    serial: "<REDACTED>",
    accessible: "unknown",
    firmware: "unknown",
  };
}
export async function inspectDevices(
  trusted = true,
): Promise<{
  usb: Device[];
  serial: Device[];
  permissions: Record<string, unknown>;
  errors: string[];
}> {
  const result = {
    usb: [] as Device[],
    serial: [] as Device[],
    permissions: {} as Record<string, unknown>,
    errors: [] as string[],
  };
  const platform = os.platform();
  if (platform !== "win32") {
    try {
      result.serial = serialNames(platform, fs.readdirSync("/dev"))
        .slice(0, 100)
        .map((n) => ({
          ...device(path.join("/dev", n)),
          accessible: access(path.join("/dev", n)),
        }));
    } catch {
      result.errors.push("Serial directory unavailable");
    }
  }
  if (platform === "linux") {
    try {
      const sysRoot = path.join("/sys", "bus", "usb", "devices");
      for (const name of fs.readdirSync(sysRoot).slice(0, 256)) {
        const dir = path.join(sysRoot, name);
        const value = (field: string): string =>
          readText(path.join(dir, field), 4096).trim();
        const vid = value("idVendor"),
          pid = value("idProduct");
        if (!vid) continue;
        const d = device(
          value("product") || "USB device",
          value("product"),
          vid,
          pid,
          value("manufacturer"),
        );
        const bus = value("busnum"),
          dev = value("devnum");
        d.accessible =
          /^\d+$/.test(bus) && /^\d+$/.test(dev)
            ? access(
                path.join(
                  "/dev",
                  "bus",
                  "usb",
                  bus.padStart(3, "0"),
                  dev.padStart(3, "0"),
                ),
              )
            : "unknown";
        result.usb.push(d);
      }
      for (const port of result.serial) {
        let parent = fs.realpathSync(
          path.join("/sys", "class", "tty", path.basename(port.name), "device"),
        );
        for (let depth = 0; depth < 6; depth++) {
          const vid = readText(path.join(parent, "idVendor"), 32).trim();
          if (vid) {
            port.vid = vid;
            port.pid = readText(path.join(parent, "idProduct"), 32).trim();
            port.manufacturer = readText(
              path.join(parent, "manufacturer"),
              4096,
            ).trim();
            port.product = readText(path.join(parent, "product"), 4096).trim();
            break;
          }
          parent = path.dirname(parent);
        }
      }
    } catch {
      result.errors.push("USB sysfs inventory partially unavailable");
    }
    const rules: string[] = [];
    for (const dir of [
      path.join("/etc", "udev", "rules.d"),
      path.join("/usr", "lib", "udev", "rules.d"),
      path.join("/lib", "udev", "rules.d"),
    ]) {
      try {
        for (const name of fs.readdirSync(dir).slice(0, 300))
          if (/stlink|st-link|openocd|jlink|dap|dfu|probe/i.test(name))
            rules.push(path.join(dir, name));
      } catch {
        /* optional location */
      }
    }
    result.permissions = {
      usbDirectoryPresent: fs.existsSync(path.join("/dev", "bus", "usb")),
      udevRules: rules,
      udevNote: "Filename evidence only; effective rules not inferred.",
      groupIds: process.getgroups?.() || [],
    };
  } else if (trusted && platform === "darwin") {
    const usb = await runProcess(
      "/usr/sbin/system_profiler",
      ["SPUSBDataType", "-json"],
      { timeoutMs: 6000, maxBytes: 1024 * 1024 },
    );
    if (usb.exitCode === 0 && !usb.truncated) {
      try {
        const visit = (value: unknown, depth = 0): void => {
          if (
            depth > 16 ||
            result.usb.length >= 256 ||
            !value ||
            typeof value !== "object"
          )
            return;
          if (Array.isArray(value)) {
            value.forEach((v) => visit(v, depth + 1));
            return;
          }
          const row = value as Record<string, unknown>;
          const str = (key: string): string =>
            typeof row[key] === "string" ? (row[key] as string) : "unknown";
          if (row.vendor_id || row.product_id)
            result.usb.push(
              device(
                str("_name"),
                str("_name"),
                str("vendor_id"),
                str("product_id"),
                str("manufacturer"),
              ),
            );
          Object.values(row).forEach((v) => {
            if (typeof v === "object") visit(v, depth + 1);
          });
        };
        visit(JSON.parse(usb.stdout));
      } catch {
        result.errors.push("USB inventory JSON invalid");
      }
    } else result.errors.push("USB system_profiler failed or timed out");
  } else if (trusted && platform === "win32") {
    const shell =
      resolveExecutable("powershell.exe") || resolveExecutable("pwsh.exe");
    if (shell) {
      // Fixed script, no user input; PNP identifiers are reduced to VID/PID immediately.
      const query =
        "@{usb=@(Get-CimInstance Win32_PnPEntity -Filter \"PNPDeviceID LIKE 'USB%'\" | Select-Object Name,Manufacturer,PNPDeviceID,Status);serial=@(Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Name,PNPDeviceID,Status)} | ConvertTo-Json -Depth 4 -Compress";
      const reply = await runProcess(
        shell,
        ["-NoProfile", "-NonInteractive", "-Command", query],
        { timeoutMs: 6000 },
      );
      try {
        const parsed: unknown = JSON.parse(reply.stdout);
        if (parsed && typeof parsed === "object")
          for (const category of ["usb", "serial"] as const) {
            const rows = (parsed as Record<string, unknown>)[category];
            if (!Array.isArray(rows)) continue;
            for (const raw of rows.slice(0, 256)) {
              if (!raw || typeof raw !== "object") continue;
              const row = raw as Record<string, unknown>;
              const id = String(row.PNPDeviceID || "");
              const d = device(
                String(
                  category === "serial"
                    ? row.DeviceID || "unknown"
                    : row.Name || "unknown",
                ),
                String(row.Name || "unknown"),
                id.match(/VID_([0-9a-f]{4})/i)?.[1] || "unknown",
                id.match(/PID_([0-9a-f]{4})/i)?.[1] || "unknown",
                String(row.Manufacturer || "unknown"),
              );
              d.accessible =
                row.Status === "OK" ? "OS status OK (not opened)" : "unknown";
              result[category].push(d);
            }
          }
      } catch {
        result.errors.push("Windows CIM inventory unavailable");
      }
    } else result.errors.push("PowerShell unavailable");
  }
  return result;
}
