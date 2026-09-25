// Attribute contracts for the two message directives. BB renders them in
// every thread (not only Tutor's), and the attributes are whatever the model
// wrote, so the frontend parses them here and renders nothing it did not
// validate. The backend and the skill use the format functions to tell the
// coach exactly what to write. Zod-free on purpose: the frontend imports this
// module at runtime.
//
//   ::tutor-progress{kind="rule-passing" title="…" passed="30" total="41" next="…"}
//   ::term{id="doer"}
//
// Directives are leaf (block) directives: each must sit on its own line.
import { DIRECTIVE_NAMES } from "./constants.ts";
import { EXAMPLE_KEY_PATTERN, RULE_KEY_PATTERN, SLUG_PATTERN } from "./keys.ts";

type Attributes = Readonly<Record<string, string>>;

const MAX_TITLE = 160;
const MAX_NOTE = 400;
const MAX_COUNT = 100_000;
const HOMEWORK_ID = /^\d{3}$/;

export const PROGRESS_KINDS = [
  /** ✓ green: every Example of a Rule holds. `next` names the Rule now in focus. */
  "rule-passing",
  /** ✓ green: one Example holds. */
  "example-passing",
  /** ! amber: an Example does not hold yet; `note` says why. */
  "not-yet",
  /** ● blue: the coach moved the cursor to a Rule. */
  "focus",
  /** ✓ green, larger: the homework is done. */
  "homework-complete",
] as const;
export type ProgressKind = (typeof PROGRESS_KINDS)[number];

export interface ProgressCard {
  kind: ProgressKind;
  /** Rule or Example name (homework title for homework-complete). */
  title: string;
  passed: number | null;
  total: number | null;
  /** Name of the Rule now in focus. */
  next: string | null;
  note: string | null;
  homeworkId: string | null;
  ruleKey: string | null;
  exampleKey: string | null;
}

export interface TermRef {
  /** Lexicon id (the key in lexicon.yaml). */
  id: string;
  /** Text to show instead of the lexicon term, e.g. a plural. */
  label: string | null;
}

function text(value: string | undefined, max: number): string | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function count(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n <= MAX_COUNT ? n : null;
}

function matching(value: string | undefined, pattern: RegExp): string | null {
  return value !== undefined && pattern.test(value) ? value : null;
}

function isProgressKind(value: string | undefined): value is ProgressKind {
  return (PROGRESS_KINDS as readonly string[]).includes(value ?? "");
}

/** Null when the directive is unusable (unknown kind or no title): render the fallback. */
export function parseProgressCard(attributes: Attributes): ProgressCard | null {
  const kind = attributes.kind;
  const title = text(attributes.title, MAX_TITLE);
  if (!isProgressKind(kind) || title === null) return null;
  let passed = count(attributes.passed);
  let total = count(attributes.total);
  if (passed === null || total === null || passed > total) {
    passed = null;
    total = null;
  }
  return {
    kind,
    title,
    passed,
    total,
    next: text(attributes.next, MAX_TITLE),
    note: text(attributes.note, MAX_NOTE),
    homeworkId: matching(attributes.homework, HOMEWORK_ID),
    ruleKey: matching(attributes.rule, RULE_KEY_PATTERN),
    exampleKey: matching(attributes.example, EXAMPLE_KEY_PATTERN),
  };
}

export function parseTermRef(attributes: Attributes): TermRef | null {
  const id = matching(attributes.id, SLUG_PATTERN);
  if (id === null) return null;
  return { id, label: text(attributes.label, MAX_TITLE) };
}

/** Values are double-quoted; quotes, braces and newlines cannot survive, so they are replaced. */
function attribute(name: string, value: string | number | null): string {
  if (value === null) return "";
  const safe = String(value)
    .replace(/\s+/g, " ")
    .replace(/"/g, "”")
    .replace(/[{}]/g, "")
    .trim();
  return safe === "" ? "" : ` ${name}="${safe}"`;
}

export function formatProgressCard(card: ProgressCard): string {
  const attrs = [
    attribute("kind", card.kind),
    attribute("title", card.title),
    attribute("passed", card.passed),
    attribute("total", card.total),
    attribute("next", card.next),
    attribute("note", card.note),
    attribute("homework", card.homeworkId),
    attribute("rule", card.ruleKey),
    attribute("example", card.exampleKey),
  ].join("");
  return `::${DIRECTIVE_NAMES.progress}{${attrs.trim()}}`;
}

export function formatTermRef(ref: TermRef): string {
  const attrs = `${attribute("id", ref.id)}${attribute("label", ref.label)}`;
  return `::${DIRECTIVE_NAMES.term}{${attrs.trim()}}`;
}
