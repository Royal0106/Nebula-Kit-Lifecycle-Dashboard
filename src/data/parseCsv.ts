import Papa from 'papaparse';
import { EVENT_REQUIRED_COLUMNS, ORDER_REQUIRED_COLUMNS } from './constants';
import type { RawEventRow, RawOrderRow } from './types';

export interface CsvParseSuccess<T> {
  ok: true;
  rows: T[];
  warnings: string[];
}

export interface CsvParseFailure {
  ok: false;
  errors: string[];
}

export type CsvParseResult<T> = CsvParseSuccess<T> | CsvParseFailure;

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim();
}

function missingHeaders(headers: string[], required: readonly string[]): string[] {
  const set = new Set(headers.map(normalizeHeader));
  return required.filter((c) => !set.has(c));
}

function parseWithPapa(text: string): {
  data: Record<string, string>[];
  errors: Papa.ParseError[];
  meta: Papa.ParseMeta;
} {
  return Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeHeader,
  });
}

export function parseOrdersCsv(text: string): CsvParseResult<RawOrderRow> {
  const parsed = parseWithPapa(text);
  const headers = parsed.meta.fields ?? [];
  const missing = missingHeaders(headers, ORDER_REQUIRED_COLUMNS);
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        `orders.csv is missing required column(s): ${missing.join(', ')}. Found: ${headers.join(', ') || '(none)'}`,
      ],
    };
  }

  const warnings: string[] = [];
  if (parsed.errors.length > 0) {
    warnings.push(
      ...parsed.errors.slice(0, 5).map((e) => `Parse warning (row ${e.row ?? '?'}): ${e.message}`),
    );
  }

  const rows: RawOrderRow[] = [];
  for (const row of parsed.data) {
    if (!row || Object.values(row).every((v) => !String(v ?? '').trim())) continue;
    rows.push({
      order_id: String(row.order_id ?? '').trim(),
      created_at: String(row.created_at ?? '').trim(),
      customer_id: String(row.customer_id ?? '').trim(),
      product: String(row.product ?? '').trim(),
      country: String(row.country ?? '').trim(),
      status: String(row.status ?? '').trim(),
      is_test: String(row.is_test ?? '').trim(),
    });
  }

  if (rows.length === 0) {
    return { ok: false, errors: ['orders.csv contains no data rows.'] };
  }

  return { ok: true, rows, warnings };
}

export function parseEventsCsv(text: string): CsvParseResult<RawEventRow> {
  const parsed = parseWithPapa(text);
  const headers = parsed.meta.fields ?? [];
  const missing = missingHeaders(headers, EVENT_REQUIRED_COLUMNS);
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        `kit_events.csv is missing required column(s): ${missing.join(', ')}. Found: ${headers.join(', ') || '(none)'}`,
      ],
    };
  }

  const warnings: string[] = [];
  if (parsed.errors.length > 0) {
    warnings.push(
      ...parsed.errors.slice(0, 5).map((e) => `Parse warning (row ${e.row ?? '?'}): ${e.message}`),
    );
  }

  const rows: RawEventRow[] = [];
  for (const row of parsed.data) {
    if (!row || Object.values(row).every((v) => !String(v ?? '').trim())) continue;
    rows.push({
      event_id: String(row.event_id ?? '').trim(),
      order_id: String(row.order_id ?? '').trim(),
      kit_id: String(row.kit_id ?? '').trim(),
      event_type: String(row.event_type ?? '').trim(),
      occurred_at: String(row.occurred_at ?? '').trim(),
      source: String(row.source ?? '').trim(),
    });
  }

  if (rows.length === 0) {
    return { ok: false, errors: ['kit_events.csv contains no data rows.'] };
  }

  return { ok: true, rows, warnings };
}

/**
 * Parse is_test explicitly. Boolean("false") must NOT be true.
 * Accepts: true/false, 1/0, yes/no (case-insensitive). Empty → false with warning path.
 */
export function parseIsTest(raw: string): { value: boolean; invalid: boolean } {
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return { value: true, invalid: false };
  if (v === 'false' || v === '0' || v === 'no' || v === '') return { value: false, invalid: false };
  return { value: false, invalid: true };
}
