import { parseQc1Output } from "./qc1Parser";
import type { QC1OperationStatus } from "../dashboard/dashboardState";

/** Run process stages in order and never launch a later stage after a failure. */
export async function executeSequentially<T>(
  items: readonly T[],
  execute: (item: T) => Promise<boolean>,
): Promise<void> {
  for (const item of items) {
    if (!await execute(item)) break;
  }
}

export function resolveBuildStatus(input: {
  requested: boolean;
  processSucceeded?: boolean;
  commandFailed: boolean;
  failurePhase?: string;
}): QC1OperationStatus {
  if (!input.requested) return "not-run";
  if (input.processSucceeded === true) return "success";
  if (input.processSucceeded === false) return "failed";
  if (!input.commandFailed) return "skipped";
  return input.failurePhase === "configuring" || input.failurePhase === "building" ? "failed" : "skipped";
}

/** Detect compiler/CMake failure text even when a tool incorrectly exits with code 0. */
export function buildOutputFailureReason(stdout: string, stderr: string): string | undefined {
  const output = `${stdout}\n${stderr}`;
  const parsed = parseQc1Output(output);
  const linkerOrBuildError = output.split(/\r?\n/).find((line) =>
    /(?:undefined reference|multiple definition|ld returned [1-9]\d* exit status|collect2: error|ninja: build stopped|make(?:\[\d+\])?: \*\*\*)/i.test(line),
  );
  if (parsed.errors === 0 && !parsed.hasBuildFailed && !linkerOrBuildError) return undefined;
  return parsed.diagnostics.find((entry) => entry.severity === "error")?.message || linkerOrBuildError ||
    "La sortie CMake/GCC signale une erreur malgré le code retour du processus.";
}

/** Recognize explicit programmer errors when a vendor CLI incorrectly returns zero. */
export function programmerOutputFailureReason(stdout: string, stderr: string): string | undefined {
  return `${stdout}\n${stderr}`.split(/\r?\n/).find((line) =>
    /^\s*(?:Error|ERROR|Fatal|FATAL)\s*:/i.test(line) ||
    /^\s*(?:st-flash|openocd)\b.*\b(?:error|failed|failure)\b/i.test(line) ||
    /^\s*(?:failed to|could not|unable to)\s+(?:open|connect|program|write|verify|reset|read|examine|halt)\b/i.test(line) ||
    /\b(?:verification|verify) failed\b/i.test(line),
  );
}
