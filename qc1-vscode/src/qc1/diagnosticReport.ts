/** Versioned, shareable reports. Structured redaction precedes JSON serialization. */
import { Finding } from "./filesystem";

export interface DiagnosticRedaction {
  value: string;
  replacement: string;
}

export interface DiagnosticToolReport {
  name: string;
  detected: boolean;
  source: string;
  path: string;
  version: string;
  architecture?: string;
  executable?: string;
  target?: string;
  exitCode?: number | null;
  stderr?: string;
  timedOut?: boolean;
  probeStatus?: string;
}

export interface Qc1DiagnosticReportInput {
  generatedAt: string;
  issueDescription: string;
  extension: Record<string, unknown>;
  runtime: Record<string, unknown>;
  workspace: Record<string, unknown>;
  project: Record<string, unknown>;
  configuration: Record<string, unknown>;
  dashboard: Record<string, unknown>;
  artifacts: Record<string, unknown>;
  hardware: Record<string, unknown>;
  tools: DiagnosticToolReport[];
  vscodeProblems: string[];
  gitSnapshot: string;
  projectTree: string;
  logs: string;
  system?: Record<string, unknown>;
  installedExtensions?: Record<string, unknown>[];
  structure?: Record<string, unknown>;
  mcu?: Record<string, unknown>;
  cmake?: Record<string, unknown>;
  devices?: Record<string, unknown>;
  findings?: Finding[];
}

function replaceAllLiteral(
  text: string,
  value: string,
  replacement: string,
): string {
  if (!value) return text;
  return text.split(value).join(replacement);
}

/**
 * Removes credentials and replaces machine-specific roots before a report is shared.
 * This intentionally runs over the complete final report so paths embedded in compiler
 * messages and commands receive the same treatment as structured fields.
 */
