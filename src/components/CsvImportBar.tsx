import { Button, Space, Typography, Upload, message } from 'antd';
import { ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useState } from 'react';

interface Props {
  onImportPair: (ordersText: string, eventsText: string) => Promise<void> | void;
  onResetSample: () => void;
  busy?: boolean;
}

async function readFile(file: File): Promise<string> {
  return file.text();
}

export function CsvImportBar({ onImportPair, onResetSample, busy }: Props) {
  const [ordersFile, setOrdersFile] = useState<File | null>(null);
  const [eventsFile, setEventsFile] = useState<File | null>(null);
  const [applying, setApplying] = useState(false);

  const apply = async () => {
    if (!ordersFile || !eventsFile) {
      message.warning('Select both orders.csv and kit_events.csv before applying.');
      return;
    }
    setApplying(true);
    try {
      const [ordersText, eventsText] = await Promise.all([
        readFile(ordersFile),
        readFile(eventsFile),
      ]);
      await onImportPair(ordersText, eventsText);
      setOrdersFile(null);
      setEventsFile(null);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Space wrap size="middle" align="start">
      <div>
        <span className="filter-label">Replacement orders.csv</span>
        <Upload
          accept=".csv,text/csv"
          maxCount={1}
          beforeUpload={(file) => {
            setOrdersFile(file);
            return false;
          }}
          onRemove={() => setOrdersFile(null)}
          fileList={
            ordersFile
              ? [{ uid: 'orders', name: ordersFile.name, status: 'done' }]
              : []
          }
        >
          <Button icon={<UploadOutlined />} disabled={busy || applying}>
            Select orders
          </Button>
        </Upload>
      </div>
      <div>
        <span className="filter-label">Replacement kit_events.csv</span>
        <Upload
          accept=".csv,text/csv"
          maxCount={1}
          beforeUpload={(file) => {
            setEventsFile(file);
            return false;
          }}
          onRemove={() => setEventsFile(null)}
          fileList={
            eventsFile
              ? [{ uid: 'events', name: eventsFile.name, status: 'done' }]
              : []
          }
        >
          <Button icon={<UploadOutlined />} disabled={busy || applying}>
            Select events
          </Button>
        </Upload>
      </div>
      <div style={{ paddingTop: 18 }}>
        <Button
          type="primary"
          onClick={() => void apply()}
          disabled={!ordersFile || !eventsFile || busy || applying}
          loading={applying}
        >
          Validate &amp; replace dataset
        </Button>
      </div>
      <div style={{ paddingTop: 18 }}>
        <Button
          icon={<ReloadOutlined />}
          onClick={onResetSample}
          disabled={busy || applying}
        >
          Reset to sample data
        </Button>
      </div>
      <Typography.Paragraph type="secondary" style={{ margin: '18px 0 0', fontSize: 12 }}>
        Both files are validated before the active dataset is replaced.
      </Typography.Paragraph>
    </Space>
  );
}
