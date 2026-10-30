import { Card, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { formatDays } from '../data/timestamps';
import type { StageTurnaroundRow } from '../data/types';

interface Props {
  rows: StageTurnaroundRow[];
}

interface FlatRow {
  key: string;
  stage: string;
  target: number;
  count30: number;
  median30: number | null;
  p90_30: number | null;
  count100: number;
  median100: number | null;
  p90_100: number | null;
}

function cell(v: number | null): string {
  return formatDays(v, 1);
}

export function TurnaroundPanel({ rows }: Props) {
  const data: FlatRow[] = rows.map((r) => ({
    key: r.stageKey,
    stage: r.label,
    target: r.targetDays,
    count30: r.byProduct.wgs_30x?.count ?? 0,
    median30: r.byProduct.wgs_30x?.medianDays ?? null,
    p90_30: r.byProduct.wgs_30x?.p90Days ?? null,
    count100: r.byProduct.wgs_100x?.count ?? 0,
    median100: r.byProduct.wgs_100x?.medianDays ?? null,
    p90_100: r.byProduct.wgs_100x?.p90Days ?? null,
  }));

  const columns: ColumnsType<FlatRow> = [
    {
      title: 'Stage',
      dataIndex: 'stage',
      fixed: 'left',
      width: 220,
    },
    {
      title: 'Target (days)',
      dataIndex: 'target',
      width: 100,
      render: (v: number) => <Tag>{v}</Tag>,
    },
    {
      title: 'wgs_30x',
      children: [
        {
          title: 'n',
          dataIndex: 'count30',
          width: 70,
          render: (v: number) => (v === 0 ? '—' : v),
        },
        {
          title: 'Median',
          dataIndex: 'median30',
          width: 80,
          render: cell,
        },
        {
          title: 'P90',
          dataIndex: 'p90_30',
          width: 80,
          render: cell,
        },
      ],
    },
    {
      title: 'wgs_100x',
      children: [
        {
          title: 'n',
          dataIndex: 'count100',
          width: 70,
          render: (v: number) => (v === 0 ? '—' : v),
        },
        {
          title: 'Median',
          dataIndex: 'median100',
          width: 80,
          render: cell,
        },
        {
          title: 'P90',
          dataIndex: 'p90_100',
          width: 80,
          render: cell,
        },
      ],
    },
  ];

  return (
    <Card
      title="Stage turnaround (completed observations)"
      size="small"
      extra={
        <span className="unit-hint">
          Durations only when both endpoints exist on the same kit. In-progress age is not included.
        </span>
      }
    >
      <div className="table-scroll">
        <Table
          size="small"
          pagination={false}
          columns={columns}
          dataSource={data}
          scroll={{ x: 800 }}
          locale={{ emptyText: 'No completed stage observations' }}
        />
      </div>
    </Card>
  );
}
