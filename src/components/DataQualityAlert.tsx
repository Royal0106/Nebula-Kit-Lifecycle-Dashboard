import { Alert } from 'antd';
import type { DataQualityReport } from '../data/types';

interface Props {
  quality: DataQualityReport;
}

export function DataQualityAlert({ quality }: Props) {
  const lines = [
    quality.duplicateEvents > 0 && `Duplicate events removed: ${quality.duplicateEvents}`,
    quality.orphanEvents > 0 && `Orphan events (ignored for metrics): ${quality.orphanEvents}`,
    quality.unknownEventTypes > 0 && `Unknown event types: ${quality.unknownEventTypes}`,
    quality.postSnapshotEvents > 0 &&
      `Post-snapshot events/orders excluded: ${quality.postSnapshotEvents}`,
    quality.invalidTimestamps > 0 && `Invalid timestamps: ${quality.invalidTimestamps}`,
    quality.conflictingOrders > 0 && `Conflicting order IDs: ${quality.conflictingOrders}`,
    quality.malformedOrders > 0 && `Malformed order rows: ${quality.malformedOrders}`,
    quality.malformedEvents > 0 && `Malformed event rows: ${quality.malformedEvents}`,
    quality.contradictions > 0 && `Contradictions flagged: ${quality.contradictions}`,
    quality.negativeIntervals > 0 && `Negative intervals skipped: ${quality.negativeIntervals}`,
    quality.multipleActiveKits > 0 &&
      `Orders with multiple active kits: ${quality.multipleActiveKits}`,
  ].filter(Boolean) as string[];

  if (lines.length === 0 && quality.messages.length === 0) {
    return (
      <Alert
        type="success"
        showIcon
        message="Data quality"
        description="No major data-quality issues reported for the loaded dataset."
      />
    );
  }

  return (
    <Alert
      type="info"
      showIcon
      message="Data quality summary"
      description={
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
          {quality.messages.slice(0, 3).map((m) => (
            <li key={m}>{m}</li>
          ))}
          {quality.messages.length > 3 && (
            <li>…and {quality.messages.length - 3} more notes in processing log.</li>
          )}
        </ul>
      }
    />
  );
}
