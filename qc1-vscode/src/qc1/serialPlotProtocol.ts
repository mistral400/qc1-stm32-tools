export interface SerialPlotSample {
  timeMs: number;
  values: Record<string, number>;
}

export interface SerialPlotParseResult {
  samples: SerialPlotSample[];
  rejectedLines: number;
  oversizedLines: number;
}

const MAX_LINE_CHARS = 2048;
const MAX_SERIES = 8;
const MAX_SAMPLE_WINDOW = 10_000;
const SERIES_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/;

/**
 * QC1 plot input is explicit JSON Lines:
 * {"qc1_plot":1,"time_ms":123,"values":{"temperature_c":22.5}}
 * Arbitrary UART text is never interpreted as numeric graph data.
 */
export class SerialPlotLineParser {
  private pending = "";
  private droppingOversizedLine = false;

  push(chunk: string): SerialPlotParseResult {
    const result: SerialPlotParseResult = { samples: [], rejectedLines: 0, oversizedLines: 0 };
    for (const character of chunk) {
      if (character === "\n") {
        if (this.droppingOversizedLine) result.oversizedLines += 1;
        else if (this.pending.trim()) {
          const sample = parsePlotLine(this.pending);
          if (sample) result.samples.push(sample);
          else result.rejectedLines += 1;
        }
        this.pending = "";
        this.droppingOversizedLine = false;
        continue;
      }
      if (this.droppingOversizedLine) continue;
      if (this.pending.length >= MAX_LINE_CHARS) {
        this.pending = "";
        this.droppingOversizedLine = true;
        continue;
      }
      this.pending += character;
    }
    return result;
  }

  clear(): void {
    this.pending = "";
    this.droppingOversizedLine = false;
  }
}

function parsePlotLine(line: string): SerialPlotSample | undefined {
  try {
    const parsed: unknown = JSON.parse(line.trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const value = parsed as Record<string, unknown>;
    if (value.qc1_plot !== 1 || typeof value.time_ms !== "number" ||
      !Number.isFinite(value.time_ms) || value.time_ms < 0 ||
      !value.values || typeof value.values !== "object" || Array.isArray(value.values)) return;
    const entries = Object.entries(value.values as Record<string, unknown>);
    if (!entries.length || entries.length > MAX_SERIES) return;
    const values: Record<string, number> = {};
    for (const [name, reading] of entries) {
      if (!SERIES_NAME.test(name) || typeof reading !== "number" || !Number.isFinite(reading)) return;
      values[name] = reading;
    }
    return { timeMs: value.time_ms, values };
  } catch {
    return;
  }
}

/** Fixed-memory chart ring; callers receive copies so view code cannot mutate retained data. */
export class BoundedSerialPlotHistory {
  private readonly samples: SerialPlotSample[] = [];
  private readonly series = new Set<string>();
  private readonly maximumSamples: number;

  constructor(maximumSamples = 1000) {
    this.maximumSamples = Math.max(1, Math.min(MAX_SAMPLE_WINDOW, Math.floor(maximumSamples) || 1));
  }

  append(sample: SerialPlotSample): boolean {
    const entries = Object.entries(sample.values);
    if (!Number.isFinite(sample.timeMs) || sample.timeMs < 0 || !entries.length || entries.length > MAX_SERIES) return false;
    if (entries.some(([name, reading]) => !SERIES_NAME.test(name) || !Number.isFinite(reading))) return false;
    const nextSeries = new Set([...this.series, ...entries.map(([name]) => name)]);
    if (nextSeries.size > MAX_SERIES) return false;
    this.series.clear();
    for (const name of nextSeries) this.series.add(name);
    this.samples.push({ timeMs: sample.timeMs, values: Object.fromEntries(entries) });
    if (this.samples.length > this.maximumSamples) this.samples.splice(0, this.samples.length - this.maximumSamples);
    return true;
  }

  snapshot(): { samples: SerialPlotSample[]; series: string[] } {
    return {
      samples: this.samples.map((sample) => ({ timeMs: sample.timeMs, values: { ...sample.values } })),
      series: [...this.series],
    };
  }

  clear(): void {
    this.samples.length = 0;
    this.series.clear();
  }

  get size(): number {
    return this.samples.length;
  }
}
