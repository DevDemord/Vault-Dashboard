import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

export interface ColumnData {
  type: string;
  title: string;
  content: string;
}

export interface MultiColumnBlock {
  columns: ColumnData[];
  /** 1-based, inclusive — the exact raw-text line span of the whole `[!multi-column]` block,
   * for splicing a replacement back into the editor. */
  fromLine: number;
  toLine: number;
}

const CALLOUT_HEADER_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)\s?(.*)$/;

/** Unlike the render-time regex in remarkCallouts.ts, this keeps the title *raw* (no falling back
 * to the type name) — the columns modal needs to know whether a title was actually typed, so a
 * round-tripped "no title" callout doesn't silently gain one. */
function parseHeaderLine(line: string): { type: string; title: string } | null {
  const match = CALLOUT_HEADER_RE.exec(line.trim());
  if (!match) return null;
  return { type: match[1].toLowerCase(), title: match[3] ?? '' };
}

/** Strips up to `levels` leading `>` blockquote markers (each with an optional single trailing
 * space) off a raw source line — the inverse of how `serializeMultiColumn` writes them. */
function stripQuoteLevels(line: string, levels: number): string {
  let rest = line;
  for (let i = 0; i < levels; i++) {
    const match = /^\s*>\s?(.*)$/.exec(rest);
    if (!match) break;
    rest = match[1];
  }
  return rest;
}

function sliceLines(doc: string, fromLine: number, toLine: number): string[] {
  return doc.split('\n').slice(fromLine - 1, toLine);
}

/**
 * Finds the `[!multi-column]` callout (if any) whose raw-text line range contains `line`
 * (1-based), parsed fresh from the current editor content — independent of the render pipeline,
 * since this runs against the raw markdown the editor holds, not the server's `renderedBody`.
 * Returns its columns plus the exact line span to replace when saving an edit.
 */
export function findMultiColumnBlockAt(doc: string, line: number): MultiColumnBlock | null {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(doc);
  let found: MultiColumnBlock | null = null;

  visit(tree as never, 'blockquote', (node: any) => {
    if (found) return;
    const pos = node.position;
    if (!pos || line < pos.start.line || line > pos.end.line) return;

    const first = node.children?.[0];
    if (!first || first.type !== 'paragraph') return;
    const firstChild = first.children?.[0];
    if (!firstChild || firstChild.type !== 'text') return;
    const header = parseHeaderLine((firstChild.value as string).split('\n')[0]);
    if (!header || header.type !== 'multi-column') return;

    const columns: ColumnData[] = [];
    for (const child of node.children.slice(1)) {
      if (child.type !== 'blockquote' || !child.position) continue;
      const colLines = sliceLines(doc, child.position.start.line, child.position.end.line).map((l) =>
        stripQuoteLevels(l, 2),
      );
      const colHeader = parseHeaderLine(colLines[0] ?? '');
      if (!colHeader) continue;
      columns.push({ type: colHeader.type, title: colHeader.title, content: colLines.slice(1).join('\n') });
    }
    if (columns.length === 0) return;

    found = { columns, fromLine: pos.start.line, toLine: pos.end.line };
  });

  return found;
}

/** Inverse of the parsing above: builds the raw `>[!multi-column]` / `>>[!type] Title` text for a
 * set of columns, separating each column with a lone `>` line (which is what ends the previous
 * nested blockquote without ending the outer one — see remarkCallouts.ts's doc comment). */
export function serializeMultiColumn(columns: ColumnData[]): string {
  const lines: string[] = ['>[!multi-column]'];
  columns.forEach((col, i) => {
    if (i > 0) lines.push('>');
    const title = col.title.trim();
    lines.push(`>>[!${col.type}]${title ? ' ' + title : ''}`);
    for (const line of col.content.split('\n')) {
      lines.push(line ? `>> ${line}` : '>>');
    }
  });
  return lines.join('\n');
}
