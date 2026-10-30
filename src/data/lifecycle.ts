import {
  CURRENT_STAGE_LABELS,
  FOLLOW_UP_REASON_LABELS,
  MILESTONE_RANK,
  PIPELINE_ORDER,
  STAGE_KEYS,
  STAGE_LABELS,
  STAGE_TARGET_FOR_CURRENT,
  STAGE_TARGETS,
} from './constants';
import { elapsedDays, median, percentile90 } from './timestamps';
import type {
  CurrentStage,
  DashboardFilters,
  DataQualityReport,
  FollowUpItem,
  FollowUpReason,
  KitAttempt,
  KitEvent,
  LifecycleMilestone,
  Order,
  OrderLifecycle,
  OverviewMetrics,
  ProcessedDataset,
  StageKey,
  StageTurnaroundRow,
} from './types';
import { LIFECYCLE_MILESTONES } from './types';

function isLifecycleMilestone(t: string): t is LifecycleMilestone {
  return (LIFECYCLE_MILESTONES as readonly string[]).includes(t);
}

/** Build kit attempts grouped by order_id + kit_id. */
export function buildAttempts(
  order: Order,
  events: KitEvent[],
  quality: DataQualityReport,
): KitAttempt[] {
  const byKit = new Map<string, KitEvent[]>();
  for (const e of events) {
    if (e.orphan || e.postSnapshot || e.unknownType) continue;
    if (e.order_id !== order.order_id) continue;
    const list = byKit.get(e.kit_id) ?? [];
    list.push(e);
    byKit.set(e.kit_id, list);
  }

  const attempts: KitAttempt[] = [];

  for (const [kit_id, kitEvents] of byKit) {
    const sorted = [...kitEvents].sort((a, b) => a.occurred_at_ms - b.occurred_at_ms);
    const milestones: Partial<Record<LifecycleMilestone, number>> = {};
    const warnings: string[] = [];
    let replaced_at_ms: number | null = null;

    for (const e of sorted) {
      if (e.event_type === 'kit_replaced') {
        if (replaced_at_ms == null || e.occurred_at_ms < replaced_at_ms) {
          replaced_at_ms = e.occurred_at_ms;
        }
        continue;
      }
      if (!isLifecycleMilestone(e.event_type)) continue;

      const existing = milestones[e.event_type];
      if (existing != null && existing !== e.occurred_at_ms) {
        // Deterministic: keep earliest occurrence; flag contradiction
        quality.contradictions += 1;
        warnings.push(
          `Repeated ${e.event_type} at different times; kept earliest (${new Date(existing).toISOString()}).`,
        );
        if (e.occurred_at_ms < existing) {
          milestones[e.event_type] = e.occurred_at_ms;
        }
      } else if (existing == null) {
        milestones[e.event_type] = e.occurred_at_ms;
      }
    }

    if (milestones.qc_passed != null && milestones.qc_failed != null) {
      quality.contradictions += 1;
      warnings.push('Incompatible QC outcomes (both passed and failed) on same kit.');
    }

    // Impossible chronology: later milestone before earlier ones (when both present)
    const ordered: LifecycleMilestone[] = [
      'kit_shipped',
      'kit_delivered',
      'sample_mailed',
      'sample_received',
      'qc_passed',
      'sequencing_complete',
      'report_ready',
    ];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = milestones[ordered[i]!];
        const b = milestones[ordered[j]!];
        if (a != null && b != null && b < a) {
          quality.contradictions += 1;
          warnings.push(
            `Impossible chronology: ${ordered[j]} before ${ordered[i]} on kit ${kit_id}.`,
          );
        }
      }
    }
    // qc_failed vs pipeline
    if (milestones.qc_failed != null && milestones.sequencing_complete != null) {
      quality.contradictions += 1;
      warnings.push(`Sequencing after qc_failed on kit ${kit_id}.`);
    }

    let furthest: LifecycleMilestone | null = null;
    let furthestMs: number | null = null;
    for (const m of Object.keys(milestones) as LifecycleMilestone[]) {
      const rank = MILESTONE_RANK[m] ?? 0;
      const ms = milestones[m]!;
      if (
        furthest == null ||
        rank > (MILESTONE_RANK[furthest] ?? 0) ||
        (rank === (MILESTONE_RANK[furthest] ?? 0) && ms > (furthestMs ?? 0))
      ) {
        // Prefer qc_passed over qc_failed at same rank if both somehow present — already warned
        if (furthest && MILESTONE_RANK[m] === MILESTONE_RANK[furthest] && m === 'qc_failed' && furthest === 'qc_passed') {
          continue;
        }
        furthest = m;
        furthestMs = ms;
      }
    }

    const started_at_ms =
      milestones.kit_shipped ??
      (sorted.length > 0 ? sorted[0]!.occurred_at_ms : null);

    attempts.push({
      order_id: order.order_id,
      kit_id,
      events: sorted,
      started_at_ms,
      replaced_at_ms,
      is_replaced: replaced_at_ms != null,
      furthest_milestone: furthest,
      furthest_milestone_ms: furthestMs,
      milestones,
      warnings,
    });
  }

  // Deterministic ordering: by started_at, then kit_id
  attempts.sort((a, b) => {
    const as = a.started_at_ms ?? Number.MAX_SAFE_INTEGER;
    const bs = b.started_at_ms ?? Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    return a.kit_id.localeCompare(b.kit_id);
  });

  return attempts;
}

