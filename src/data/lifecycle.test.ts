import { describe, expect, it } from 'vitest';
import { DEFAULT_SNAPSHOT_MS, MS_PER_DAY, STAGE_TARGETS } from './constants';
import {
  buildOrderLifecycle,
  computeFollowUpQueue,
  computeOverview,
  computeTurnaround,
  stageDurationDays,
} from './lifecycle';
import { normalizeDataset } from './normalize';
import { parseIsTest } from './parseCsv';
import { loadFromCsvTexts } from './process';
import { elapsedDays, parseTimestamp } from './timestamps';
import type { DataQualityReport, RawEventRow, RawOrderRow } from './types';

const SNAP = DEFAULT_SNAPSHOT_MS;

function emptyQ(): DataQualityReport {
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

function order(partial: Partial<RawOrderRow> & { order_id: string }): RawOrderRow {
  return {
    created_at: '2026-10-01T00:00:00Z',
    customer_id: 'cus_x',
    product: 'wgs_30x',
    country: 'US',
    status: 'paid',
    is_test: 'false',
    ...partial,
  };
}

function evt(
  partial: Partial<RawEventRow> & {
    event_id: string;
    order_id: string;
    kit_id: string;
    event_type: string;
    occurred_at: string;
  },
): RawEventRow {
  return { source: 'system', ...partial };
}

function process(orders: RawOrderRow[], events: RawEventRow[], snap = SNAP) {
  const q = emptyQ();
  const norm = normalizeDataset(orders, events, snap);
  Object.assign(q, norm.quality);
  const lifecycles = new Map(
    norm.orders.map((o) => [o.order_id, buildOrderLifecycle(o, norm.events, snap, q)]),
  );
  return { orders: norm.orders, events: norm.events, quality: q, lifecycles };
}

describe('parseIsTest', () => {
  it('does not treat string "false" as true', () => {
    expect(parseIsTest('false').value).toBe(false);
    expect(parseIsTest('true').value).toBe(true);
    // Contrast with Boolean("false") === true
    expect(Boolean('false')).toBe(true);
  });
});

describe('timestamps', () => {
  it('normalizes offsets to UTC and treats naive as UTC', () => {
    const offset = parseTimestamp('2026-09-03T10:55:14-05:00');
    expect(offset?.ms).toBe(Date.parse('2026-09-03T15:55:14Z'));
    expect(offset?.assumedUtc).toBe(false);

    const naive = parseTimestamp('2026-07-17 18:39:19');
    expect(naive?.assumedUtc).toBe(true);
    expect(naive?.ms).toBe(Date.parse('2026-07-17T18:39:19Z'));

    const z = parseTimestamp('2026-07-17T18:39:19Z');
    expect(z?.ms).toBe(Date.parse('2026-07-17T18:39:19Z'));
  });
});

describe('semantic duplicates', () => {
  it('dedupes same order/kit/type/timestamp even when event_id differs', () => {
    const { events, quality } = process(
      [order({ order_id: 'ord_a' })],
      [
        evt({
          event_id: 'evt_1',
          order_id: 'ord_a',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: '2026-10-02T00:00:00Z',
        }),
        evt({
          event_id: 'evt_2',
          order_id: 'ord_a',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: '2026-10-02T00:00:00Z',
        }),
      ],
    );
    expect(quality.duplicateEvents).toBe(1);
    expect(events.filter((e) => e.event_type === 'kit_shipped')).toHaveLength(1);
  });
});

describe('shuffled events', () => {
  it('sorts by timestamp not CSV order and reaches furthest milestone', () => {
    const { lifecycles } = process(
      [order({ order_id: 'ord_b' })],
      [
        evt({
          event_id: 'e3',
          order_id: 'ord_b',
          kit_id: 'kit_1',
          event_type: 'sample_received',
          occurred_at: '2026-10-10T00:00:00Z',
        }),
        evt({
          event_id: 'e1',
          order_id: 'ord_b',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: '2026-10-02T00:00:00Z',
        }),
        evt({
          event_id: 'e2',
          order_id: 'ord_b',
          kit_id: 'kit_1',
          event_type: 'kit_delivered',
          occurred_at: '2026-10-05T00:00:00Z',
        }),
      ],
    );
    const lc = lifecycles.get('ord_b')!;
    expect(lc.currentStage).toBe('sample_received');
    expect(lc.events.map((e) => e.event_type)).toEqual([
      'kit_shipped',
      'kit_delivered',
      'sample_received',
    ]);
  });
});

describe('missing scans with later milestones', () => {
  it('does not erase downstream progress when kit_delivered is missing', () => {
    const { lifecycles } = process(
      [order({ order_id: 'ord_c' })],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_c',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: '2026-10-02T00:00:00Z',
        }),
        evt({
          event_id: 'e2',
          order_id: 'ord_c',
          kit_id: 'kit_1',
          event_type: 'sample_mailed',
          occurred_at: '2026-10-08T00:00:00Z',
        }),
      ],
    );
    const lc = lifecycles.get('ord_c')!;
    expect(lc.currentStage).toBe('sample_mailed');
    const attempt = lc.attempts[0]!;
    expect(stageDurationDays(attempt, 'ship_to_deliver', lc.order.created_at_ms)).toBeNull();
    expect(stageDurationDays(attempt, 'deliver_to_mail', lc.order.created_at_ms)).toBeNull();
  });
});

