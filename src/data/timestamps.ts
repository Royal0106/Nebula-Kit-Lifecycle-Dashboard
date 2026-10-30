import { MS_PER_DAY } from './constants';

export interface ParsedTimestamp {
  ms: number;
  assumedUtc: boolean;
  raw: string;
}

/**
 * Normalize timestamps to UTC milliseconds.
 * - Explicit offsets / Z are respected via Date.parse.
 * - Timezone-free values ("YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss")
 *   are treated as UTC (disclosed assumption).
 */
export function parseTimestamp(raw: string): ParsedTimestamp | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  // Has explicit offset or Z
  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasOffset) {
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) return null;
    return { ms, assumedUtc: false, raw: trimmed };
  }

  // Naive: space or T separator, no zone — treat as UTC
  const naiveMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/,
  );
  if (naiveMatch) {
    const iso = `${naiveMatch[1]}T${naiveMatch[2]}${naiveMatch[3] ?? ''}Z`;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    return { ms, assumedUtc: true, raw: trimmed };
  }

  // Date-only
  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) {
    const ms = Date.parse(`${dateOnly[1]}T00:00:00Z`);
    if (Number.isNaN(ms)) return null;
    return { ms, assumedUtc: true, raw: trimmed };
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return { ms, assumedUtc: false, raw: trimmed };
}

/** Fractional calendar days between two instants. */
export function elapsedDays(startMs: number, endMs: number): number {
  return (endMs - startMs) / MS_PER_DAY;
}

/** Round only for display. */
export function formatDays(days: number | null | undefined, digits = 1): string {
  if (days == null || Number.isNaN(days)) return '—';
  return days.toFixed(digits);
}

/**
 * Inclusive UTC calendar-day range from DatePicker values.
 * Start: 00:00:00.000Z of start date; End: 23:59:59.999Z of end date.
 */
export function utcDayBounds(startDateIso: string, endDateIso: string): [number, number] {
  const start = Date.parse(`${startDateIso.slice(0, 10)}T00:00:00.000Z`);
  const end = Date.parse(`${endDateIso.slice(0, 10)}T23:59:59.999Z`);
  return [start, end];
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Nearest-rank P90. */
export function percentile90(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.9 * sorted.length) - 1;
  return sorted[Math.max(0, rank)]!;
}