function stageFromMilestone(m: LifecycleMilestone | null): CurrentStage {
  if (!m) return 'unknown';
  return m;
}

/**
 * Choose primary attempt for order-level summary.
 * Rule: among non-replaced attempts, prefer the one with furthest milestone;
 * if tie, prefer most recently started. If none active, use latest replaced attempt for history.
 * Flag multiple active kits.
 */
export function selectPrimaryAttempt(
  attempts: KitAttempt[],
  quality: DataQualityReport,
): { primary: KitAttempt | null; multipleActive: boolean } {
  const active = attempts.filter((a) => !a.is_replaced);
  if (active.length > 1) {
    quality.multipleActiveKits += 1;
  }

  if (active.length === 0) {
    // All replaced or none — use most recently replaced / last attempt for history display
    if (attempts.length === 0) return { primary: null, multipleActive: false };
    const last = [...attempts].sort((a, b) => {
      const ar = a.replaced_at_ms ?? a.started_at_ms ?? 0;
      const br = b.replaced_at_ms ?? b.started_at_ms ?? 0;
      return br - ar;
    })[0]!;
    return { primary: last, multipleActive: false };
  }

  const ranked = [...active].sort((a, b) => {
    const ra = a.furthest_milestone ? MILESTONE_RANK[a.furthest_milestone] ?? 0 : 0;
    const rb = b.furthest_milestone ? MILESTONE_RANK[b.furthest_milestone] ?? 0 : 0;
    if (ra !== rb) return rb - ra;
    const as = a.started_at_ms ?? 0;
    const bs = b.started_at_ms ?? 0;
    if (as !== bs) return bs - as;
    return a.kit_id.localeCompare(b.kit_id);
  });

  return { primary: ranked[0]!, multipleActive: active.length > 1 };
}

/** Latest kit_replaced with no subsequent non-replaced kit_shipped. */
function replacementAwaitingShipMs(attempts: KitAttempt[]): number | null {
  const replaced = attempts.filter((a) => a.is_replaced && a.replaced_at_ms != null);
  if (replaced.length === 0) return null;
  const latestReplace = Math.max(...replaced.map((a) => a.replaced_at_ms!));
  const newerShipped = attempts.some(
    (a) =>
      !a.is_replaced &&
      a.milestones.kit_shipped != null &&
      a.milestones.kit_shipped >= latestReplace,
  );
  return newerShipped ? null : latestReplace;
}

function computeCurrentState(
  order: Order,
  attempts: KitAttempt[],
  primary: KitAttempt | null,
  multipleActive: boolean,
  snapshotMs: number,
  quality: DataQualityReport,
): Pick<
  OrderLifecycle,
  | 'currentStage'
  | 'currentStageStartMs'
  | 'stageAgeDays'
  | 'stageTargetDays'
  | 'daysOverdue'
  | 'completed'
  | 'active'
  | 'awaitingFirstShipment'
  | 'awaitingReplacementShipment'
  | 'followUpReasons'
  | 'warnings'