describe('failed QC and replacements', () => {
  it('treats qc_failed as distinct and keeps replaced attempt history', () => {
    const { lifecycles, quality } = process(
      [order({ order_id: 'ord_d' })],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_d',
          kit_id: 'kit_old',
          event_type: 'kit_shipped',
          occurred_at: '2026-09-01T00:00:00Z',
        }),
        evt({
          event_id: 'e2',
          order_id: 'ord_d',
          kit_id: 'kit_old',
          event_type: 'kit_delivered',
          occurred_at: '2026-09-04T00:00:00Z',
        }),
        evt({
          event_id: 'e3',
          order_id: 'ord_d',
          kit_id: 'kit_old',
          event_type: 'sample_mailed',
          occurred_at: '2026-09-10T00:00:00Z',
        }),
        evt({
          event_id: 'e4',
          order_id: 'ord_d',
          kit_id: 'kit_old',
          event_type: 'sample_received',
          occurred_at: '2026-09-14T00:00:00Z',
        }),
        evt({
          event_id: 'e5',
          order_id: 'ord_d',
          kit_id: 'kit_old',
          event_type: 'qc_failed',
          occurred_at: '2026-09-16T00:00:00Z',
        }),
        evt({
          event_id: 'e6',
          order_id: 'ord_d',
          kit_id: 'kit_old',
          event_type: 'kit_replaced',
          occurred_at: '2026-09-17T00:00:00Z',
        }),
        evt({
          event_id: 'e7',
          order_id: 'ord_d',
          kit_id: 'kit_new',
          event_type: 'kit_shipped',
          occurred_at: '2026-09-18T00:00:00Z',
        }),
      ],
    );
    const lc = lifecycles.get('ord_d')!;
    expect(lc.attempts).toHaveLength(2);
    expect(lc.attempts.find((a) => a.kit_id === 'kit_old')?.is_replaced).toBe(true);
    expect(lc.currentStage).toBe('kit_shipped');
    expect(lc.primaryAttempt?.kit_id).toBe('kit_new');
    // Historical QC duration on old kit still measurable
    const old = lc.attempts.find((a) => a.kit_id === 'kit_old')!;
    expect(stageDurationDays(old, 'receive_to_qc', lc.order.created_at_ms, quality)).toBeCloseTo(
      2,
      5,
    );
  });

  it('shows awaiting replacement shipment measured from replacement timestamp', () => {
    const { lifecycles } = process(
      [order({ order_id: 'ord_e', created_at: '2026-09-01T00:00:00Z' })],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_e',
          kit_id: 'kit_old',
          event_type: 'kit_shipped',
          occurred_at: '2026-09-02T00:00:00Z',
        }),
        evt({
          event_id: 'e2',
          order_id: 'ord_e',
          kit_id: 'kit_old',
          event_type: 'qc_failed',
          occurred_at: '2026-10-10T00:00:00Z',
        }),
        evt({
          event_id: 'e3',
          order_id: 'ord_e',
          kit_id: 'kit_old',
          event_type: 'kit_replaced',
          occurred_at: '2026-10-11T00:00:00Z',
        }),
      ],
    );
    const lc = lifecycles.get('ord_e')!;
    expect(lc.currentStage).toBe('awaiting_replacement_shipment');
    expect(lc.currentStageStartMs).toBe(Date.parse('2026-10-11T00:00:00Z'));
    expect(lc.stageTargetDays).toBe(STAGE_TARGETS.order_to_ship);
    expect(lc.followUpReasons).toContain('awaiting_replacement_shipment_overdue');
  });
});

