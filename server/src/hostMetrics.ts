import { promises as fs } from 'fs';
import path from 'path';
import type { HostMetrics, HostMetricsStatus } from './types.js';

const DATA_DIR = process.env.DATA_DIR ?? '/app/data';
const METRICS_FILE = path.join(DATA_DIR, 'hostmetrics.json');

/** Reads the JSON snapshot `collect-metrics.sh` writes every minute via cron on the host. No
 * caching here — it's a plain local file read, already about as cheap as a cache lookup would
 * be, and the data is only ever as fresh as the last cron run regardless. */
export async function getHostMetrics(): Promise<HostMetricsStatus> {
  try {
    const raw = await fs.readFile(METRICS_FILE, 'utf8');
    return { available: true, metrics: JSON.parse(raw) as HostMetrics };
  } catch (err) {
    const isMissing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      available: false,
      metrics: null,
      error: isMissing
        ? "No metrics file yet — the host's collect-metrics.sh cron job may not have run."
        : 'Could not read host metrics.',
    };
  }
}
