import { DEFAULT_SNAPSHOT_MS } from './constants';
import { processDataset } from './lifecycle';
import { normalizeDataset } from './normalize';
import { parseEventsCsv, parseOrdersCsv } from './parseCsv';
import type { ProcessedDataset } from './types';

export interface LoadResult {
  ok: true;
  dataset: ProcessedDataset;
  warnings: string[];
}

export interface LoadFailure {
  ok: false;
  errors: string[];
}

/**
 * Validate and process a CSV pair atomically.
 * Caller should only swap the active dataset when ok === true.
 */
export function loadFromCsvTexts(
  ordersText: string,
  eventsText: string,
  snapshotMs: number = DEFAULT_SNAPSHOT_MS,
): LoadResult | LoadFailure {
  const ordersParsed = parseOrdersCsv(ordersText);
  const eventsParsed = parseEventsCsv(eventsText);

  if (!ordersParsed.ok || !eventsParsed.ok) {
    const errors: string[] = [];
    if (!ordersParsed.ok) errors.push(...ordersParsed.errors);
    if (!eventsParsed.ok) errors.push(...eventsParsed.errors);
    return { ok: false, errors };
  }

  const warnings = [...ordersParsed.warnings, ...eventsParsed.warnings];

  const { orders, events, quality } = normalizeDataset(
    ordersParsed.rows,
    eventsParsed.rows,
    snapshotMs,
  );

  if (orders.length === 0) {
    return { ok: false, errors: ['No valid orders after normalization.'] };
  }

  const dataset = processDataset(orders, events, quality, snapshotMs);
  return { ok: true, dataset, warnings };
}

export async function fetchSampleCsvs(): Promise<{ ordersText: string; eventsText: string }> {
  const [ordersRes, eventsRes] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}orders.csv`),
    fetch(`${import.meta.env.BASE_URL}kit_events.csv`),
  ]);
  if (!ordersRes.ok) throw new Error(`Failed to load sample orders.csv (${ordersRes.status})`);
  if (!eventsRes.ok) throw new Error(`Failed to load sample kit_events.csv (${eventsRes.status})`);
  const [ordersText, eventsText] = await Promise.all([ordersRes.text(), eventsRes.text()]);
  return { ordersText, eventsText };
}