describe('eligibility', () => {
  it('excludes upload_only, refunded, cancelled, and test orders from ops metrics', () => {
    const { lifecycles } = process(
      [
        order({ order_id: 'ord_ok' }),
        order({ order_id: 'ord_up', product: 'upload_only' }),
        order({ order_id: 'ord_ref', status: 'refunded' }),
        order({ order_id: 'ord_can', status: 'cancelled' }),
        order({ order_id: 'ord_test', is_test: 'true' }),
      ],
      [],
    );
    const list = [...lifecycles.values()];
    const overview = computeOverview(list);
    expect(overview.eligiblePhysicalKitOrders).toBe(1);
    expect(overview.exclusionCounts.upload_only).toBe(1);
    expect(overview.exclusionCounts.refunded).toBe(1);
    expect(overview.exclusionCounts.cancelled).toBe(1);
    expect(overview.exclusionCounts.test_order).toBe(1);
    // Lookup still available
    expect(lifecycles.get('ord_up')?.order.eligible).toBe(false);
  });
});

describe('orders without shipment', () => {
  it('marks awaiting first shipment and can be overdue vs 3-day target', () => {
    const created = SNAP - 5 * MS_PER_DAY;
    const { lifecycles } = process(
      [
        order({
          order_id: 'ord_wait',
          created_at: new Date(created).toISOString(),
        }),
      ],
      [],
    );
    const lc = lifecycles.get('ord_wait')!;
    expect(lc.awaitingFirstShipment).toBe(true);
    expect(lc.daysOverdue).toBeCloseTo(2, 5);
    expect(lc.followUpReasons).toContain('awaiting_first_shipment_overdue');
  });
});

describe('future events relative to snapshot', () => {
  it('excludes post-snapshot events from calculations', () => {
    const { lifecycles, quality } = process(
      [order({ order_id: 'ord_f' })],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_f',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: '2026-10-02T00:00:00Z',
        }),
        evt({
          event_id: 'e2',
          order_id: 'ord_f',
          kit_id: 'kit_1',
          event_type: 'kit_delivered',
          occurred_at: '2026-10-21T00:00:00Z',
        }),
      ],
    );
    expect(quality.postSnapshotEvents).toBeGreaterThanOrEqual(1);
    expect(lifecycles.get('ord_f')!.currentStage).toBe('kit_shipped');
  });
});

describe('SLA boundary', () => {
  it('exact target boundary is not overdue; exceeding is', () => {
    const exactStart = SNAP - STAGE_TARGETS.ship_to_deliver * MS_PER_DAY;
    const overStart = SNAP - (STAGE_TARGETS.ship_to_deliver + 0.01) * MS_PER_DAY;

    const exact = process(
      [order({ order_id: 'ord_exact' })],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_exact',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: new Date(exactStart).toISOString(),
        }),
      ],
    ).lifecycles.get('ord_exact')!;

    const over = process(
      [order({ order_id: 'ord_over' })],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_over',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: new Date(overStart).toISOString(),
        }),
      ],
    ).lifecycles.get('ord_over')!;

    expect(exact.daysOverdue).toBeNull();
    expect(over.daysOverdue).not.toBeNull();
    expect(over.daysOverdue!).toBeGreaterThan(0);
  });
});

