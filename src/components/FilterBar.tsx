import { DatePicker, Select, Space } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { DashboardFilters } from '../data/types';

dayjs.extend(utc);

interface Props {
  filters: DashboardFilters;
  products: string[];
  countries: string[];
  onChange: (next: DashboardFilters) => void;
}

export function FilterBar({ filters, products, countries, onChange }: Props) {
  const rangeValue: [Dayjs, Dayjs] | null = filters.dateRange
    ? [dayjs.utc(filters.dateRange[0]), dayjs.utc(filters.dateRange[1])]
    : null;

  return (
    <div className="toolbar-row">
      <div>
        <span className="filter-label">Order created date</span>
        <DatePicker.RangePicker
          value={rangeValue}
          allowClear
          onChange={(dates) => {
            if (!dates || !dates[0] || !dates[1]) {
              onChange({ ...filters, dateRange: null });
              return;
            }
            // UTC day boundaries; inclusive end date
            const start = Date.parse(dates[0].utc().format('YYYY-MM-DD') + 'T00:00:00.000Z');
            const end = Date.parse(dates[1].utc().format('YYYY-MM-DD') + 'T23:59:59.999Z');
            onChange({ ...filters, dateRange: [start, end] });
          }}
        />
      </div>
      <div style={{ minWidth: 180 }}>
        <span className="filter-label">Product</span>
        <Select
          mode="multiple"
          allowClear
          placeholder="All products"
          style={{ width: '100%' }}
          value={filters.products}
          options={products.map((p) => ({ value: p, label: p }))}
          onChange={(productsSel) => onChange({ ...filters, products: productsSel })}
          maxTagCount="responsive"
        />
      </div>
      <div style={{ minWidth: 160 }}>
        <span className="filter-label">Country</span>
        <Select
          mode="multiple"
          allowClear
          placeholder="All countries"
          style={{ width: '100%' }}
          value={filters.countries}
          options={countries.map((c) => ({ value: c, label: c }))}
          onChange={(countriesSel) => onChange({ ...filters, countries: countriesSel })}
          maxTagCount="responsive"
        />
      </div>
      <Space />
    </div>
  );
}
