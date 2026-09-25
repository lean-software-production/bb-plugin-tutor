// What the course outline and start page read out of a lesson's README.md.

const ITALIC_LINE = /^(\*[^*]+\*|_[^_]+_)$/;
const NOT_PROSE = /^(#|```|~~~|[-*+] |\d+[.)] |>|\||<)/;

/**
 * The prose paragraphs, each on one line: headings, italic-only lines (the
 * "Set after…" line), code fences, lists, quotes, tables and HTML are skipped.
 */
function proseParagraphs(markdown: string): string[] {
  const paragraphs: string[] = [];
  let inFence = false;
  for (const block of markdown.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const text = block.trim();
    const startsFenced = inFence;
    if ((text.match(/^(```|~~~)/gm)?.length ?? 0) % 2 === 1) inFence = !inFence;
    if (startsFenced || text === "" || NOT_PROSE.test(text)) continue;
    const joined = text.replace(/\s+/g, " ");
    if (!ITALIC_LINE.test(joined)) paragraphs.push(joined);
  }
  return paragraphs;
}

function sentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+/);
}

/** Sentences of prose that more than one of `readmes` contains: the course's boilerplate. */
export function sharedSentences(readmes: readonly string[]): Set<string> {
  const seen = new Map<string, number>();
  for (const readme of readmes) {
    for (const sentence of new Set(proseParagraphs(readme).flatMap(sentences))) {
      seen.set(sentence, (seen.get(sentence) ?? 0) + 1);
    }
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([sentence]) => sentence));
}

/**
 * The first prose paragraph, on one line, without the `boilerplate`
 * sentences; a paragraph with nothing else in it is skipped. "" if none.
 */
export function readmeDek(markdown: string, boilerplate: ReadonlySet<string> = new Set()): string {
  for (const paragraph of proseParagraphs(markdown)) {
    const own = sentences(paragraph).filter((sentence) => !boilerplate.has(sentence));
    if (own.length > 0) return own.join(" ");
  }
  return "";
}

/** The text of the first "# " heading, or null. */
export function firstHeading(markdown: string): string | null {
  const match = markdown.match(/^#[ \t]+(.+?)[ \t#]*$/m);
  return match?.[1] ?? null;
}
