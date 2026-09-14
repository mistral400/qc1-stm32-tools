/** Inventory from public API plus known extension directories, including inactive manifests. */
import * as fs from "fs";
import * as path from "path";
import { readText } from "./filesystem";

export function completeExtensionInventory(
  visible: Record<string, unknown>[],
): Record<string, unknown>[] {
  const result = [...visible];
  const seen = new Set(visible.map((entry) => String(entry.path)));
  const roots = [
    ...new Set(
      visible
        .map((entry) =>
          typeof entry.path === "string" ? path.dirname(entry.path) : "",
        )
        .filter((root) => path.basename(root) === "extensions"),
    ),
  ];
  for (const root of roots.slice(0, 8)) {
    try {
      for (const entry of fs
        .readdirSync(root, { withFileTypes: true })
        .slice(0, 1000)) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root, entry.name);
        if (seen.has(directory)) continue;
        try {
          const raw: unknown = JSON.parse(
            readText(path.join(directory, "package.json")),
          );
          if (!raw || typeof raw !== "object") continue;
          const manifest = raw as Record<string, unknown>;
          if (
            typeof manifest.name !== "string" ||
            typeof manifest.publisher !== "string" ||
            typeof manifest.version !== "string"
          )
            continue;
          const id = `${manifest.publisher}.${manifest.name}`;
          result.push({
            id,
            name: manifest.displayName || manifest.name,
            version: manifest.version,
            path: directory,
            active: false,
            enabled:
              "unknown (manifest on disk, may be disabled, obsolete or belong to another profile)",
            kind: "unknown",
            source: "known extension directory",
            relevant:
              /cmake|cortex|embedded|platformio|stm32|clang|cpptools|serial|gitlens|arm|openocd|stlink/i.test(
                id,
              ),
          });
          seen.add(directory);
        } catch {
          /* An unreadable/incomplete manifest cannot be classified as installed. */
        }
      }
    } catch {
      /* A remote/UI extension directory may not exist on this extension host. */
    }
  }
  return result.sort(
    (a, b) =>
      String(a.id).localeCompare(String(b.id)) ||
      String(a.version).localeCompare(String(b.version)),
  );
}
