// A deliberately tiny inline-markdown reader for text Tutor shows on paper:
// lexicon definitions, coach notes, README deks. It never produces HTML, only
// tokens that React renders as text, so untrusted input cannot inject markup.
// Links keep their text and drop their target: lexicon links point at
// course-repo paths that mean nothing inside BB.

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string };

const PATTERN = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])|\[([^\]\n]+)\]\([^)\s]*\)/g;

export function parseInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  const push = (token: InlineToken) => {
    const previous = tokens.at(-1);
    if (token.kind === "text" && previous?.kind === "text") previous.text += token.text;
    else tokens.push(token);
  };
  for (const match of source.matchAll(PATTERN)) {
    const index = match.index;
    if (index > last) push({ kind: "text", text: source.slice(last, index) });
    const [, code, strong, star, underscore, link] = match;
    if (code !== undefined) push({ kind: "code", text: code });
    else if (strong !== undefined) push({ kind: "strong", text: strong });
    else if (star !== undefined) push({ kind: "em", text: star });
    else if (underscore !== undefined) push({ kind: "em", text: underscore });
    else if (link !== undefined) push({ kind: "text", text: link });
    last = index + match[0].length;
  }
  if (last < source.length) push({ kind: "text", text: source.slice(last) });
  return tokens;
}
