import type { StatusReport } from './StatusService.js';

export interface StatusReportJson {
  runId: string;
  seedUrl: string;
  normalizedSeedUrl: string;
  scope: { host: string; policy: string };
  status: string;
  startedAt: string;
  finishedAt: string | null;
  urlStatusCounts: StatusReport['urlStatusCounts'];
  contentKindCounts: StatusReport['contentKindCounts'];
  bytesDownloaded: number;
}

const URL_STATUS_ORDER = [
  'queued',
  'in_progress',
  'done',
  'retryable_failed',
  'permanent_failed',
  'blocked',
  'skipped_unsupported',
] as const;

const CONTENT_KIND_ORDER = ['html', 'image', 'video', 'pdf'] as const;

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function serializeStatusReport(report: StatusReport): StatusReportJson {
  return {
    runId: report.runId,
    seedUrl: report.seedUrl,
    normalizedSeedUrl: report.normalizedSeedUrl,
    scope: { host: report.scopeHost, policy: report.scopePolicy },
    status: report.status,
    startedAt: report.startedAt.toISOString(),
    finishedAt: report.finishedAt?.toISOString() ?? null,
    urlStatusCounts: report.urlStatusCounts,
    contentKindCounts: report.contentKindCounts,
    bytesDownloaded: report.bytesDownloaded,
  };
}

export function formatStatusText(report: StatusReport): string {
  const lines = [
    `Crawl Run ${report.runId}`,
    `Seed: ${report.seedUrl}`,
    `Scope: ${report.scopeHost} (${report.scopePolicy})`,
    `Status: ${report.status}`,
    `Started: ${report.startedAt.toISOString()}`,
    `Finished: ${report.finishedAt?.toISOString() ?? '-'}`,
    '',
    'URL counts:',
    ...URL_STATUS_ORDER.map((status) => `  ${status}: ${report.urlStatusCounts[status]}`),
    '',
    'Content counts:',
    ...CONTENT_KIND_ORDER.map((kind) => `  ${kind}: ${report.contentKindCounts[kind]}`),
    '',
    `Bytes downloaded: ${formatBytes(report.bytesDownloaded)} (${report.bytesDownloaded} bytes)`,
  ];

  return lines.join('\n');
}
