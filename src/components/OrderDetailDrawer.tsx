import { Alert, Drawer, Empty, Tag, Timeline, Typography } from 'antd';
import { CURRENT_STAGE_LABELS } from '../data/constants';
import { formatDays } from '../data/timestamps';
import type { OrderLifecycle } from '../data/types';

interface Props {
  lifecycle: OrderLifecycle | null;
  open: boolean;
  onClose: () => void;
}

function fmtTs(ms: number | null | undefined, raw?: string): string {
  if (ms == null) return '—';
  return `${new Date(ms).toISOString()}${raw && !raw.includes('Z') && !/[+-]\d{2}:?\d{2}$/.test(raw) ? ' (assumed UTC)' : ''}`;
}

export function OrderDetailDrawer({ lifecycle, open, onClose }: Props) {
  return (
    <Drawer
      title={lifecycle ? `Order ${lifecycle.order.order_id}` : 'Order detail'}
      open={open}
      onClose={onClose}
      width={Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 24 : 560)}
      destroyOnClose
    >
      {!lifecycle ? (
        <Empty description="Order not found" />
      ) : (
        <>
          {!lifecycle.order.eligible && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Excluded from default operational metrics"
              description={`Reasons: ${lifecycle.order.exclusionReasons.join(', ') || 'n/a'}`}
            />
          )}

          {lifecycle.warnings.length > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Data warnings"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {lifecycle.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              }
            />
          )}

          <dl className="order-meta-grid">
            <div>
              <dt>Customer</dt>
              <dd>{lifecycle.order.customer_id}</dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd>{lifecycle.order.product}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd>{lifecycle.order.country}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{lifecycle.order.status}</dd>
            </div>
            <div>
              <dt>Test order</dt>
              <dd>{lifecycle.order.is_test ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt>Created (UTC)</dt>
              <dd style={{ fontSize: 12 }}>{fmtTs(lifecycle.order.created_at_ms)}</dd>
            </div>
            <div>
              <dt>Current stage</dt>
              <dd>{CURRENT_STAGE_LABELS[lifecycle.currentStage]}</dd>
            </div>
            <div>
              <dt>Stage age</dt>
              <dd>
                {lifecycle.stageAgeDays == null
                  ? 'unknown'
                  : `${formatDays(lifecycle.stageAgeDays, 1)} days`}
              </dd>
            </div>
          </dl>

          <Typography.Title level={5}>Kit attempts</Typography.Title>
          {lifecycle.attempts.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No kit events" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {lifecycle.attempts.map((a) => (
                <div
                  key={a.kit_id}
                  style={{
                    border: '1px solid #e3e6ee',
                    borderRadius: 8,
                    padding: '8px 12px',
                    background: a.is_replaced ? '#fafafa' : '#fff',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Typography.Text code>{a.kit_id}</Typography.Text>
                    {a.is_replaced && <Tag>Replaced</Tag>}
                    {lifecycle.primaryAttempt?.kit_id === a.kit_id && (
                      <Tag color="blue">Primary</Tag>
                    )}
                    {a.furthest_milestone ? (
                      <Tag>{a.furthest_milestone}</Tag>
                    ) : (
                      <Tag>No milestones</Tag>
                    )}
                  </div>
                  {a.warnings.map((w) => (
                    <Typography.Text key={w} type="warning" style={{ display: 'block', fontSize: 12 }}>
                      {w}
                    </Typography.Text>
                  ))}
                </div>
              ))}
            </div>
          )}

          <Typography.Title level={5}>Timeline</Typography.Title>
          {lifecycle.events.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No events" />
          ) : (
            <Timeline
              items={lifecycle.events.map((e) => ({
                color:
                  e.event_type === 'qc_failed'
                    ? 'red'
                    : e.event_type === 'kit_replaced'
                      ? 'orange'
                      : e.event_type === 'report_ready'
                        ? 'green'
                        : 'blue',
                children: (
                  <div>
                    <div>
                      <Tag>{e.event_type}</Tag>
                      <Typography.Text code style={{ fontSize: 12 }}>
                        {e.kit_id}
                      </Typography.Text>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtTs(e.occurred_at_ms, e.occurred_at_raw)} · {e.source}
                      {e.timezoneAssumedUtc ? ' · TZ assumed UTC' : ''}
                    </Typography.Text>
                  </div>
                ),
              }))}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
