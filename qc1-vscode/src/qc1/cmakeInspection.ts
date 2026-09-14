/** Static CMake evidence only: never configure/execute project code during diagnosis. */
import * as path from "path";
import * as fs from "fs";
import {
  checkSpelling,
  finding,
  Finding,
  inside,
  readText,
} from "./filesystem";

interface Command {
  name: string;
  args: string[];
}
export interface CmakeInspection {
  mode: "static";
  files: string[];
  projectName: string;
  targets: string[];
  executableTargets: string[];
  sources: string[];
  includes: string[];
  definitions: string[];
  flags: string[];
  libraries: string[];
  linkerScripts: string[];
  variables: Record<string, string[]>;
  cache: Record<string, string>;
  unresolved: string[];
  findings: Finding[];
}
// Quoted and bracket arguments remain whole, including spaces and parentheses.
export function parseCmake(text: string): {
  commands: Command[];
  invalid: boolean;
} {
  const commands: Command[] = [];
  let i = 0;
  const skip = (): void => {
    while (i < text.length) {
      if (/\s/.test(text[i])) {
        i++;
        continue;
      }
      if (text[i] !== "#") break;
      const bracket = text.slice(i + 1).match(/^\[(=*)\[/);
      if (bracket) {
        const end = text.indexOf(`]${bracket[1]}]`, i + 1 + bracket[0].length);
        i = end < 0 ? text.length : end + bracket[1].length + 2;
      } else {
        const end = text.indexOf("\n", i);
        i = end < 0 ? text.length : end;
      }
    }
  };
  while (i < text.length) {
    skip();
    if (i >= text.length) break;
    const name = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (!name) return { commands, invalid: true };
    i += name.length;
    skip();
    if (text[i++] !== "(") return { commands, invalid: true };
    const args: string[] = [];
    let depth = 1;
    while (i < text.length && depth) {
      skip();
      if (text[i] === ")") {
        depth--;
        i++;
        continue;
      }
      if (text[i] === "(") {
        depth++;
        i++;
        continue;
      }
      if (i >= text.length) break;
      let token = "";
      const bracket = text.slice(i).match(/^\[(=*)\[/);
      if (bracket) {
        i += bracket[0].length;
        const end = text.indexOf(`]${bracket[1]}]`, i);
        if (end < 0) return { commands, invalid: true };
        token = text.slice(i, end);
        i = end + bracket[1].length + 2;
      } else if (text[i] === '"') {
        i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === "\\" && /["\\;]/.test(text[i + 1] || "")) i++;
          token += text[i++];
        }
        if (i >= text.length) return { commands, invalid: true };
        i++;
      } else {
        while (i < text.length && !/[\s()]/.test(text[i])) token += text[i++];
      }
      if (token) args.push(token);
    }
    if (depth) return { commands, invalid: true };
    commands.push({ name: name.toLowerCase(), args });
  }
  return { commands, invalid: false };
}
function globRegex(pattern: string, recursive: boolean): RegExp {
  const normalized = pattern.split(path.sep).join("/");
  let source = "";
  for (const char of normalized)
    source +=
      char === "*"
        ? "[^/]*"
        : char === "?"
          ? "[^/]"
          : char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  if (recursive) {
    const last = source.lastIndexOf("/");
    source = source.slice(0, last + 1) + "(?:.*/)?" + source.slice(last + 1);
  }
  return new RegExp(`^${source}$`);
}
export function inspectCmake(
  root: string,
  projectFiles: string[],
  buildDirectory = path.join(root, "build", "qc1"),
): CmakeInspection {
  const result: CmakeInspection = {
    mode: "static",
    files: [],
    projectName: "firmware",
    targets: [],
    executableTargets: [],
    sources: [],
    includes: [],
    definitions: [],
    flags: [],
    libraries: [],
    linkerScripts: [],
    variables: {},
    cache: {},
    unresolved: [],
    findings: [],
  };
  if (!root) return result;
  const seen = new Set<string>();
  const addPath = (raw: string, base: string, output: string[]): void => {
    if (!raw || /\$|[<>]/.test(raw)) {
      if (raw) result.unresolved.push(raw);
      return;
    }
    const requested = path.resolve(base, raw);
    output.push(requested);
    if (!inside(root, requested)) {
      result.unresolved.push(`External reference: ${requested}`);
      return;
    }
    const spelling = checkSpelling(requested);
    if (spelling.mismatch) {
      const issue = finding(
        "QC1-PATH-001",
        "CASE_MISMATCH",
        `Demandé: ${requested}; réel: ${spelling.actual}`,
        requested,
        "warning",
        "filesystem",
      );
      issue.evidence = spelling.actual;
      issue.suggestion = "Utiliser la casse exacte du chemin réel dans CMake.";
      result.findings.push(issue);
    } else if (!spelling.exists)
      result.findings.push(
        finding(
          "QC1-CMAKE-002",
          "REFERENCE_NOT_FOUND",
          "Référence absente; peut être générée ou appartenir à une branche CMake inactive.",
          requested,
          "warning",
          "cmake",
        ),
      );
  };
  const visit = (
    file: string,
    variables: Record<string, string[]>,
    depth: number,
  ): void => {
    if (depth > 12 || seen.size >= 100 || !inside(root, file)) {
      result.unresolved.push(file);
      return;
    }
    let real: string;
    try {
      real = fs.realpathSync(file);
    } catch {
      return;
    }
    if (!inside(fs.realpathSync(root), real) || seen.has(real)) return;
    seen.add(real);
    result.files.push(file);
    const parsed = parseCmake(readText(file));
    if (parsed.invalid)
      result.findings.push(
        finding(
          "QC1-CMAKE-001",
          "CMAKE_PARSE_INCOMPLETE",
          "Syntaxe invalide ou non prise en charge par l'analyse statique.",
          file,
          "warning",
          "cmake",
        ),
      );
    const base = path.dirname(file);
    variables.CMAKE_CURRENT_SOURCE_DIR = [base];
    variables.CMAKE_CURRENT_LIST_DIR = [base];
    variables.CMAKE_SOURCE_DIR = [root];
    variables.PROJECT_SOURCE_DIR = [root];
    variables.CMAKE_BINARY_DIR = [buildDirectory];
    variables.PROJECT_BINARY_DIR = [buildDirectory];
    const expand = (token: string): string[] => {
      let value = token;
      for (let pass = 0; pass < 12; pass++) {
        const next = value.replace(
          /\$\{([^}]+)\}/g,
          (match, key: string) => variables[key]?.join(";") ?? match,
        );
        if (next === value || next.length > 65536) break;
        value = next;
      }
      if (/\$/.test(value)) result.unresolved.push(value);
      return value.split(";").filter(Boolean);
    };
    let conditional = 0;
    for (const command of parsed.commands) {
      const a = command.args.flatMap(expand);
      const data = a.filter(
        (item) => !/^(PRIVATE|PUBLIC|INTERFACE|BEFORE|SYSTEM)$/.test(item),
      );
      if (/^(if|foreach|while|function|macro)$/.test(command.name)) {
        conditional++;
        result.unresolved.push(
          `${command.name}(): branches/scopes not evaluated in ${file}`,
        );
      }
      if (
        /^(endif|endforeach|endwhile|endfunction|endmacro)$/.test(command.name)
      )
        conditional = Math.max(0, conditional - 1);
      if (command.name === "set" && a[0]) {
        const end = a.indexOf("CACHE");
        variables[a[0]] = a
          .slice(1, end < 0 ? undefined : end)
          .filter((v) => v !== "PARENT_SCOPE");
      }
      if (command.name === "list" && a[0] === "APPEND" && a[1])
        variables[a[1]] = [...(variables[a[1]] || []), ...a.slice(2)];
      if (command.name === "project" && a[0]) {
        if (depth === 0) result.projectName = a[0];
        variables.PROJECT_NAME = [a[0]];
      }
      if (
        command.name === "file" &&
        /^(GLOB|GLOB_RECURSE)$/.test(a[0]) &&
        a[1]
      ) {
        const matches = new Set<string>();
        for (const pattern of a
          .slice(2)
          .filter((v) => /[*?]/.test(v) && !/\$/.test(v))) {
          const regex = globRegex(
            path.resolve(base, pattern),
            a[0] === "GLOB_RECURSE",
          );
          for (const candidate of projectFiles)
            if (regex.test(candidate.split(path.sep).join("/")))
              matches.add(candidate);
        }
        variables[a[1]] = [...matches];
        if (a.includes("RELATIVE"))
          result.unresolved.push(
            `file(${a[0]} RELATIVE): paths reported as absolute`,
          );
      }
      if (command.name === "add_subdirectory" && a[0] && !/\$/.test(a[0]))
        visit(
          path.join(path.resolve(base, a[0]), "CMakeLists.txt"),
          { ...variables },
          depth + 1,
        );
      if (command.name === "include" && a[0] && !/\$/.test(a[0])) {
        const include = path.resolve(
          base,
          /\.cmake$/i.test(a[0]) ? a[0] : `${a[0]}.cmake`,
        );
        if (fs.existsSync(include)) {
          visit(include, variables, depth + 1);
          variables.CMAKE_CURRENT_SOURCE_DIR = [base];
          variables.CMAKE_CURRENT_LIST_DIR = [base];
        }
      }
      if (
        /^(add_executable|add_library)$/.test(command.name) &&
        a[0] &&
        !a.includes("ALIAS") &&
        !a.includes("IMPORTED")
      ) {
        result.targets.push(a[0]);
        if (command.name === "add_executable")
          result.executableTargets.push(a[0]);
      }
      if (/^(add_executable|add_library|target_sources)$/.test(command.name))
        for (const source of data
          .slice(1)
          .filter((v) => /\.(c|cc|cxx|cpp|h|hpp|s|asm)$/i.test(v)))
          addPath(source, base, result.sources);
      if (
        /^(target_include_directories|include_directories)$/.test(command.name)
      )
        for (const include of data.slice(
          command.name.startsWith("target_") ? 1 : 0,
        ))
          addPath(include, base, result.includes);
      if (/^(target_compile_definitions|add_definitions)$/.test(command.name))
        result.definitions.push(
          ...data.slice(command.name.startsWith("target_") ? 1 : 0),
        );
      if (command.name === "target_link_libraries")
        result.libraries.push(...data.slice(1));
      const flags =
        /^(target_link_options|target_compile_options|add_compile_options|add_link_options)$/.test(
          command.name,
        )
          ? data.slice(command.name.startsWith("target_") ? 1 : 0)
          : command.name === "set" &&
              /(?:FLAGS|LINKER|SCRIPT)/i.test(a[0] || "")
            ? a.slice(1)
            : [];
      result.flags.push(...flags);
      const joined = flags
        .filter((flag) => !/^-T.+\.ld$/i.test(flag))
        .join(" ");
      for (const match of joined.matchAll(
        /(?:^|[\s,])(?:-T\s*|--script[=\s]+)(?:"([^"]+)"|'([^']+)'|([^\s,]+))/g,
      ))
        addPath(match[1] || match[2] || match[3], base, result.linkerScripts);
      // Preserve a quoted CMake argument with spaces after -T.
      for (const flag of flags)
        if (/^-T.+\.ld$/i.test(flag))
          addPath(flag.slice(2), base, result.linkerScripts);
      if (conditional)
        result.unresolved.push(
          `Conditional evidence: ${command.name} in ${file}`,
        );
    }
    Object.assign(result.variables, variables);
  };
  try {
    visit(path.join(root, "CMakeLists.txt"), {}, 0);
  } catch {
    result.findings.push(
      finding(
        "QC1-CMAKE-003",
        "CMAKE_INACCESSIBLE",
        "Inspection partielle: fichier inaccessible.",
        root,
      ),
    );
  }
  const allowedCache =
    /^(CMAKE_(GENERATOR|BUILD_TYPE|HOME_DIRECTORY|CACHEFILE_DIR|TOOLCHAIN_FILE|C_COMPILER|CXX_COMPILER|ASM_COMPILER|MAKE_PROGRAM|C_FLAGS(?:_\w+)?|CXX_FLAGS(?:_\w+)?|ASM_FLAGS(?:_\w+)?|EXE_LINKER_FLAGS(?:_\w+)?|SYSTEM_PROCESSOR)|.*_BINARY_DIR)$/;
  for (const line of readText(
    path.join(buildDirectory, "CMakeCache.txt"),
    2 * 1024 * 1024,
  ).split(/\r?\n/)) {
    const match = line.match(/^([^#/:][^:]*):[^=]+=(.*)$/);
    if (match && allowedCache.test(match[1])) result.cache[match[1]] = match[2];
  }
  for (const key of [
    "files",
    "sources",
    "includes",
    "definitions",
    "flags",
    "libraries",
    "linkerScripts",
    "targets",
    "executableTargets",
    "unresolved",
  ] as const)
    result[key] = [...new Set(result[key])];
  if (result.files.length && !result.targets.length)
    result.findings.push(
      finding(
        "QC1-CMAKE-004",
        "TARGET_UNKNOWN",
        "Aucune cible résolue statiquement; macros ou génération possibles.",
        root,
        "info",
        "cmake",
      ),
    );
  return result;
}
