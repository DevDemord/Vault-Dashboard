/** Shared between NoteView's callout renderer and the multi-column columns modal's type dropdown.
 * `rgb` is a plain "r,g,b" triplet — NoteView turns it into inline border/background/glow styles
 * rather than Tailwind classes, since a user-chosen color (from the settings modal's color picker)
 * can't be expressed as a static Tailwind utility at all. */
export interface CalloutStyle {
  icon: string;
  rgb: string;
}

const SKY: Omit<CalloutStyle, 'icon'> = { rgb: '14,165,233' };
const EMERALD: Omit<CalloutStyle, 'icon'> = { rgb: '16,185,129' };
const VIOLET: Omit<CalloutStyle, 'icon'> = { rgb: '139,92,246' };
const AMBER: Omit<CalloutStyle, 'icon'> = { rgb: '245,158,11' };
const RED: Omit<CalloutStyle, 'icon'> = { rgb: '239,68,68' };
const SLATE: Omit<CalloutStyle, 'icon'> = { rgb: '100,116,139' };

export const CALLOUT_STYLES: Record<string, CalloutStyle> = {
  note: { icon: '📝', ...SKY },
  info: { icon: 'ℹ️', ...SKY },
  todo: { icon: '☑️', ...SKY },
  tip: { icon: '💡', ...EMERALD },
  hint: { icon: '💡', ...EMERALD },
  important: { icon: '💡', ...EMERALD },
  success: { icon: '✅', ...EMERALD },
  check: { icon: '✅', ...EMERALD },
  done: { icon: '✅', ...EMERALD },
  question: { icon: '❓', ...VIOLET },
  help: { icon: '❓', ...VIOLET },
  faq: { icon: '❓', ...VIOLET },
  warning: { icon: '⚠️', ...AMBER },
  caution: { icon: '⚠️', ...AMBER },
  attention: { icon: '⚠️', ...AMBER },
  failure: { icon: '❌', ...RED },
  fail: { icon: '❌', ...RED },
  missing: { icon: '❌', ...RED },
  danger: { icon: '🚨', ...RED },
  error: { icon: '🚨', ...RED },
  bug: { icon: '🐛', ...RED },
  abstract: { icon: '📄', ...SLATE },
  summary: { icon: '📄', ...SLATE },
  tldr: { icon: '📄', ...SLATE },
  example: { icon: '📋', ...SLATE },
  quote: { icon: '💬', ...SLATE },
  cite: { icon: '💬', ...SLATE },
};

export const DEFAULT_CALLOUT_STYLE: CalloutStyle = { icon: '📌', ...SLATE };

export const CALLOUT_TYPE_OPTIONS = Object.keys(CALLOUT_STYLES);

export interface CalloutIconGroup {
  /** Stable key for this group — its first alias, e.g. "tip" for the tip/hint/important group.
   * Used both as the settings modal's per-row state key and as the key every alias's override
   * gets written under on save. */
  id: string;
  /** All `[!type]` aliases that currently share one icon — a user-set override always applies to
   * every alias in the group at once, never just one. */
  aliases: string[];
  defaultIcon: string;
  defaultRgb: string;
}

/** Derived from CALLOUT_STYLES itself (grouped by identical default icon) rather than hand-listed,
 * so the settings UI's groups can never drift out of sync with the table above. Every alias in a
 * group is guaranteed to share one `rgb` too — the table was built hue-first, so an icon never
 * crosses a hue boundary — which is why `defaultRgb` can safely read off just the first alias. */
export function groupCalloutTypesByIcon(): CalloutIconGroup[] {
  const byIcon = new Map<string, string[]>();
  for (const [type, style] of Object.entries(CALLOUT_STYLES)) {
    const aliases = byIcon.get(style.icon) ?? [];
    aliases.push(type);
    byIcon.set(style.icon, aliases);
  }
  return [...byIcon.entries()].map(([defaultIcon, aliases]) => ({
    id: aliases[0],
    aliases,
    defaultIcon,
    defaultRgb: CALLOUT_STYLES[aliases[0]].rgb,
  }));
}

export function rgbToHex(rgb: string): string {
  const [r, g, b] = rgb.split(',').map(Number);
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Prefix marking an icon override as an uploaded image (its vault-relative path) rather than a
 * plain emoji/text glyph — e.g. `img:_Attachments/icon-123.png`. */
export const IMAGE_ICON_PREFIX = 'img:';
