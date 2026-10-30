import type { CurrentStage, FollowUpReason, StageKey } from './types';

/** Default export snapshot matching challenge/generate.mjs AS_OF. */
export const DEFAULT_SNAPSHOT_ISO = '2026-10-20T00:00:00Z';
export const DEFAULT_SNAPSHOT_MS = Date.parse(DEFAULT_SNAPSHOT_ISO);

export const MS_PER_DAY = 86_400_000;

export const ELIGIBLE_PRODUCTS = new Set(['wgs_30x', 'wgs_100x']);

export const STAGE_TARGETS: Record<StageKey, number> = {
  order_to_ship: 3,
  ship_to_deliver: 7,
  deliver_to_mail: 45,
  mail_to_receive: 14,
  receive_to_qc: 7,
  qc_to_sequence: 28,
  sequence_to_report: 5,
};

export const STAGE_LABELS: Record<StageKey, string> = {
  order_to_ship: 'Order placed → kit shipped',
  ship_to_deliver: 'Kit shipped → kit delivered',
  deliver_to_mail: 'Kit delivered → sample mailed',
  mail_to_receive: 'Sample mailed → sample received',
  receive_to_qc: 'Sample received → QC result',
  qc_to_sequence: 'QC passed → sequencing complete',
  sequence_to_report: 'Sequencing complete → report ready',
};

export const STAGE_KEYS: StageKey[] = [
  'order_to_ship',
  'ship_to_deliver',
  'deliver_to_mail',
  'mail_to_receive',
  'receive_to_qc',
  'qc_to_sequence',
  'sequence_to_report',
];

/** Rank for furthest-milestone selection. Higher = further along. */
export const MILESTONE_RANK: Record<string, number> = {
  kit_shipped: 1,
  kit_delivered: 2,
  sample_mailed: 3,
  sample_received: 4,
  qc_failed: 5,
  qc_passed: 5,
  sequencing_complete: 6,
  report_ready: 7,
};

export const CURRENT_STAGE_LABELS: Record<CurrentStage, string> = {
  awaiting_first_shipment: 'Awaiting first shipment',
  awaiting_replacement_shipment: 'Awaiting replacement shipment',
  kit_shipped: 'In transit to customer',
  kit_delivered: 'Delivered (awaiting sample mail)',
  sample_mailed: 'Sample in transit to lab',
  sample_received: 'At lab (awaiting QC)',
  qc_passed: 'QC passed (awaiting sequencing)',
  qc_failed: 'QC failed (awaiting action)',
  sequencing_complete: 'Sequencing complete (awaiting report)',
  report_ready: 'Report ready',
  unknown: 'Unknown',
};

export const FOLLOW_UP_REASON_LABELS: Record<FollowUpReason, string> = {
  sla_overdue: 'SLA overdue',
  awaiting_first_shipment_overdue: 'First shipment overdue',
  awaiting_replacement_shipment_overdue: 'Replacement shipment overdue',
  qc_failed_awaiting_replacement: 'Failed QC awaiting replacement',
  multiple_active_kits: 'Multiple active kits',
};

/**
 * Target for the stage the kit is currently waiting in.
 * After milestone X, we measure age from X against the next stage target.
 */
export const STAGE_TARGET_FOR_CURRENT: Partial<Record<CurrentStage, number>> = {
  awaiting_first_shipment: STAGE_TARGETS.order_to_ship,
  awaiting_replacement_shipment: STAGE_TARGETS.order_to_ship, // assumption: same 3-day ship target
  kit_shipped: STAGE_TARGETS.ship_to_deliver,
  kit_delivered: STAGE_TARGETS.deliver_to_mail,
  sample_mailed: STAGE_TARGETS.mail_to_receive,
  sample_received: STAGE_TARGETS.receive_to_qc,
  qc_passed: STAGE_TARGETS.qc_to_sequence,
  sequencing_complete: STAGE_TARGETS.sequence_to_report,
  // qc_failed: no SLA — separate follow-up reason
  // report_ready: complete, never overdue
};

export const PIPELINE_ORDER: CurrentStage[] = [
  'awaiting_first_shipment',
  'awaiting_replacement_shipment',
  'kit_shipped',
  'kit_delivered',
  'sample_mailed',
  'sample_received',
  'qc_failed',
  'qc_passed',
  'sequencing_complete',
];

export const ORDER_REQUIRED_COLUMNS = [
  'order_id',
  'created_at',
  'customer_id',
  'product',
  'country',
  'status',
  'is_test',
] as const;

export const EVENT_REQUIRED_COLUMNS = [
  'event_id',
  'order_id',
  'kit_id',
  'event_type',
  'occurred_at',
  'source',
] as const;
