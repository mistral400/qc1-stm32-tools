/** Evidence-based linker/MCU/include analysis; no inferred chip capacities from vague names. */
import * as fs from "fs";
import * as path from "path";
import { Qc1ProjectInspection } from "./projectDiscovery";
import {
  checkSpelling,
  finding,
  Finding,
  inside,
  readText,
} from "./filesystem";
import { readFileApi } from "./cmakeFileApi";

export function inspectLinker(file: string): Record<string, unknown> {
  let size: number | null = null;
  try {
    size = fs.statSync(file).size;
  } catch {
    /* report absent */
  }
  const text = readText(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const memory = text.match(/\bMEMORY\s*\{([^}]+)\}/)?.[1] || "";
  const regions = [
    ...memory.matchAll(
      /([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*ORIGIN\s*=\s*([^,\n]+),\s*LENGTH\s*=\s*([^\n}]+)/gi,
    ),
  ].map((m) => ({ name: m[1], origin: m[2].trim(), length: m[3].trim() }));
  return {
    path: file,
    name: path.basename(file),
    exists: size !== null,
    sizeBytes: size,
    mcuHint: path.basename(file).match(/stm32[a-z0-9]+/i)?.[0] || "unknown",
    memory: regions,
    flash: regions.filter((r) => /flash|rom/i.test(r.name)),
    ram: regions.filter((r) => /ram/i.test(r.name)),
  };
}
export function inspectProjectDetails(
  project: Qc1ProjectInspection,
  configuredMcu = "",
  buildDirectory = path.join(project.root, "build", "qc1"),
): {
  structure: Record<string, unknown>;
  mcu: Record<string, unknown>;
  cmake: Record<string, unknown>;
  findings: Finding[];
  tree: string;
} {
  const findings = [...project.findings];
  const configured = readFileApi(buildDirectory, project.root);
  const evidence: { value: string; source: string }[] = [];
  const addEvidence = (text: string, source: string): void => {
    for (const m of text.matchAll(
      /(?:^|[^a-z0-9])stm32([a-z]\d{3})([a-z0-9]*)(?=$|[^a-z0-9])/gi,
    ))
      evidence.push({ value: `STM32${m[1]}${m[2]}`.toUpperCase(), source });
  };
  addEvidence(configuredMcu, "configuration QC1");
  for (const file of [
    ...project.startupCandidates,
    ...project.linkerCandidates,
  ])
    addEvidence(path.basename(file), file);
  for (const define of project.cmake.definitions)
    addEvidence(define, "CMake definitions");
  for (const target of configured.targets)
    for (const define of target.definitions)
      addEvidence(define, `Configured target ${target.name}`);
  addEvidence(project.cmake.flags.join(" "), "CMake flags");
  addEvidence(project.projectName, "project name (weak evidence)");
  for (const marker of project.markers.filter((f) => /\.ioc$/i.test(f))) {
    const ioc = readText(marker);
    for (const line of ioc
      .split(/\r?\n/)
      .filter((l) => /^Mcu\.(Name|CPN|Family)=/.test(l)))
      addEvidence(line, marker);
  }
  // Read only bounded local source/header prefixes for macros and quoted includes, never report content.
  let budget = 2 * 1024 * 1024;
  let checked = 0;
  for (const file of project.scan.files
    .filter((f) => /\.(c|h|cpp|hpp|s)$/i.test(f))
    .slice(0, 300)) {
    if (budget <= 0) break;
    const text = readText(file, Math.min(budget, 65536));
    budget -= Buffer.byteLength(text);
    checked++;
    for (const line of text
      .split(/\r?\n/)
      .filter((l) => /^\s*#\s*define\s+STM32\w+(?:\s|$)/i.test(l)))
      addEvidence(line, file);
    for (const match of text.matchAll(/^\s*#\s*include\s*"([^"\r\n]+)"/gm)) {
      const include = match[1];
      if (/\$|[<>]/.test(include)) continue;
      const candidates = [path.dirname(file), ...project.cmake.includes]
        .map((dir) => path.resolve(dir, include))
        .filter((p) => inside(project.root, p));
      if (
        candidates.some((candidate) => {
          const s = checkSpelling(candidate);
          return s.exists && !s.mismatch;
        })
      )
        continue;
      const mismatch = candidates
        .map(checkSpelling)
        .find((s) => s.mismatch && fs.existsSync(s.actual));
      if (mismatch) {
        const issue = finding(
          "QC1-PATH-002",
          "CASE_MISMATCH",
          `Include demandé: ${include}; réel: ${mismatch.actual}`,
          file,
          "warning",
          "filesystem",
        );
        issue.evidence = mismatch.actual;
        issue.suggestion = "Corriger la casse de l'include.";
        findings.push(issue);
      }
    }
  }
  const strong = evidence.filter((e) => !e.source.includes("weak"));
  const series = [...new Set(strong.map((e) => e.value.slice(0, 9)))];
  const exact = [
    ...new Set(
      strong
        .map((e) => e.value)
        .filter((v) => /^STM32[A-Z]\d{3}[A-WYZ]\d[A-Z]\d/.test(v)),
    ),
  ];
  if (series.length > 1 || exact.length > 1)
    findings.push({
      ...finding(
        "QC1-MCU-001",
        "MCU_CONFLICT",
        "Plusieurs cibles MCU incompatibles dans les preuves.",
        project.root,
        "warning",
        "mcu",
      ),
      evidence: JSON.stringify(strong),
    });
  const flags = [
    ...project.cmake.flags,
    ...Object.entries(project.cmake.cache)
      .filter(([k]) => /FLAGS/.test(k))
      .map(([, v]) => v),
  ].join(" ");
  const cortex = [
    ...new Set([...flags.matchAll(/-mcpu=([^\s;]+)/g)].map((m) => m[1])),
  ];
  const fpu = [
    ...new Set([...flags.matchAll(/-mfpu=([^\s;]+)/g)].map((m) => m[1])),
  ];
  const compiler = project.cmake.cache.CMAKE_C_COMPILER;
  if (compiler && !/arm-none-eabi|clang/i.test(compiler) && strong.length)
    findings.push(
      finding(
        "QC1-CMAKE-005",
        "HOST_COMPILER_SUSPECTED",
        "Le cache sélectionne un compilateur sans indication ARM; confirmer sa cible.",
        compiler,
        "warning",
        "toolchain",
      ),
    );
  const linker = project.linkerCandidates.map(inspectLinker);
  const count = (pattern: RegExp): number =>
    project.scan.files.filter((f) => pattern.test(f)).length;
  const relevant = project.scan.files.filter((f) =>
    /\.(c|h|cpp|cc|cxx|hpp|s|asm|ld|cmake|ioc|ini)$|(?:CMakeLists\.txt|Makefile|\.cproject|\.project)$/i.test(
      f,
    ),
  );
  return {
    findings,
    structure: {
      c: count(/\.c$/i),
      h: count(/\.h$/i),
      cpp: count(/\.(cpp|cc|cxx)$/i),
      asm: count(/\.(s|asm)$/i),
      directories: project.scan.directories,
      files: project.scan.files.length,
      bytes: project.scan.bytes,
      truncated: project.scan.truncated,
      scope: "Project excluding build, caches, dependencies, external symlinks",
      includesChecked: checked,
    },
    mcu: {
      family: series.map((s) => s.slice(0, 7)),
      series,
      exact: exact.length === 1 ? exact[0] : "unknown",
      cortex: cortex.length ? cortex : "unknown",
      fpu: fpu.length ? fpu : "unknown",
      expectedFlash: "unknown (see linker MEMORY, not silicon validation)",
      expectedRam: "unknown (see linker MEMORY, not silicon validation)",
      evidence: strong.slice(0, 100),
      linker,
    },
    cmake: {
      ...project.cmake,
      variables: undefined,
      configured,
      linker,
      mainTarget:
        project.cmake.executableTargets.length === 1
          ? project.cmake.executableTargets[0]
          : "unknown/ambiguous",
      note: "Static analysis; conditional branches, functions, generator expressions and generated files may be unresolved. Cache is previous configure evidence.",
    },
    tree:
      relevant
        .slice(0, 400)
        .map((file) => path.relative(project.root, file))
        .join("\n") + (relevant.length > 400 ? "\n[truncated]" : ""),
  };
}