> {
  const warnings: string[] = [...(primary?.warnings ?? [])];
  const followUpReasons: FollowUpReason[] = [];

  if (multipleActive) {
    warnings.push('Multiple apparently active kits; using furthest/most-recent for summary.');
    followUpReasons.push('multiple_active_kits');
  }

  const hasAnyShip = attempts.some((a) => a.milestones.kit_shipped != null);
  const replacedAwaitingMs = replacementAwaitingShipMs(attempts);

  let currentStage: CurrentStage;
  let currentStageStartMs: number | null;

  if (!hasAnyShip && replacedAwaitingMs == null) {
    currentStage = 'awaiting_first_shipment';
    currentStageStartMs = order.created_at_ms;
  } else if (replacedAwaitingMs != null) {
    currentStage = 'awaiting_replacement_shipment';
    currentStageStartMs = replacedAwaitingMs;
  } else if (primary && !primary.is_replaced && primary.furthest_milestone) {
    currentStage = stageFromMilestone(primary.furthest_milestone);
    currentStageStartMs = primary.furthest_milestone_ms;
  } else {
    currentStage = 'unknown';
    currentStageStartMs = null;
    warnings.push('Current-stage start is missing or ambiguous.');
  }

  const completed = currentStage === 'report_ready';
  const awaitingFirstShipment = currentStage === 'awaiting_first_shipment';
  const awaitingReplacementShipment = currentStage === 'awaiting_replacement_shipment';

  const active =
    !completed &&
    !awaitingFirstShipment &&
    (awaitingReplacementShipment ||
      (primary != null && !primary.is_replaced && primary.furthest_milestone != null));

  let stageAgeDays: number | null = null;
  if (currentStageStartMs != null) {
    const age = elapsedDays(currentStageStartMs, snapshotMs);
    if (age < 0) {
      quality.negativeIntervals += 1;
      warnings.push('Negative stage age; shown as unknown.');
      stageAgeDays = null;
    } else {
      stageAgeDays = age;
    }
  } else if (!completed) {
    warnings.push('Unknown stage age (missing start timestamp).');
  }

  const stageTargetDays = STAGE_TARGET_FOR_CURRENT[currentStage] ?? null;

  let daysOverdue: number | null = null;
  if (
    stageAgeDays != null &&
    stageTargetDays != null &&
    currentStage !== 'report_ready' &&
    currentStage !== 'qc_failed'
  ) {
    // Overdue only when age exceeds target (exact boundary is NOT overdue)
    if (stageAgeDays > stageTargetDays) {
      daysOverdue = stageAgeDays - stageTargetDays;
    }
  }

  if (daysOverdue != null) {
    if (awaitingFirstShipment) {
      followUpReasons.push('awaiting_first_shipment_overdue');
    } else if (awaitingReplacementShipment) {
      followUpReasons.push('awaiting_replacement_shipment_overdue');
    } else {
      followUpReasons.push('sla_overdue');
    }
  }

  if (
    primary &&
    !primary.is_replaced &&
    primary.furthest_milestone === 'qc_failed' &&
    currentStage === 'qc_failed'
  ) {
    followUpReasons.push('qc_failed_awaiting_replacement');
  }

  return {
    currentStage,
    currentStageStartMs,
    stageAgeDays,
    stageTargetDays,
    daysOverdue,
    completed,
    active,
    awaitingFirstShipment,
    awaitingReplacementShipment,
    followUpReasons,
    warnings,
  };
}

export function buildOrderLifecycle(
  order: Order,
  allEvents: KitEvent[],
  snapshotMs: number,
  quality: DataQualityReport,
): OrderLifecycle {
  const events = allEvents.filter(
    (e) => e.order_id === order.order_id && !e.orphan && !e.postSnapshot,
  );
  const attempts = buildAttempts(order, events, quality);
  const { primary, multipleActive } = selectPrimaryAttempt(attempts, quality);
  const state = computeCurrentState(
    order,
    attempts,
    primary,
    multipleActive,
    snapshotMs,
    quality,
  );

  return {
    order,
    attempts,
    primaryAttempt: primary,
    events,
    ...state,
  };
}

