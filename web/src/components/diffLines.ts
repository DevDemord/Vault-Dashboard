export interface DiffLine {
  type: 'same' | 'add' | 'remove';
  text: string;
}

const MAX_DIFFABLE_LINES = 4000; // the LCS table below is O(n*m); guard against pathological input

/** A standard LCS-based line diff. Fine for note-sized files (hundreds of lines); callers should
 * check `tooLarge` before relying on the result for anything bigger. */
export function diffLines(oldText: string, newText: string): { lines: DiffLine[]; tooLarge: boolean } {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  if (a.length > MAX_DIFFABLE_LINES || b.length > MAX_DIFFABLE_LINES) return { lines: [], tooLarge: true };

  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      lines.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) lines.push({ type: 'remove', text: a[i++] });
  while (j < m) lines.push({ type: 'add', text: b[j++] });
  return { lines, tooLarge: false };
}
