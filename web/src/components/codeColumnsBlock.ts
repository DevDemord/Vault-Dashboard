import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

export interface CodeColumnData {
  language: string;
  /** Raw code only — no ``` fences. CodeColumnsModal shows this straight in a plain textarea;
   * the fences are purely a serialization/parsing detail, same as how ColumnsModal's columns
   * never make the user type `>` markers themselves. */
  content: string;
}

export interface CodeColumnsBlock {
  columns: CodeColumnData[];
  /** 1-based, inclusive — the exact raw-text line span of the whole `[!code-columns]` block, for
   * splicing a replacement back into the editor. */
  fromLine: number;
  toLine: number;
}

const CALLOUT_HEADER_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)\s?(.*)$/;
const FENCE_OPEN_RE = /^```([a-zA-Z0-9_-]*)$/;
const FENCE_CLOSE_RE = /^```$/;

function parseHeaderLine(line: string): { type: string } | null {
  const match = CALLOUT_HEADER_RE.exec(line.trim());
  if (!match) return null;
  return { type: match[1].toLowerCase() };
}

/** Same inverse-of-serialization stripping as multiColumnBlock.ts's `stripQuoteLevels`. */
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

/** A code column's raw (already `>>`-stripped) lines are expected to be exactly one fenced code
 * block — ` ```lang ` / code / ` ``` `. Falls back to treating the whole thing as fenceless code
 * (language "") if a column was hand-edited into something that doesn't fit that shape, rather
 * than dropping it. */
function parseFencedColumn(lines: string[]): CodeColumnData {
  const open = FENCE_OPEN_RE.exec(lines[0] ?? '');
  const close = lines.length > 1 ? FENCE_CLOSE_RE.exec(lines[lines.length - 1] ?? '') : null;
  if (open && close) {
    return { language: open[1], content: lines.slice(1, -1).join('\n') };
  }
  return { language: '', content: lines.join('\n') };
}

/**
 * Finds the `[!code-columns]` callout (if any) whose raw-text line range contains `line`
 * (1-based), parsed fresh from the current editor content. Mirrors
 * `multiColumnBlock.ts`'s `findMultiColumnBlockAt` — same outer-blockquote shape, just with bare
 * (headerless) code-holding columns instead of nested callouts.
 */
export function findCodeColumnsBlockAt(doc: string, line: number): CodeColumnsBlock | null {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(doc);
  let found: CodeColumnsBlock | null = null;

  visit(tree as never, 'blockquote', (node: any) => {
    if (found) return;
    const pos = node.position;
    if (!pos || line < pos.start.line || line > pos.end.line) return;

    const first = node.children?.[0];
    if (!first || first.type !== 'paragraph') return;
    const firstChild = first.children?.[0];
    if (!firstChild || firstChild.type !== 'text') return;
    const header = parseHeaderLine((firstChild.value as string).split('\n')[0]);
    if (!header || header.type !== 'code-columns') return;

    const columns: CodeColumnData[] = [];
    for (const child of node.children.slice(1)) {
      if (child.type !== 'blockquote' || !child.position) continue;
      const colLines = sliceLines(doc, child.position.start.line, child.position.end.line).map((l) =>
        stripQuoteLevels(l, 2),
      );
      columns.push(parseFencedColumn(colLines));
    }
    if (columns.length === 0) return;

    found = { columns, fromLine: pos.start.line, toLine: pos.end.line };
  });

  return found;
}

/** Inverse of the parsing above: builds the raw `>[!code-columns]` / `>>` + fenced-code text for
 * a set of code columns, separating each with a lone `>` line — same column-boundary convention
 * `serializeMultiColumn` uses (see remarkCallouts.ts's doc comment on why that line is needed). */
export function serializeCodeColumns(columns: CodeColumnData[]): string {
  const lines: string[] = ['>[!code-columns]'];
  columns.forEach((col, i) => {
    if (i > 0) lines.push('>');
    const fenced = [`\`\`\`${col.language.trim()}`, ...col.content.split('\n'), '```'];
    for (const line of fenced) {
      lines.push(line ? `>> ${line}` : '>>');
    }
  });
  return lines.join('\n');
}