export function buildAllLifecycles(
  orders: Order[],
  events: KitEvent[],
  snapshotMs: number,
  quality: DataQualityReport,
): Map<string, OrderLifecycle> {
  const map = new Map<string, OrderLifecycle>();
  for (const order of orders) {
    map.set(order.order_id, buildOrderLifecycle(order, events, snapshotMs, quality));
  }
  return map;
}

/** Completed-stage duration only when both endpoints exist on the same kit. */
export function stageDurationDays(
  attempt: KitAttempt,
  stage: StageKey,
  orderCreatedMs: number,
  quality?: DataQualityReport,
): number | null {
  const m = attempt.milestones;
  let start: number | null | undefined;
  let end: number | null | undefined;

  switch (stage) {
    case 'order_to_ship':
      // Only for the first kit attempt of an order — caller must gate this.
      start = orderCreatedMs;
      end = m.kit_shipped;
      break;
    case 'ship_to_deliver':
      start = m.kit_shipped;
      end = m.kit_delivered;
      break;
    case 'deliver_to_mail':
      start = m.kit_delivered;
      end = m.sample_mailed;
      break;
    case 'mail_to_receive':
      start = m.sample_mailed;
      end = m.sample_received;
      break;
    case 'receive_to_qc':
      start = m.sample_received;
      end = m.qc_passed ?? m.qc_failed;
      break;
    case 'qc_to_sequence':
      start = m.qc_passed;
      end = m.sequencing_complete;
      break;
    case 'sequence_to_report':
      start = m.sequencing_complete;
      end = m.report_ready;
      break;
  }

  if (start == null || end == null) return null;
  const days = elapsedDays(start, end);
  if (days < 0) {
    if (quality) quality.negativeIntervals += 1;
    return null;
  }
  return days;
}

export function passesFilters(lc: OrderLifecycle, filters: DashboardFilters): boolean {
  const { order } = lc;
  if (filters.dateRange) {
    const [start, end] = filters.dateRange;
    if (order.created_at_ms < start || order.created_at_ms > end) return false;
  }
  if (filters.products.length > 0 && !filters.products.includes(order.product)) {
    return false;
  }
  if (filters.countries.length > 0 && !filters.countries.includes(order.country)) {
    return false;
  }
  return true;
}

export function computeOverview(
  lifecycles: OrderLifecycle[],
): OverviewMetrics {
  const eligible = lifecycles.filter((l) => l.order.eligible);
  const exclusionCounts: Record<string, number> = {};
  for (const l of lifecycles) {
    if (l.order.eligible) continue;
    for (const r of l.order.exclusionReasons) {
      exclusionCounts[r] = (exclusionCounts[r] ?? 0) + 1;
    }
    if (l.order.exclusionReasons.length === 0) {
      exclusionCounts['other'] = (exclusionCounts['other'] ?? 0) + 1;
    }
  }

  let awaitingFirstShipment = 0;
  let activeKits = 0;
  let completedOrders = 0;
  let needingFollowUp = 0;
  const pipelineCounts = new Map<CurrentStage, number>();

  for (const l of eligible) {
    if (l.awaitingFirstShipment) awaitingFirstShipment += 1;
    if (l.completed) completedOrders += 1;

    // Active kits: count non-replaced incomplete kit attempts (physical kits, not orders)
    for (const a of l.attempts) {
      if (a.is_replaced) continue;
      if (a.furthest_milestone === 'report_ready') continue;
      if (a.furthest_milestone == null && !l.awaitingReplacementShipment) continue;
      // Count kits that have started (shipped) or are replacement awaiting ship represented at order level
      if (a.milestones.kit_shipped != null || a.furthest_milestone != null) {
        activeKits += 1;
      }
    }
    if (l.awaitingReplacementShipment) {
      // Order waiting for replacement kit that hasn't shipped yet — counts as active pipeline item
      // but not as a physical kit yet. Tracked in pipeline separately.
    }

    if (l.followUpReasons.length > 0) needingFollowUp += 1;

    if (!l.completed) {
      const stage = l.currentStage;
      pipelineCounts.set(stage, (pipelineCounts.get(stage) ?? 0) + 1);
    }
  }

  const pipeline = PIPELINE_ORDER.map((stage) => ({
    stage,
    label: CURRENT_STAGE_LABELS[stage],
    count: pipelineCounts.get(stage) ?? 0,
  })).filter((p) => p.count > 0 || PIPELINE_ORDER.includes(p.stage));

  return {
    eligiblePhysicalKitOrders: eligible.length,
    awaitingFirstShipment,
    activeKits,
    completedOrders,
    needingFollowUp,
    pipeline,
    exclusionCounts,
  };
}

