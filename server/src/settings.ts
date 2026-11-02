import { promises as fs } from 'fs';
import path from 'path';
import type { Settings } from './types.js';

const DATA_DIR = process.env.DATA_DIR ?? '/app/data';
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS: Settings = {
  quickLinks: [],
  quickLinksCollapsed: false,
  sidebarCollapsed: false,
  openTabs: [],
  noteWidthRem: 57.6,
  calloutIcons: {},
  calloutColors: {},
  statColors: {},
  sportColors: {},
  sportImages: {},
  videoVolume: 1,
  homeMode: 'personal',
  mailRules: [],
  mailRuleLog: [],
  trendingBlockedKeywords: [],
  trendingInterestKeywords: [],
  trendingCustomSources: [],
  siteIcon: null,
};

async function readSettingsRaw(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function readSettings(): Promise<Settings> {
  return readSettingsRaw();
}

// Every write goes through this chain so concurrent PATCHes (e.g. the sidebar toggling while
// quick links save) read-modify-write in order instead of racing on the same file.
let writeQueue: Promise<Settings> = Promise.resolve(DEFAULT_SETTINGS);

export function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const current = await readSettingsRaw();
      const next: Settings = { ...current, ...patch };
      await fs.mkdir(DATA_DIR, { recursive: true });
      // Write to a temp file and rename over the real one rather than writing settings.json
      // directly — `fs.writeFile` isn't atomic, so a GET landing mid-write (this queue only
      // serializes writes against each other, not against reads) could see a half-written,
      // unparseable file and silently fall back to DEFAULT_SETTINGS in the catch above. If that
      // empty snapshot then got used as the base for another write, it would permanently erase
      // whatever this write was saving. `fs.rename` on the same filesystem is atomic, so a
      // concurrent read only ever sees the complete old file or the complete new one.
      const tmpFile = `${SETTINGS_FILE}.${process.pid}.tmp`;
      await fs.writeFile(tmpFile, JSON.stringify(next, null, 2));
      await fs.rename(tmpFile, SETTINGS_FILE);
      return next;
    });
  return writeQueue;
}

/** Saves an uploaded site icon under `DATA_DIR` (never the vault, never browser storage) and
 * points `Settings.siteIcon` at its timestamped filename — the timestamp both avoids a stale
 * browser cache when the icon is replaced (the collapsed sidebar's `<img src>` includes the
 * filename as a cache-busting query value) and lets the old file be found and deleted below. */
export async function saveSiteIcon(originalName: string, data: Buffer): Promise<string> {
  const current = await readSettingsRaw();
  if (current.siteIcon) {
    await fs.unlink(path.join(DATA_DIR, current.siteIcon)).catch(() => undefined);
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const ext = path.extname(originalName) || '.png';
  const filename = `site-icon-${Date.now()}${ext}`;
  await fs.writeFile(path.join(DATA_DIR, filename), data);
  await writeSettings({ siteIcon: filename });
  return filename;
}

export async function removeSiteIcon(): Promise<void> {
  const current = await readSettingsRaw();
  if (current.siteIcon) {
    await fs.unlink(path.join(DATA_DIR, current.siteIcon)).catch(() => undefined);
  }
  await writeSettings({ siteIcon: null });
}

export function resolveSiteIconPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}
