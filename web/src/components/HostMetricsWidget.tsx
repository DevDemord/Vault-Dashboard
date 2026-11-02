import { useEffect, useState } from 'react';
import { api } from '../api';
import type { HostMetricsStatus } from '../types';

/** The underlying data only changes once a minute (that's how often the host's cron job writes
 * it) — polling faster wouldn't show anything new, just re-fetch the same file more often. */
const POLL_MS = 30_000;

function kbToGiB(kb: number): number {
  return kb / (1024 * 1024);
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.round(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

function tempColor(c: number | null): string {
  if (c === null) return 'text-slate-400';
  if (c >= 80) return 'text-red-400';
  if (c >= 65) return 'text-amber-400';
  return 'text-emerald-400';
}

function UsageBar({ usedKb, totalKb, gradient }: { usedKb: number; totalKb: number; gradient: string }) {
  const pct = totalKb > 0 ? Math.min(100, (usedKb / totalKb) * 100) : 0;
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full bg-gradient-to-r ${gradient}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Home-page card showing the host machine's own CPU load/temp, memory, and disk usage — not
 * this container's stats, the actual host's. Fed by a host-side cron job (`collect-metrics.sh`) writing a JSON
 * snapshot into the app's existing data volume once a minute, since the container itself has no
 * access to the host's /proc, /sys, or lm-sensors (and isn't granted any, on purpose, just for
 * this). Self-polls independently; shows a muted (not alarming) notice rather than hiding itself
 * if the metrics file isn't there yet or the cron job has stopped.
 */
export function HostMetricsWidget({ onOpenSpecs }: { onOpenSpecs: () => void }) {
  const [status, setStatus] = useState<HostMetricsStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .hostMetrics()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!status) return null;

  if (!status.available || !status.metrics) {
    return (
      <div className="mt-8 rounded-xl border border-slate-800/70 bg-slate-900/40 px-4 py-3 text-sm text-slate-500">
        Home lab metrics unavailable{status.error ? ` — ${status.error}` : ''}
      </div>
    );
  }

  const m = status.metrics;
  const memUsedGiB = kbToGiB(m.memUsedKb);
  const memTotalGiB = kbToGiB(m.memTotalKb);
  const rootUsedGiB = kbToGiB(m.diskRootUsedKb);
  const rootTotalGiB = kbToGiB(m.diskRootSizeKb);
  const dataUsedGiB = kbToGiB(m.diskDataUsedKb);
  const dataTotalGiB = kbToGiB(m.diskDataSizeKb);

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>Home lab</span>
        <div className="flex items-center gap-3 font-normal normal-case">
          <button onClick={onOpenSpecs} className="text-slate-500 transition-colors hover:text-violet-300">
            System specs →
          </button>
          <span className="text-slate-600">updated {timeAgo(m.collectedAt)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[11rem] flex-1 rounded-xl border border-slate-800/70 bg-slate-900/40 px-4 py-3 shadow-sm shadow-black/20">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">CPU load</div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="font-display text-xl font-semibold text-slate-100">{m.load1.toFixed(2)}</div>
            <div className="text-xs text-slate-500">/ {m.cpuCores} cores</div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span>5m {m.load5.toFixed(2)} · 15m {m.load15.toFixed(2)}</span>
            {m.cpuTempC !== null && <span className={tempColor(m.cpuTempC)}>· {m.cpuTempC.toFixed(0)}°C</span>}
          </div>
        </div>

        <div className="min-w-[11rem] flex-1 rounded-xl border border-slate-800/70 bg-slate-900/40 px-4 py-3 shadow-sm shadow-black/20">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Memory</div>
          <div className="mt-1 font-display text-xl font-semibold text-slate-100">
            {memUsedGiB.toFixed(1)} <span className="text-sm font-normal text-slate-500">/ {memTotalGiB.toFixed(0)} GiB</span>
          </div>
          <div className="mt-2">
            <UsageBar usedKb={m.memUsedKb} totalKb={m.memTotalKb} gradient="from-violet-500 to-fuchsia-500" />
          </div>
        </div>

        <div className="min-w-[16rem] flex-1 rounded-xl border border-slate-800/70 bg-slate-900/40 px-4 py-3 shadow-sm shadow-black/20">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Disk</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="w-14 flex-shrink-0 text-xs text-slate-500">/</span>
            <UsageBar usedKb={m.diskRootUsedKb} totalKb={m.diskRootSizeKb} gradient="from-cyan-500 to-violet-500" />
            <span className="flex-shrink-0 text-xs text-slate-400">
              {rootUsedGiB.toFixed(0)}/{rootTotalGiB.toFixed(0)} GiB
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="w-14 flex-shrink-0 text-xs text-slate-500">/mnt/data</span>
            <UsageBar usedKb={m.diskDataUsedKb} totalKb={m.diskDataSizeKb} gradient="from-cyan-500 to-violet-500" />
            <span className="flex-shrink-0 text-xs text-slate-400">
              {dataUsedGiB.toFixed(0)}/{dataTotalGiB.toFixed(0)} GiB
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