export function computeTurnaround(
  lifecycles: OrderLifecycle[],
  quality: DataQualityReport,
): StageTurnaroundRow[] {
  const eligible = lifecycles.filter((l) => l.order.eligible);
  const products = ['wgs_30x', 'wgs_100x', '_all'];

  return STAGE_KEYS.map((stageKey) => {
    const byProduct: StageTurnaroundRow['byProduct'] = {};
    for (const product of products) {
      const durations: number[] = [];
      for (const l of eligible) {
        if (product !== '_all' && l.order.product !== product) continue;

        if (stageKey === 'order_to_ship') {
          // First kit's shipment only — earliest kit_shipped across attempts
          const shipped = l.attempts
            .map((a) => a.milestones.kit_shipped)
            .filter((x): x is number => x != null)
            .sort((a, b) => a - b);
          if (shipped.length === 0) continue;
          const days = elapsedDays(l.order.created_at_ms, shipped[0]!);
          if (days < 0) {
            quality.negativeIntervals += 1;
            continue;
          }
          durations.push(days);
          continue;
        }

        for (const attempt of l.attempts) {
          // Include replaced attempts for historical completed-stage observations
          const d = stageDurationDays(attempt, stageKey, l.order.created_at_ms, quality);
          if (d != null) durations.push(d);
        }
      }

      byProduct[product] = {
        count: durations.length,
        medianDays: median(durations),
        p90Days: percentile90(durations),
      };
    }

    return {
      stageKey,
      label: STAGE_LABELS[stageKey],
      targetDays: STAGE_TARGETS[stageKey],
      byProduct,
    };
  });
}

export function computeFollowUpQueue(lifecycles: OrderLifecycle[]): FollowUpItem[] {
  const items: FollowUpItem[] = [];

  for (const l of lifecycles) {
    if (!l.order.eligible) continue;
    if (l.followUpReasons.length === 0) continue;

    for (const reason of l.followUpReasons) {
      items.push({
        order_id: l.order.order_id,
        kit_id: l.primaryAttempt?.kit_id ?? null,
        product: l.order.product,
        country: l.order.country,
        stage: l.currentStage,
        stageLabel: CURRENT_STAGE_LABELS[l.currentStage],
        stageAgeDays: l.stageAgeDays,
        targetDays: reason === 'qc_failed_awaiting_replacement' ? null : l.stageTargetDays,
        daysOverdue: reason === 'qc_failed_awaiting_replacement' ? null : l.daysOverdue,
        reason,
        reasonLabel: FOLLOW_UP_REASON_LABELS[reason],
      });
    }
  }

  // Sort SLA-overdue by days overdue desc; QC failures after / separately stable
  items.sort((a, b) => {
    const aSla = a.daysOverdue != null ? 1 : 0;
    const bSla = b.daysOverdue != null ? 1 : 0;
    if (aSla !== bSla) return bSla - aSla;
    if (a.daysOverdue != null && b.daysOverdue != null) {
      return b.daysOverdue - a.daysOverdue;
    }
    return a.order_id.localeCompare(b.order_id);
  });

  return items;
}

export function processDataset(
  orders: Order[],
  events: KitEvent[],
  quality: DataQualityReport,
  snapshotMs: number,
): ProcessedDataset {
  const lifecycles = buildAllLifecycles(orders, events, snapshotMs, quality);
  const products = [...new Set(orders.map((o) => o.product))].sort();
  const countries = [...new Set(orders.map((o) => o.country))].sort();
  return { orders, events, lifecycles, quality, snapshotMs, products, countries };
}

export { CURRENT_STAGE_LABELS, FOLLOW_UP_REASON_LABELS, STAGE_LABELS };
