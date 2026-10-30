import { Card, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { formatDays } from '../data/timestamps';
import type { FollowUpItem } from '../data/types';

interface Props {
  items: FollowUpItem[];
  onOpenOrder: (orderId: string) => void;
}

export function FollowUpPanel({ items, onOpenOrder }: Props) {
  const columns: ColumnsType<FollowUpItem> = [
    {
      title: 'Order',
      dataIndex: 'order_id',
      fixed: 'left',
      width: 120,
      render: (id: string) => (
        <a
          href={`#order-${id}`}
          onClick={(e) => {
            e.preventDefault();
            onOpenOrder(id);
          }}
        >
          {id}
        </a>
      ),
    },
    {
      title: 'Kit',
      dataIndex: 'kit_id',
      width: 110,
      render: (v: string | null) => v ?? '—',
    },
    { title: 'Product', dataIndex: 'product', width: 100 },
    { title: 'Country', dataIndex: 'country', width: 80 },
    {
      title: 'Stage',
      dataIndex: 'stageLabel',
      width: 180,
      ellipsis: true,
    },
    {
      title: 'Stage age (days)',
      dataIndex: 'stageAgeDays',
      width: 120,
      render: (v: number | null) => formatDays(v, 1),
    },
    {
      title: 'Target',
      dataIndex: 'targetDays',
      width: 80,
      render: (v: number | null) => (v == null ? '—' : v),
    },
    {
      title: 'Days overdue',
      dataIndex: 'daysOverdue',
      width: 110,
      sorter: (a, b) => (a.daysOverdue ?? -1) - (b.daysOverdue ?? -1),
      defaultSortOrder: 'descend',
      render: (v: number | null) =>
        v == null ? '—' : <Tag color="error">{formatDays(v, 1)}</Tag>,
    },
    {
      title: 'Follow-up reason',
      dataIndex: 'reasonLabel',
      width: 200,
      render: (label: string, row) => (
        <Tag color={row.reason === 'qc_failed_awaiting_replacement' ? 'orange' : 'volcano'}>
          {label}
        </Tag>
      ),
    },
  ];

  return (
    <Card
      title="Follow-up queue"
      size="small"
      extra={
        <span className="unit-hint">
          SLA overdue sorted by days overdue. Failed QC listed separately (no invented SLA).
        </span>
      }
    >
      <div className="table-scroll">
        <Table
          size="small"
          rowKey={(r) => `${r.order_id}-${r.reason}`}
          columns={columns}
          dataSource={items}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1100 }}
          locale={{ emptyText: 'No follow-up items in the current cohort' }}
        />
      </div>
    </Card>
  );
}
