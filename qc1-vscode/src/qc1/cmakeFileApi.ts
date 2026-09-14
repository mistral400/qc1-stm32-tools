/** Consume existing CMake File API replies; diagnostic collection never creates queries. */
import * as fs from "fs";
import * as path from "path";
import { inside, readText } from "./filesystem";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export interface ConfiguredTarget {
  name: string;
  configuration: string;
  type: string;
  artifacts: string[];
  sources: string[];
  includes: string[];
  definitions: string[];
  fragments: string[];
}
export interface FileApiSnapshot {
  status: string;
  source: string;
  build: string;
  generator: string;
  targets: ConfiguredTarget[];
  toolchains: Record<string, unknown>[];
}
export function readFileApi(
  buildDirectory: string,
  projectRoot: string,
): FileApiSnapshot {
  const result: FileApiSnapshot = {
    status: "unavailable",
    source: "",
    build: buildDirectory,
    generator: "unknown",
    targets: [],
    toolchains: [],
  };
  const reply = path.join(buildDirectory, ".cmake", "api", "v1", "reply");
  const load = (name: string): Record<string, unknown> => {
    if (!name || path.basename(name) !== name || !/\.json$/.test(name))
      return {};
    const file = path.join(reply, name);
    try {
      if (!inside(fs.realpathSync(reply), fs.realpathSync(file))) return {};
      return object(JSON.parse(readText(file, 2 * 1024 * 1024)));
    } catch {
      return {};
    }
  };
  try {
    const indexName = fs
      .readdirSync(reply)
      .filter((n) => /^index-.*\.json$/.test(n))
      .sort()
      .at(-1);
    if (!indexName) return result;
    const index = load(indexName);
    result.generator =
      str(object(object(index.cmake).generator).name) || "unknown";
    for (const ref of array(index.objects).slice(0, 20)) {
      const major = object(ref.version).major;
      if (ref.kind === "toolchains" && major === 1) {
        result.toolchains = array(load(str(ref.jsonFile)).toolchains).map(
          (tool) => {
            const compiler = object(tool.compiler);
            return {
              language: tool.language,
              compiler: {
                path: compiler.path,
                id: compiler.id,
                version: compiler.version,
                target: compiler.target,
              },
            };
          },
        );
      }
      if (ref.kind !== "codemodel" || major !== 2) continue;
      const model = load(str(ref.jsonFile)),
        paths = object(model.paths);
      result.source = str(paths.source);
      result.build = str(paths.build) || buildDirectory;
      if (path.resolve(result.source) !== path.resolve(projectRoot)) {
        result.status = "stale: source directory differs";
        continue;
      }
      result.status = "previous configure (may be stale)";
      for (const config of array(model.configurations).slice(0, 8))
        for (const reference of array(config.targets).slice(0, 100)) {
          const target = load(str(reference.jsonFile));
          const groups = array(target.compileGroups);
          result.targets.push({
            name: str(target.name),
            configuration: str(config.name),
            type: str(target.type),
            artifacts: array(target.artifacts).map((a) =>
              path.resolve(result.build, str(a.path)),
            ),
            sources: array(target.sources)
              .map((s) => path.resolve(projectRoot, str(s.path)))
              .slice(0, 1000),
            includes: groups
              .flatMap((g) => array(g.includes).map((i) => str(i.path)))
              .slice(0, 500),
            definitions: groups
              .flatMap((g) => array(g.defines).map((d) => str(d.define)))
              .slice(0, 500),
            fragments: [
              ...groups.flatMap((g) => array(g.compileCommandFragments)),
              ...array(object(target.link).commandFragments),
            ]
              .map((f) => str(f.fragment))
              .slice(0, 500),
          });
        }
    }
  } catch {
    result.status = "unavailable: invalid or inaccessible reply";
  }
  return result;
}
