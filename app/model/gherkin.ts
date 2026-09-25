// Gherkin as the lesson prints it (mockup 6B): one line per row so the status
// gutter and a wrapped line always stay level, with keywords and quoted
// strings picked out.
import type { Example, Step } from "../../shared/model.ts";

export type GherkinToken =
  | { kind: "keyword"; text: string }
  | { kind: "string"; text: string }
  | { kind: "tag"; text: string }
  | { kind: "text"; text: string };

export interface GherkinLine {
  /** Indent level; each level is two characters. */
  indent: number;
  tokens: GherkinToken[];
  /** Docstring and table rows keep their spacing verbatim. */
  verbatim: boolean;
}

/** Splits step text so `"quoted strings"` can be coloured. */
export function stepTextTokens(text: string): GherkinToken[] {
  const tokens: GherkinToken[] = [];
  let last = 0;
  for (const match of text.matchAll(/"[^"]*"/g)) {
    if (match.index > last) tokens.push({ kind: "text", text: text.slice(last, match.index) });
    tokens.push({ kind: "string", text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}

export function stepLines(step: Step, indent: number): GherkinLine[] {
  const lines: GherkinLine[] = [
    {
      indent,
      tokens: [{ kind: "keyword", text: step.keyword }, { kind: "text", text: " " }, ...stepTextTokens(step.text)],
      verbatim: false,
    },
  ];
  const verbatim = (text: string): GherkinLine => ({ indent: indent + 1, tokens: [{ kind: "text", text }], verbatim: true });
  if (step.docString !== null) {
    lines.push(verbatim(`"""${step.docString.mediaType ?? ""}`));
    for (const line of step.docString.content.split("\n")) lines.push(verbatim(line));
    lines.push(verbatim('"""'));
  }
  if (step.dataTable !== null) {
    const widths = step.dataTable.reduce<number[]>(
      (acc, row) => row.map((cell, index) => Math.max(acc[index] ?? 0, cell.length)),
      [],
    );
    for (const row of step.dataTable) {
      lines.push(verbatim(`| ${row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ")} |`));
    }
  }
  return lines;
}

/** Tags, the `Example:` line (always index `headerIndex`), then the steps. */
export function exampleLines(example: Example): { lines: GherkinLine[]; headerIndex: number } {
  const lines: GherkinLine[] = [];
  if (example.tags.length > 0) {
    lines.push({
      indent: 0,
      tokens: [{ kind: "tag", text: example.tags.map((tag) => `@${tag}`).join(" ") }],
      verbatim: false,
    });
  }
  const headerIndex = lines.length;
  lines.push({
    indent: 0,
    tokens: [
      { kind: "keyword", text: "Example:" },
      { kind: "text", text: ` ${example.name}` },
    ],
    verbatim: false,
  });
  for (const step of example.steps) lines.push(...stepLines(step, 1));
  return { lines, headerIndex };
}

export function backgroundLines(steps: readonly Step[]): GherkinLine[] {
  if (steps.length === 0) return [];
  return [
    { indent: 0, tokens: [{ kind: "keyword", text: "Background:" }], verbatim: false },
    ...steps.flatMap((step) => stepLines(step, 1)),
  ];
}
