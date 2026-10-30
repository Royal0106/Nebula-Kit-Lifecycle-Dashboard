export type Product = 'wgs_30x' | 'wgs_100x' | 'upload_only' | string;
export type OrderStatus = 'paid' | 'refunded' | 'cancelled' | string;
export type EventSource = 'carrier' | 'lab' | 'system' | string;

export const KNOWN_EVENT_TYPES = [
  'kit_shipped',
  'kit_delivered',
  'sample_mailed',
  'sample_received',
  'qc_passed',
  'qc_failed',
  'sequencing_complete',
  'report_ready',
  'kit_replaced',
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/** Lifecycle milestones used for current-stage ranking (excludes kit_replaced). */
export const LIFECYCLE_MILESTONES = [
  'kit_shipped',
  'kit_delivered',
  'sample_mailed',
  'sample_received',
  'qc_passed',
  'qc_failed',
  'sequencing_complete',
  'report_ready',
] as const;

export type LifecycleMilestone = (typeof LIFECYCLE_MILESTONES)[number];

export type StageKey =
  | 'order_to_ship'
  | 'ship_to_deliver'
  | 'deliver_to_mail'
  | 'mail_to_receive'
  | 'receive_to_qc'
  | 'qc_to_sequence'
  | 'sequence_to_report';

export interface RawOrderRow {
  order_id: string;
  created_at: string;
  customer_id: string;
  product: string;
  country: string;
  status: string;
  is_test: string;
}

export interface RawEventRow {
  event_id: string;
  order_id: string;
  kit_id: string;
  event_type: string;
  occurred_at: string;
  source: string;
}

export interface Order {
  order_id: string;
  created_at_ms: number;
  created_at_raw: string;
  customer_id: string;
  product: Product;
  country: string;
  status: OrderStatus;
  is_test: boolean;
  /** True when this order row conflicted with another for the same ID. */
  conflict?: boolean;
  exclusionReasons: string[];
  eligible: boolean;
}

export interface KitEvent {
  event_id: string;
  order_id: string;
  kit_id: string;
  event_type: string;
  occurred_at_ms: number;
  occurred_at_raw: string;
  source: EventSource;
  timezoneAssumedUtc: boolean;
  orphan: boolean;
  postSnapshot: boolean;
  unknownType: boolean;
}

export interface DataQualityReport {
  duplicateEvents: number;
  invalidTimestamps: number;
  orphanEvents: number;
  unknownEventTypes: number;
  postSnapshotEvents: number;
  conflictingOrders: number;
  malformedOrders: number;
  malformedEvents: number;
  negativeIntervals: number;
  contradictions: number;
  multipleActiveKits: number;
  timezoneAssumedUtc: number;
  messages: string[];
}

export type CurrentStage =
  | 'awaiting_first_shipment'
  | 'awaiting_replacement_shipment'
  | 'kit_shipped'
  | 'kit_delivered'
  | 'sample_mailed'
  | 'sample_received'
  | 'qc_passed'
  | 'qc_failed'
  | 'sequencing_complete'
  | 'report_ready'
  | 'unknown';

export type FollowUpReason =
  | 'sla_overdue'
  | 'awaiting_first_shipment_overdue'
  | 'awaiting_replacement_shipment_overdue'
  | 'qc_failed_awaiting_replacement'
  | 'multiple_active_kits';

export interface KitAttempt {
  order_id: string;
  kit_id: string;
  events: KitEvent[];
  /** Earliest known timestamp for the attempt (shipped or first event). */
  started_at_ms: number | null;
  replaced_at_ms: number | null;
  is_replaced: boolean;
  furthest_milestone: LifecycleMilestone | null;
  furthest_milestone_ms: number | null;
  milestones: Partial<Record<LifecycleMilestone, number>>;
  warnings: string[];
}

export interface OrderLifecycle {
  order: Order;
  attempts: KitAttempt[];
  /** Deterministic primary attempt for order-level summary. */
  primaryAttempt: KitAttempt | null;
  currentStage: CurrentStage;
  currentStageStartMs: number | null;
  stageAgeDays: number | null;
  stageTargetDays: number | null;
  daysOverdue: number | null;
  completed: boolean;
  active: boolean;
  awaitingFirstShipment: boolean;
  awaitingReplacementShipment: boolean;
  followUpReasons: FollowUpReason[];
  warnings: string[];
  events: KitEvent[];
}

export interface StageTurnaroundRow {
  stageKey: StageKey;
  label: string;
  targetDays: number;
  byProduct: Record<
    string,
    {
      count: number;
      medianDays: number | null;
      p90Days: number | null;
    }
  >;
}

export interface PipelineBucket {
  stage: CurrentStage;
  label: string;
  count: number;
}

export interface OverviewMetrics {
  eligiblePhysicalKitOrders: number;
  awaitingFirstShipment: number;
  activeKits: number;
  completedOrders: number;
  needingFollowUp: number;
  pipeline: PipelineBucket[];
  exclusionCounts: Record<string, number>;
}

export interface FollowUpItem {
  order_id: string;
  kit_id: string | null;
  product: string;
  country: string;
  stage: CurrentStage;
  stageLabel: string;
  stageAgeDays: number | null;
  targetDays: number | null;
  daysOverdue: number | null;
  reason: FollowUpReason;
  reasonLabel: string;
}

export interface DashboardFilters {
  dateRange: [number, number] | null;
  products: string[];
  countries: string[];
}

export interface ProcessedDataset {
  orders: Order[];
  events: KitEvent[];
  lifecycles: Map<string, OrderLifecycle>;
  quality: DataQualityReport;
  snapshotMs: number;
  products: string[];
  countries: string[];
}