export function sanitizeDiagnosticText(
  input: string,
  redactions: DiagnosticRedaction[] = [],
): string {
  let output =
    input.length > 256 * 1024
      ? input.slice(0, 256 * 1024) + "\n[truncated]"
      : input;
  const orderedRedactions = [...redactions]
    .filter((entry) => Boolean(entry.value))
    .sort((left, right) => right.value.length - left.value.length);

  for (const entry of orderedRedactions) {
    output = replaceAllLiteral(output, entry.value, entry.replacement);

    const alternateSeparators = entry.value.includes("\\")
      ? entry.value.replace(/\\/g, "/")
      : entry.value.replace(/\//g, "\\");
    if (alternateSeparators !== entry.value) {
      output = replaceAllLiteral(
        output,
        alternateSeparators,
        entry.replacement,
      );
    }
    output = replaceAllLiteral(
      output,
      entry.value.replace(/\\/g, "\\\\"),
      entry.replacement,
    );
    if (/^[A-Za-z]:[\\/]/.test(entry.value)) {
      const pattern = entry.value
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\\/g, "[\\\\/]");
      output = output.replace(
        new RegExp(pattern, "gi"),
        () => entry.replacement,
      );
    }
  }

  output = output
    .replace(
      /("(?:[^"]*(?:token|secret|password|api.?key)|authorization|cookie|pass|auth|serial(?:number)?)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"<REDACTED>"',
    )
    .replace(
      /(\b(?:api[-_]?key|access[-_]?token|auth[-_]?token|token|password|passwd|secret|client[-_]?secret)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi,
      "$1<REDACTED>",
    )
    .replace(
      /(authorization\s*[:=]\s*(?:bearer|basic)?\s*)[^\s,;]+/gi,
      "$1<REDACTED>",
    )
    .replace(/(\b(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1<REDACTED>")
    .replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, "://<REDACTED>@")
    .replace(
      /([?&](?:api[-_]?key|token|access[-_]?token|secret)=)[^&#\s]+/gi,
      "$1<REDACTED>",
    )
    .replace(
      /\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g,
      "<REDACTED>",
    );

  output = output
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g,
      "<PRIVATE_KEY_REDACTED>",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<EMAIL>")
    .replace(/(?:\/Users\/|\/home\/)[^/\s"<>]+/g, "<HOME>")
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"<>]+/gi, "<HOME>")
    .replace(
      /\b(?:git@[^\s:]+:[^\s]+|ssh:\/\/[^\s]+|https?:\/\/[^\s]+\.git(?:\?[^\s]*)?)/gi,
      "<GIT_REMOTE>",
    )
    .replace(
      /((?:serial(?:\s*number)?|serial[-_]?no|hostname|username|cookie|pass|auth|credentials)\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi,
      "$1<REDACTED>",
    )
    .replace(
      /(\b(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)|AWS_[A-Z0-9_]+|GITHUB_[A-Z0-9_]+|OPENAI_[A-Z0-9_]+|GOOGLE_[A-Z0-9_]+)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/g,
      "$1<REDACTED>",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<UNIQUE_ID>",
    )
    .replace(/\b(https?:\/\/)(?!<REDACTED>@)[^\s<>"']+/gi, "$1<URL_REDACTED>");
  return output;
}

export function sanitizeDiagnosticValue(
  value: unknown,
  redactions: DiagnosticRedaction[] = [],
  depth = 0,
): unknown {
  if (depth > 30) return "<DEPTH_LIMIT>";
  if (typeof value === "string")
    return sanitizeDiagnosticText(value, redactions);
  if (Array.isArray(value))
    return value
      .slice(0, 1000)
      .map((item) => sanitizeDiagnosticValue(item, redactions, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|password|passwd|api.?key|cookie|credential|serial(?:number)?|hostname|username|email|^(?:AWS_|GITHUB_|OPENAI_|GOOGLE_)|^auth$|^pass$/i.test(
          key,
        ) &&
        !(key === "serial" && Array.isArray(item)) &&
        key !== "serialPort"
          ? "<REDACTED>"
          : sanitizeDiagnosticValue(item, redactions, depth + 1),
      ]),
    );
  return value;
}

export function buildDiagnosticJson(
  input: Qc1DiagnosticReportInput,
  redactions: DiagnosticRedaction[] = [],
): string {
  return JSON.stringify(
    sanitizeDiagnosticValue({ reportSchemaVersion: 2, ...input }, redactions),
    null,
    2,
  );
}

function codeBlock(content: string, language = "text"): string {
  let longestFence = 0;
  for (const match of content.matchAll(/~+/g))
    longestFence = Math.max(longestFence, match[0].length);
  const fence = "~".repeat(Math.max(4, longestFence + 1));
  return `${fence}${language}\n${content || "--"}\n${fence}`;
}

function jsonBlock(value: unknown): string {
  return codeBlock(JSON.stringify(value, null, 2), "json");
}

export function buildDiagnosticReport(
  input: Qc1DiagnosticReportInput,
  redactions: DiagnosticRedaction[] = [],
): string {
  const clean = sanitizeDiagnosticValue(
    input,
    redactions,
  ) as Qc1DiagnosticReportInput;
  const sections: [string, string][] = [
    [
      "Résumé",
      jsonBlock({
        reportSchemaVersion: 2,
        generatedAt: clean.generatedAt,
        issueDescription: clean.issueDescription,
        findings: clean.findings?.length || 0,
      }),
    ],
    [
      "QC1",
      jsonBlock({ ...clean.extension, configuration: clean.configuration }),
    ],
    ["OS", jsonBlock(clean.system || clean.runtime)],
    ["VS Code", jsonBlock(clean.runtime)],
    ["Extensions installées", jsonBlock(clean.installedExtensions || [])],
    ["Workspace", jsonBlock(clean.workspace)],
    ["Projet", jsonBlock(clean.project)],
    [
      "Structure du projet",
      jsonBlock(clean.structure || {}) + "\n\n" + codeBlock(clean.projectTree),
    ],
    ["Détection MCU", jsonBlock(clean.mcu || {})],
    ["CMake", jsonBlock(clean.cmake || {})],
    ["Outils détectés / Toolchain", jsonBlock(clean.tools)],
    ["Debuggers / probes", jsonBlock(clean.hardware)],
    [
      "USB",
      jsonBlock({
        devices: clean.devices?.usb || [],
        permissions: clean.devices?.permissions || {},
        errors: clean.devices?.errors || [],
      }),
    ],
    [
      "Ports série",
      jsonBlock({
        ports: clean.devices?.serial || [],
        note: "Liste vide: aucun port détecté; consulter aussi les erreurs de collecte.",
      }),
    ],
    ["Git", codeBlock(clean.gitSnapshot)],
    ["Build", jsonBlock(clean.dashboard)],
    ["Artefacts", jsonBlock(clean.artifacts)],
    [
      "Problèmes signalés par VS Code / Diagnostics",
      jsonBlock({
        findings: clean.findings || [],
        vscodeProblems: clean.vscodeProblems,
      }),
    ],
    ["Journal récent", codeBlock(clean.logs)],
    [
      "Confidentialité",
      "Collecte locale, bornée et en lecture seule. L'analyse CMake et des includes lit une partie des sources sans en publier le contenu. QC1 ne lit pas directement le contenu des fichiers source dans le rapport: seuls les chemins et preuves sélectionnées sont inclus. Aucun .env, clé SSH, cookie ou environnement complet n'est collecté. Les données indisponibles restent unknown. Vérifier la prévisualisation avant partage.",
    ],
  ];
  return [
    "# Rapport de diagnostic QC1 STM32",
    "",
    ...sections.flatMap(([title, body]) => ["## " + title, "", body, ""]),
    "## Résumé JSON (reportSchemaVersion 2)",
    "",
    codeBlock(buildDiagnosticJson(input, redactions), "json"),
    "",
  ].join("\n");
}
