import { ELIGIBLE_PRODUCTS } from './constants';
import { parseIsTest } from './parseCsv';
import { parseTimestamp } from './timestamps';
import {
  KNOWN_EVENT_TYPES,
  type DataQualityReport,
  type KitEvent,
  type Order,
  type RawEventRow,
  type RawOrderRow,
} from './types';

function emptyQuality(): DataQualityReport {
  return {
    duplicateEvents: 0,
    invalidTimestamps: 0,
    orphanEvents: 0,
    unknownEventTypes: 0,
    postSnapshotEvents: 0,
    conflictingOrders: 0,
    malformedOrders: 0,
    malformedEvents: 0,
    negativeIntervals: 0,
    contradictions: 0,
    multipleActiveKits: 0,
    timezoneAssumedUtc: 0,
    messages: [],
  };
}

function exclusionReasons(product: string, status: string, isTest: boolean): string[] {
  const reasons: string[] = [];
  if (isTest) reasons.push('test_order');
  if (status === 'refunded') reasons.push('refunded');
  if (status === 'cancelled') reasons.push('cancelled');
  if (product === 'upload_only') reasons.push('upload_only');
  if (!ELIGIBLE_PRODUCTS.has(product) && product !== 'upload_only') {
    reasons.push(`unsupported_product:${product || '(blank)'}`);
  }
  if (status !== 'paid' && status !== 'refunded' && status !== 'cancelled') {
    reasons.push(`unsupported_status:${status || '(blank)'}`);
  }
  return reasons;
}

export function normalizeOrders(
  rows: RawOrderRow[],
  snapshotMs: number,
  quality: DataQualityReport,
): Map<string, Order> {
  const byId = new Map<string, Order>();

  for (const row of rows) {
    if (!row.order_id) {
      quality.malformedOrders += 1;
      continue;
    }

    const ts = parseTimestamp(row.created_at);
    if (!ts) {
      quality.invalidTimestamps += 1;
      quality.malformedOrders += 1;
      quality.messages.push(`Invalid created_at for order ${row.order_id}: "${row.created_at}"`);
      continue;
    }
    if (ts.assumedUtc) quality.timezoneAssumedUtc += 1;

    // Orders created after snapshot are excluded from the cohort entirely.
    if (ts.ms > snapshotMs) {
      quality.postSnapshotEvents += 1; // counted in quality; not added
      quality.messages.push(`Order ${row.order_id} created after snapshot; excluded from cohort.`);
      continue;
    }

    const isTestParsed = parseIsTest(row.is_test);
    if (isTestParsed.invalid) {
      quality.malformedOrders += 1;
      quality.messages.push(`Unrecognized is_test for ${row.order_id}: "${row.is_test}" (treated as false)`);
    }

    const reasons = exclusionReasons(row.product, row.status, isTestParsed.value);
    const eligible =
      !isTestParsed.value &&
      row.status === 'paid' &&
      ELIGIBLE_PRODUCTS.has(row.product);

    const order: Order = {
      order_id: row.order_id,
      created_at_ms: ts.ms,
      created_at_raw: row.created_at,
      customer_id: row.customer_id,
      product: row.product,
      country: row.country,
      status: row.status,
      is_test: isTestParsed.value,
      exclusionReasons: reasons,
      eligible,
    };

    const existing = byId.get(row.order_id);
    if (existing) {
      quality.conflictingOrders += 1;
      // Deterministic: keep earliest created_at; if tie, keep first-seen lexicographically by JSON fields.
      const preferNew =
        order.created_at_ms < existing.created_at_ms ||
        (order.created_at_ms === existing.created_at_ms &&
          JSON.stringify(order) < JSON.stringify(existing));
      const kept = preferNew ? order : existing;
      kept.conflict = true;
      byId.set(row.order_id, kept);
      quality.messages.push(
        `Conflicting duplicate order_id ${row.order_id}; kept created_at=${kept.created_at_raw}`,
      );
    } else {
      byId.set(row.order_id, order);
    }
  }

  return byId;
}

export function normalizeEvents(
  rows: RawEventRow[],
  orders: Map<string, Order>,
  snapshotMs: number,
  quality: DataQualityReport,
): KitEvent[] {
  const known = new Set<string>(KNOWN_EVENT_TYPES);
  const seen = new Map<string, KitEvent>();
  const result: KitEvent[] = [];

  for (const row of rows) {
    if (!row.event_id || !row.order_id || !row.kit_id || !row.event_type) {
      quality.malformedEvents += 1;
      continue;
    }

    const ts = parseTimestamp(row.occurred_at);
    if (!ts) {
      quality.invalidTimestamps += 1;
      quality.malformedEvents += 1;
      quality.messages.push(
        `Invalid occurred_at for event ${row.event_id}: "${row.occurred_at}"`,
      );
      continue;
    }
    if (ts.assumedUtc) quality.timezoneAssumedUtc += 1;

    const orphan = !orders.has(row.order_id);
    const postSnapshot = ts.ms > snapshotMs;
    const unknownType = !known.has(row.event_type);

    if (orphan) quality.orphanEvents += 1;
    if (postSnapshot) quality.postSnapshotEvents += 1;
    if (unknownType) quality.unknownEventTypes += 1;

    const event: KitEvent = {
      event_id: row.event_id,
      order_id: row.order_id,
      kit_id: row.kit_id,
      event_type: row.event_type,
      occurred_at_ms: ts.ms,
      occurred_at_raw: row.occurred_at,
      source: row.source,
      timezoneAssumedUtc: ts.assumedUtc,
      orphan,
      postSnapshot,
      unknownType,
    };

    // Semantic dedupe: order_id + kit_id + event_type + normalized timestamp
    const dedupeKey = `${event.order_id}|${event.kit_id}|${event.event_type}|${event.occurred_at_ms}`;
    if (seen.has(dedupeKey)) {
      quality.duplicateEvents += 1;
      continue;
    }
    seen.set(dedupeKey, event);
    result.push(event);
  }

  // Sort by normalized timestamp, never CSV row order
  result.sort((a, b) => {
    if (a.occurred_at_ms !== b.occurred_at_ms) return a.occurred_at_ms - b.occurred_at_ms;
    return a.event_id.localeCompare(b.event_id);
  });

  return result;
}

export function normalizeDataset(
  orderRows: RawOrderRow[],
  eventRows: RawEventRow[],
  snapshotMs: number,
): { orders: Order[]; events: KitEvent[]; quality: DataQualityReport } {
  const quality = emptyQuality();
  const orderMap = normalizeOrders(orderRows, snapshotMs, quality);
  const events = normalizeEvents(eventRows, orderMap, snapshotMs, quality);
  const orders = [...orderMap.values()].sort((a, b) => a.created_at_ms - b.created_at_ms);

  if (quality.timezoneAssumedUtc > 0) {
    quality.messages.unshift(
      `${quality.timezoneAssumedUtc} timestamp(s) lacked a timezone; treated as UTC.`,
    );
  }

  return { orders, events, quality };
}