describe('no cross-kit durations', () => {
  it('does not compute durations across different kit IDs', () => {
    const q = emptyQ();
    const { lifecycles } = process(
      [order({ order_id: 'ord_g' })],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_g',
          kit_id: 'kit_a',
          event_type: 'kit_shipped',
          occurred_at: '2026-09-01T00:00:00Z',
        }),
        evt({
          event_id: 'e2',
          order_id: 'ord_g',
          kit_id: 'kit_a',
          event_type: 'kit_replaced',
          occurred_at: '2026-09-05T00:00:00Z',
        }),
        evt({
          event_id: 'e3',
          order_id: 'ord_g',
          kit_id: 'kit_b',
          event_type: 'kit_shipped',
          occurred_at: '2026-09-06T00:00:00Z',
        }),
        evt({
          event_id: 'e4',
          order_id: 'ord_g',
          kit_id: 'kit_b',
          event_type: 'kit_delivered',
          occurred_at: '2026-09-08T00:00:00Z',
        }),
      ],
    );
    const lc = lifecycles.get('ord_g')!;
    const kitA = lc.attempts.find((a) => a.kit_id === 'kit_a')!;
    const kitB = lc.attempts.find((a) => a.kit_id === 'kit_b')!;
    expect(stageDurationDays(kitA, 'ship_to_deliver', lc.order.created_at_ms, q)).toBeNull();
    expect(stageDurationDays(kitB, 'ship_to_deliver', lc.order.created_at_ms, q)).toBeCloseTo(2, 5);
  });
});

describe('incomplete stages', () => {
  it('shows unavailable observations as null (UI renders —)', () => {
    const { lifecycles, quality } = process(
      [
        order({ order_id: 'ord_h', product: 'wgs_30x' }),
        order({ order_id: 'ord_i', product: 'wgs_100x' }),
      ],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_h',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: '2026-10-02T00:00:00Z',
        }),
      ],
    );
    const rows = computeTurnaround([...lifecycles.values()], quality);
    const shipToDeliver = rows.find((r) => r.stageKey === 'ship_to_deliver')!;
    expect(shipToDeliver.byProduct.wgs_30x?.count).toBe(0);
    expect(shipToDeliver.byProduct.wgs_30x?.medianDays).toBeNull();
    expect(shipToDeliver.byProduct.wgs_100x?.medianDays).toBeNull();
  });
});

describe('qc_failed follow-up without SLA', () => {
  it('flags failed QC awaiting replacement separately', () => {
    const { lifecycles } = process(
      [order({ order_id: 'ord_qc' })],
      [
        evt({
          event_id: 'e1',
          order_id: 'ord_qc',
          kit_id: 'kit_1',
          event_type: 'kit_shipped',
          occurred_at: '2026-09-01T00:00:00Z',
        }),
        evt({
          event_id: 'e2',
          order_id: 'ord_qc',
          kit_id: 'kit_1',
          event_type: 'sample_received',
          occurred_at: '2026-09-20T00:00:00Z',
        }),
        evt({
          event_id: 'e3',
          order_id: 'ord_qc',
          kit_id: 'kit_1',
          event_type: 'qc_failed',
          occurred_at: '2026-09-22T00:00:00Z',
        }),
      ],
    );
    const lc = lifecycles.get('ord_qc')!;
    expect(lc.currentStage).toBe('qc_failed');
    expect(lc.daysOverdue).toBeNull();
    expect(lc.followUpReasons).toContain('qc_failed_awaiting_replacement');
    const queue = computeFollowUpQueue([lc]);
    expect(queue[0]?.targetDays).toBeNull();
    expect(queue[0]?.daysOverdue).toBeNull();
  });
});

describe('CSV load atomic validation', () => {
  it('rejects missing headers without producing a dataset', () => {
    const bad = loadFromCsvTexts('order_id,foo\nx,y\n', 'event_id\n1\n');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes('missing required'))).toBe(true);
    }
  });

  it('handles BOM and reordered columns', () => {
    const orders =
      '\uFEFFcountry,order_id,created_at,customer_id,product,status,is_test\n' +
      'US,ord_bom,2026-10-01T00:00:00Z,cus_1,wgs_30x,paid,false\n';
    const events =
      'source,event_id,order_id,kit_id,event_type,occurred_at\n' +
      'system,evt_1,ord_bom,kit_1,kit_shipped,2026-10-02T00:00:00Z\n';
    const ok = loadFromCsvTexts(orders, events);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.dataset.orders[0]?.order_id).toBe('ord_bom');
    }
  });
});

describe('elapsed days', () => {
  it('uses fractional calendar days', () => {
    const d = elapsedDays(Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-10-01T12:00:00Z'));
    expect(d).toBeCloseTo(0.5, 5);
  });
});
