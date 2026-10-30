import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Layout,
  Space,
  Spin,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CsvImportBar } from './components/CsvImportBar';
import { DataQualityAlert } from './components/DataQualityAlert';
import { FilterBar } from './components/FilterBar';
import { FollowUpPanel } from './components/FollowUpPanel';
import { OrderDetailDrawer } from './components/OrderDetailDrawer';
import { OverviewPanel } from './components/OverviewPanel';
import { TurnaroundPanel } from './components/TurnaroundPanel';
import { DEFAULT_SNAPSHOT_ISO, DEFAULT_SNAPSHOT_MS } from './data/constants';
import {
  computeFollowUpQueue,
  computeOverview,
  computeTurnaround,
  passesFilters,
} from './data/lifecycle';
import { fetchSampleCsvs, loadFromCsvTexts } from './data/process';
import type { DashboardFilters, OrderLifecycle, ProcessedDataset } from './data/types';

dayjs.extend(utc);

const { Header, Content } = Layout;

const EMPTY_FILTERS: DashboardFilters = {
  dateRange: null,
  products: [],
  countries: [],
};

export default function App() {
  const [dataset, setDataset] = useState<ProcessedDataset | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [snapshotMs, setSnapshotMs] = useState(DEFAULT_SNAPSHOT_MS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [lookupId, setLookupId] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedLifecycle, setSelectedLifecycle] = useState<OrderLifecycle | null>(null);
  const [sampleCache, setSampleCache] = useState<{
    ordersText: string;
    eventsText: string;
  } | null>(null);

  const applyTexts = useCallback(
    (ordersText: string, eventsText: string, asOfMs: number) => {
      const result = loadFromCsvTexts(ordersText, eventsText, asOfMs);
      if (!result.ok) {
        return result;
      }
      setDataset(result.dataset);
      setImportErrors([]);
      setError(null);
      if (result.warnings.length > 0) {
        message.info(result.warnings[0]);
      }
      return result;
    },
    [],
  );

  const loadSample = useCallback(
    async (asOfMs: number) => {
      setLoading(true);
      setError(null);
      try {
        const texts = sampleCache ?? (await fetchSampleCsvs());
        setSampleCache(texts);
        // Yield so the loading spinner can paint before heavy sync processing.
        await new Promise((r) => setTimeout(r, 0));
        const result = applyTexts(texts.ordersText, texts.eventsText, asOfMs);
        if (!result.ok) {
          setError(result.errors.join(' '));
          setDataset(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load sample data');
        setDataset(null);
      } finally {
        setLoading(false);
      }
    },
    [applyTexts, sampleCache],
  );

  useEffect(() => {
    void loadSample(DEFAULT_SNAPSHOT_MS);
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredLifecycles = useMemo(() => {
    if (!dataset) return [];
    return [...dataset.lifecycles.values()].filter((l) => passesFilters(l, filters));
  }, [dataset, filters]);

  const overview = useMemo(() => computeOverview(filteredLifecycles), [filteredLifecycles]);

  const turnaround = useMemo(() => {
    if (!dataset) return [];
    // Clone quality counters for turnaround negative-interval accounting without mutating display report heavily
    const q = { ...dataset.quality, messages: [...dataset.quality.messages] };
    return computeTurnaround(filteredLifecycles, q);
  }, [dataset, filteredLifecycles]);

  const followUp = useMemo(
    () => computeFollowUpQueue(filteredLifecycles),
    [filteredLifecycles],
  );

  const openOrder = (orderId: string) => {
    const id = orderId.trim();
    if (!id || !dataset) return;
    const lc = dataset.lifecycles.get(id) ?? null;
    setSelectedLifecycle(lc);
    setDrawerOpen(true);
    if (!lc) {
      message.warning(`Order ${id} not found in the loaded dataset.`);
    }
  };

  const handleImport = async (ordersText: string, eventsText: string) => {
    const result = loadFromCsvTexts(ordersText, eventsText, snapshotMs);
    if (!result.ok) {
      setImportErrors(result.errors);
      message.error('Import rejected — active dataset unchanged.');
      return;
    }
    setDataset(result.dataset);
    setImportErrors([]);
    setFilters(EMPTY_FILTERS);
    message.success('Dataset replaced.');
  };

  const [lastTexts, setLastTexts] = useState<{
    ordersText: string;
    eventsText: string;
  } | null>(null);

  useEffect(() => {
    if (sampleCache && !lastTexts) setLastTexts(sampleCache);
  }, [sampleCache, lastTexts]);

  const onSnapshotChange = (ms: number) => {
    setSnapshotMs(ms);
    const texts = lastTexts ?? sampleCache;
    if (!texts) return;
    const result = applyTexts(texts.ordersText, texts.eventsText, ms);
    if (!result.ok) {
      setError(result.errors.join(' '));
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f4f5f8' }}>
      <Header className="app-header" style={{ height: 'auto', lineHeight: 'inherit' }}>
        <h1>Nebula Kit Lifecycle Dashboard</h1>
        <p>
          Ops view of physical-kit pipeline health · Snapshot as-of{' '}
          {new Date(snapshotMs).toISOString()}
        </p>
      </Header>
      <Content className="app-content">
        <div className="section-stack">
          <Card size="small" title="Data">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div>
                <span className="filter-label">As-of timestamp (UTC)</span>
                <DatePicker
                  showTime
                  value={dayjs.utc(snapshotMs)}
                  onChange={(d) => {
                    if (!d) {
                      onSnapshotChange(DEFAULT_SNAPSHOT_MS);
                      return;
                    }
                    onSnapshotChange(d.utc().valueOf());
                  }}
                  allowClear={false}
                />
                <Button
                  type="link"
                  onClick={() => onSnapshotChange(Date.parse(DEFAULT_SNAPSHOT_ISO))}
                >
                  Reset to 2026-10-20T00:00:00Z
                </Button>
              </div>
              <CsvImportBar
                busy={loading}
                onImportPair={async (o, e) => {
                  setLastTexts({ ordersText: o, eventsText: e });
                  await handleImport(o, e);
                }}
                onResetSample={() => {
                  setFilters(EMPTY_FILTERS);
                  setSnapshotMs(DEFAULT_SNAPSHOT_MS);
                  setLastTexts(sampleCache);
                  void loadSample(DEFAULT_SNAPSHOT_MS);
                }}
              />
              {importErrors.length > 0 && (
                <Alert
                  type="error"
                  showIcon
                  message="Import validation failed"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {importErrors.map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                  }
                />
              )}
            </Space>
          </Card>

          {loading && (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Spin size="large" tip="Loading sample CSVs…" />
            </div>
          )}

          {!loading && error && (
            <Alert type="error" showIcon message="Failed to load data" description={error} />
          )}

          {!loading && !error && !dataset && (
            <Empty description="No dataset loaded" />
          )}

          {!loading && dataset && (
            <>
              <DataQualityAlert quality={dataset.quality} />

              <Card size="small" title="Filters & lookup">
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <FilterBar
                    filters={filters}
                    products={dataset.products}
                    countries={dataset.countries}
                    onChange={setFilters}
                  />
                  <div>
                    <span className="filter-label">Order lookup</span>
                    <Input.Search
                      placeholder="Order ID (includes excluded orders)"
                      value={lookupId}
                      onChange={(e) => setLookupId(e.target.value)}
                      onSearch={(v) => openOrder(v)}
                      enterButton="Open"
                      style={{ maxWidth: 420 }}
                      allowClear
                    />
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Filters apply the same order cohort across overview, turnaround, and follow-up.
                    Date filter uses UTC day boundaries with an inclusive end date.
                  </Typography.Text>
                </Space>
              </Card>

              <OverviewPanel metrics={overview} />
              <TurnaroundPanel rows={turnaround} />
              <FollowUpPanel items={followUp} onOpenOrder={openOrder} />
            </>
          )}
        </div>

        <OrderDetailDrawer
          open={drawerOpen}
          lifecycle={selectedLifecycle}
          onClose={() => setDrawerOpen(false)}
        />
      </Content>
    </Layout>
  );
}
