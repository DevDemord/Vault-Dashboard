import { useEffect, useState } from 'react';
import { api } from '../api';
import type { HostMetricsStatus } from '../types';

function kbToGiB(kb: number): number {
  return kb / (1024 * 1024);
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-800/60 px-4 py-3 last:border-0">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="truncate text-right text-sm font-medium text-slate-100">{children}</div>
    </div>
  );
}

/**
 * "About this machine" page for the host, reached via the "System specs →" link on the home-page
 * Host Metrics widget. Fed by the same `hostmetrics.json` snapshot the widget already polls (see
 * HostMetricsWidget.tsx's doc comment) — collect-metrics.sh writes a handful of static fields
 * (hostname/OS/kernel/CPU model/uptime) into the same once-a-minute file rather than needing a
 * second cron job and a second container-side route just for data that barely ever changes.
 */
export function SystemSpecsView() {
  const [status, setStatus] = useState<HostMetricsStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .hostMetrics()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-semibold text-slate-100">System specs</h1>
      <div className="mb-4 text-sm text-slate-500">The host this dashboard runs on.</div>

      {!status && <div className="text-sm text-slate-500">Loading…</div>}

      {status && (!status.available || !status.metrics) && (
        <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 px-4 py-3 text-sm text-slate-500">
          Specs unavailable{status.error ? ` — ${status.error}` : ''}
        </div>
      )}

      {status?.available && status.metrics && (
        <div className="max-w-xl rounded-xl border border-slate-800/80 bg-slate-900/40 shadow-sm shadow-black/20">
          <Row label="Hostname">{status.metrics.hostname}</Row>
          <Row label="Operating system">{status.metrics.osName}</Row>
          <Row label="Kernel">{status.metrics.kernel}</Row>
          <Row label="Architecture">{status.metrics.architecture}</Row>
          <Row label="CPU">{status.metrics.cpuModel}</Row>
          <Row label="CPU cores">{status.metrics.cpuCores}</Row>
          <Row label="Memory">{kbToGiB(status.metrics.memTotalKb).toFixed(1)} GiB</Row>
          <Row label="Disk (/)">{kbToGiB(status.metrics.diskRootSizeKb).toFixed(0)} GiB</Row>
          <Row label="Disk (/mnt/data)">{kbToGiB(status.metrics.diskDataSizeKb).toFixed(0)} GiB</Row>
          <Row label="Uptime">{formatUptime(status.metrics.uptimeSeconds)}</Row>
        </div>
      )}
    </div>
  );
}
