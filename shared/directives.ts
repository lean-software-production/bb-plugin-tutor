// Attribute contracts for the three message directives. BB renders them in
// every thread (not only Tutor's), and the attributes are whatever the model
// wrote, so the frontend parses them here and renders nothing it did not
// validate. The backend and the skill use the format functions to tell the
// coach exactly what to write. Zod-free on purpose: the frontend imports this
// module at runtime.
//
//   ::tutor-lesson{lesson="003"}         the lesson card opening a coach thread
//   ::tutor-progress{kind="rule-passing" title="…" passed="30" total="41" next="…"}
//   ::term{id="doer"}
//
// A `focus` progress card is also a Rule's section header: it carries a DOM
// anchor (ruleAnchor) that the course outline scrolls to.
//
// Directives are leaf (block) directives: each must sit on its own line.
import { DIRECTIVE_NAMES } from "./constants.ts";
import { EXAMPLE_KEY_PATTERN, RULE_KEY_PATTERN, SLUG_PATTERN } from "./keys.ts";

type Attributes = Readonly<Record<string, string>>;

const MAX_TITLE = 160;
const MAX_NOTE = 400;
const MAX_COUNT = 100_000;
const LESSON_ID = /^\d{3}$/;
const THREAD_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const PROGRESS_KINDS = [
  /** ✓ green: every Example of a Rule holds. `next` names the Rule now in focus. */
  "rule-passing",
  /** ✓ green: one Example holds. */
  "example-passing",
  /** ! amber: an Example does not hold yet; `note` says why. */
  "not-yet",
  /** ● blue: the coach moved the focus to a Rule. It is also the Rule card that opens the Rule's section. */
  "focus",
  /** ✓ green, larger: the lesson is done. */
  "lesson-complete",
] as const;
export type ProgressKind = (typeof PROGRESS_KINDS)[number];

export interface ProgressCard {
  kind: ProgressKind;
  /** Rule or Example name (lesson title for lesson-complete). */
  title: string;
  passed: number | null;
  total: number | null;
  /** Name of the Rule now in focus. */
  next: string | null;
  note: string | null;
  lessonId: string | null;
  ruleKey: string | null;
  exampleKey: string | null;
}

export interface LessonRef {
  lessonId: string;
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
    lessonId: matching(attributes.lesson, LESSON_ID),
    ruleKey: matching(attributes.rule, RULE_KEY_PATTERN),
    exampleKey: matching(attributes.example, EXAMPLE_KEY_PATTERN),
  };
}

/** Null when the lesson id is missing or malformed: render the fallback. */
export function parseLessonRef(attributes: Attributes): LessonRef | null {
  const lessonId = matching(attributes.lesson, LESSON_ID);
  return lessonId === null ? null : { lessonId };
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
    attribute("lesson", card.lessonId),
    attribute("rule", card.ruleKey),
    attribute("example", card.exampleKey),
  ].join("");
  return `::${DIRECTIVE_NAMES.progress}{${attrs.trim()}}`;
}

export function formatLessonRef(ref: LessonRef): string {
  return `::${DIRECTIVE_NAMES.lesson}{${attribute("lesson", ref.lessonId).trim()}}`;
}

/** The DOM attribute a Rule section card carries, and the outline looks for. */
export const RULE_ANCHOR_ATTRIBUTE = "data-tutor-rule-anchor";

/**
 * `<threadId>|<lessonId>/<ruleKey>`: where the coach started a Rule. Only
 * anchors in a lesson's own coach thread count, so the thread is part of
 * it. Null for anything malformed.
 */
export function ruleAnchor(threadId: string, lessonId: string, ruleKey: string): string | null {
  if (!THREAD_ID.test(threadId) || !LESSON_ID.test(lessonId) || !RULE_KEY_PATTERN.test(ruleKey)) return null;
  return `${threadId}|${lessonId}/${ruleKey}`;
}

/**
 * `text` without the directive lines it opens with, for a title drawn from a
 * message: BB names a side chat after the message it replies to, and a coach's
 * message often opens with a card. Handles a directive cut short ("…").
 */
export function withoutLeadingDirectives(text: string): string {
  return text.replace(/^(?:\s*::[a-z-]+\{[^}\n]*(?:\}|…|\.\.\.|$))+\s*/, "").trim();
}

export function formatTermRef(ref: TermRef): string {
  const attrs = `${attribute("id", ref.id)}${attribute("label", ref.label)}`;
  return `::${DIRECTIVE_NAMES.term}{${attrs.trim()}}`;
}
