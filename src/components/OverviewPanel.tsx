import { Card, Col, Row, Statistic, Tag, Tooltip } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OverviewMetrics } from '../data/types';

interface Props {
  metrics: OverviewMetrics;
}

export function OverviewPanel({ metrics }: Props) {
  const chartData = metrics.pipeline.map((p) => ({
    name: p.label,
    stage: p.stage,
    orders: p.count,
  }));

  return (
    <div className="section-stack">
      <Row gutter={[12, 12]}>
        <Col xs={12} sm={8} md={4} lg={4}>
          <Card size="small">
            <Statistic
              title="Eligible physical-kit orders"
              value={metrics.eligiblePhysicalKitOrders}
            />
            <div className="unit-hint">Orders (denominator)</div>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Card size="small">
            <Statistic title="Awaiting first shipment" value={metrics.awaitingFirstShipment} />
            <div className="unit-hint">Orders</div>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Card size="small">
            <Statistic title="Active kits" value={metrics.activeKits} />
            <div className="unit-hint">Physical kit attempts (non-replaced, incomplete)</div>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Card size="small">
            <Statistic title="Completed orders" value={metrics.completedOrders} />
            <div className="unit-hint">Orders with report_ready</div>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={5} lg={4}>
          <Card size="small">
            <Statistic title="Needing follow-up" value={metrics.needingFollowUp} />
            <div className="unit-hint">Orders</div>
          </Card>
        </Col>
      </Row>

      <Card
        title="Active pipeline (orders)"
        size="small"
        extra={<span className="unit-hint">Where incomplete eligible orders currently sit</span>}
      >
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 16, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e6ee" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11 }} />
              <RTooltip />
              <Bar dataKey="orders" fill="#3b4cca" name="Orders" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {Object.keys(metrics.exclusionCounts).length > 0 && (
        <Card title="Excluded from operational metrics" size="small">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(metrics.exclusionCounts).map(([reason, count]) => (
              <Tooltip key={reason} title="Still available via order lookup">
                <Tag>
                  {reason}: {count}
                </Tag>
              </Tooltip>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
