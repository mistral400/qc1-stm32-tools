import { sanitizeDiagnosticText } from "./diagnosticReport";

export type Qc1TimelineOperation = "Build" | "Flash" | "Debug" | "Run" | "Clean" | "Rebuild" | "Autre";
export type Qc1TimelineResult = "success" | "failed" | "partial";

export interface Qc1OperationTimelineEntry {
  id: string;
  project: string;
  occurredAt: string;
  operation: Qc1TimelineOperation;
  durationMs: number;
  result: Qc1TimelineResult;
  tools: string[];
  backend: string;
  verification: string;
  error: string;
}

const OPERATIONS: Qc1TimelineOperation[] = ["Build", "Flash", "Debug", "Run", "Clean", "Rebuild", "Autre"];
const RESULTS: Qc1TimelineResult[] = ["success", "failed", "partial"];
const MAX_ENTRIES = 200;
const MAX_TEXT = 400;

type TimelineOperationStatuses = Partial<Record<
  "build" | "artifactValidation" | "programming" | "verification" | "reset" | "debugSession",
  { status: string }
>>;

export function classifyTimelineResult(
  operation: Qc1TimelineOperation,
  statuses: TimelineOperationStatuses,
  flashConfirmed: boolean,
  thrown = false,
): Qc1TimelineResult {
  if (thrown) return "failed";
  if (operation === "Build" || operation === "Rebuild") {
    return statuses.build?.status === "success" ? "success" : statuses.build?.status === "failed" ? "failed" : "partial";
  }
  if (operation === "Flash" || operation === "Run") {
    if (flashConfirmed) return "success";
    const relevant = ["build", "artifactValidation", "programming", "verification", "reset"] as const;
    return relevant.some((name) => statuses[name]?.status === "failed") ? "failed" : "partial";
  }
  if (operation === "Debug") {
    return statuses.debugSession?.status === "success" ? "success" :
      statuses.build?.status === "failed" || statuses.debugSession?.status === "failed" ? "failed" : "partial";
  }
  return "success";
}

export function timelineFailureMessage(
  operation: Qc1TimelineOperation,
  statuses: TimelineOperationStatuses,
): string {
  const relevant = operation === "Build" || operation === "Rebuild" ? ["build"] as const
    : operation === "Flash" || operation === "Run" ? ["build", "artifactValidation", "programming", "verification", "reset"] as const
      : operation === "Debug" ? ["build", "debugSession"] as const : [];
  const failed = relevant.map((name) => statuses[name]).find((entry) => entry?.status === "failed");
  return failed && "message" in failed && typeof failed.message === "string" ? cleanText(failed.message) : "";
}

function cleanText(value: unknown, maximum = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  return sanitizeDiagnosticText(value)
    .replace(/(?:[A-Za-z]:[\\/]|\/)(?:[^\\/\s<>:"|?*]+[\\/])+[^\\/\s<>:"|?*]*/g, "<PATH>")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function parseEntry(value: unknown): Qc1OperationTimelineEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || typeof entry.occurredAt !== "string" ||
    typeof entry.durationMs !== "number" || !Number.isFinite(entry.durationMs) ||
    !OPERATIONS.includes(entry.operation as Qc1TimelineOperation) ||
    !RESULTS.includes(entry.result as Qc1TimelineResult)) return;
  return {
    id: cleanText(entry.id, 80),
    project: cleanText(entry.project, 120) || "Projet inconnu",
    occurredAt: Number.isFinite(Date.parse(entry.occurredAt)) ? new Date(entry.occurredAt).toISOString() : new Date(0).toISOString(),
    operation: entry.operation as Qc1TimelineOperation,
    durationMs: Math.max(0, Math.round(entry.durationMs)),
    result: entry.result as Qc1TimelineResult,
    tools: Array.isArray(entry.tools) ? entry.tools.filter((tool): tool is string => typeof tool === "string").slice(0, 12).map((tool) => cleanText(tool, 80)) : [],
    backend: cleanText(entry.backend, 80),
    verification: cleanText(entry.verification),
    error: cleanText(entry.error),
  };
}

/** Bounded local history stores summaries only; raw paths, commands, serial data and probe IDs are excluded. */
export class OperationTimeline {
  private entries: Qc1OperationTimelineEntry[] = [];

  constructor(value?: unknown, private readonly maximumEntries = MAX_ENTRIES) {
    this.replace(value);
  }

  append(value: Qc1OperationTimelineEntry): void {
    const entry = parseEntry(value);
    if (!entry) return;
    this.entries.push(entry);
    const limit = Math.max(1, Math.min(MAX_ENTRIES, this.maximumEntries));
    if (this.entries.length > limit) this.entries.splice(0, this.entries.length - limit);
  }

  replace(value: unknown): void {
    const entries = Array.isArray(value) ? value.map(parseEntry).filter((entry): entry is Qc1OperationTimelineEntry => Boolean(entry)) : [];
    this.entries = entries.slice(-Math.max(1, Math.min(MAX_ENTRIES, this.maximumEntries)));
  }

  snapshot(): Qc1OperationTimelineEntry[] {
    return this.entries.map((entry) => ({ ...entry, tools: [...entry.tools] }));
  }

  clear(): void {
    this.entries = [];
  }
}

export function summarizeOperation(command: string): Qc1TimelineOperation {
  if (["build", "build-cm7", "build-cm4", "tsmake"].includes(command)) return "Build";
  if (["flash", "flash-cm7", "flash-cm4"].includes(command)) return "Flash";
  if (["debug", "debug-cm7", "debug-cm4"].includes(command)) return "Debug";
  if (command === "run") return "Run";
  if (command === "clean") return "Clean";
  if (command === "rebuild") return "Rebuild";
  return "Autre";
}
