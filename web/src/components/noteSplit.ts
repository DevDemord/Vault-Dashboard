/**
 * Splits a raw note's frontmatter + first H1 heading — boilerplate that's redundant once the
 * surrounding view already shows the note's title on its own (the page's `<h1>`, or the quick-
 * capture box's own date label) — from everything after it. The split is exact-substring, not
 * trim-and-reconstruct, so `header + body` round-trips byte-for-byte back to the original when
 * nothing's been typed yet.
 */
export function splitHeaderBody(raw: string): { header: string; body: string } {
  let idx = 0;
  if (raw.startsWith('---\n')) {
    const closeAt = raw.indexOf('\n---', 4);
    if (closeAt !== -1) {
      const lineEnd = raw.indexOf('\n', closeAt + 1);
      idx = lineEnd === -1 ? raw.length : lineEnd + 1;
    }
  }
  const rest = raw.slice(idx);
  const headingMatch = rest.match(/^(?:[ \t]*\n)*# [^\n]*\n?/);
  if (headingMatch) idx += headingMatch[0].length;
  return { header: raw.slice(0, idx), body: raw.slice(idx) };
}
