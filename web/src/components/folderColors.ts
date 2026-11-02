/** Shared between the Graph view (node color by folder) and the collapsed sidebar's per-folder
 * icon buttons, so the same top-level folder reads as the same color in both places. */
export const FOLDER_PALETTE = ['#a78bfa', '#22d3ee', '#fbbf24', '#34d399', '#f472b6', '#60a5fa', '#fb923c'];

export function topFolder(folder: string): string {
  return folder.split('/')[0] || '(root)';
}

export function colorForFolder(folder: string, order: string[]): string {
  const idx = order.indexOf(topFolder(folder));
  return FOLDER_PALETTE[idx % FOLDER_PALETTE.length];
}
