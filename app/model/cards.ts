// What the chat directives draw (mockup 3A). Attribute validation lives in
// shared/directives.ts; this turns a validated card or term into display text.
import { ruleKeyOfExample } from "../../shared/keys.ts";
import type { ProgressCard, ProgressKind, TermRef } from "../../shared/directives.ts";
import type { LexiconEntry } from "../../shared/model.ts";
import { lessonLabel } from "./format.ts";

export type CardTone = "green" | "amber" | "blue";

export interface ProgressCardView {
  kind: ProgressKind;
  tone: CardTone;
  mark: string;
  eyebrow: string;
  title: string;
  /** "30/41", or null when the coach gave no usable counts. */
  ring: string | null;
  /** "Now: <Rule>" row under a passing Rule. */
  next: string | null;
  note: string | null;
  /** Enough to open the Rule tab for this card. */
  rule: { lessonId: string; ruleKey: string } | null;
  /** Lesson whose completion page the card links to. */
  completedLessonId: string | null;
}

const LOOK: Record<ProgressKind, { tone: CardTone; mark: string; eyebrow: string }> = {
  "rule-passing": { tone: "green", mark: "✓", eyebrow: "Rule passing" },
  "example-passing": { tone: "green", mark: "✓", eyebrow: "Example passing" },
  "not-yet": { tone: "amber", mark: "!", eyebrow: "Not yet" },
  focus: { tone: "blue", mark: "●", eyebrow: "Now working on" },
  "lesson-complete": { tone: "green", mark: "✓", eyebrow: "Lesson complete" },
};

export function progressCardView(card: ProgressCard): ProgressCardView {
  const look = LOOK[card.kind];
  const ruleKey = card.ruleKey ?? (card.exampleKey === null ? null : ruleKeyOfExample(card.exampleKey));
  const isComplete = card.kind === "lesson-complete";
  return {
    kind: card.kind,
    tone: look.tone,
    mark: look.mark,
    eyebrow: isComplete && card.lessonId !== null ? `${lessonLabel(card.lessonId)} complete` : look.eyebrow,
    title: card.title,
    ring: card.passed === null || card.total === null ? null : `${card.passed}/${card.total}`,
    next: card.kind === "rule-passing" ? card.next : null,
    note: card.note,
    rule: card.lessonId !== null && ruleKey !== null && !isComplete ? { lessonId: card.lessonId, ruleKey } : null,
    completedLessonId: isComplete ? card.lessonId : null,
  };
}

export interface TermView {
  label: string;
  entry: LexiconEntry;
}

/** Null when the id is not in the course's lexicon: the directive then falls back to its source. */
export function termView(ref: TermRef, lexicon: readonly LexiconEntry[]): TermView | null {
  const entry = lexicon.find((candidate) => candidate.id === ref.id);
  return entry === undefined ? null : { label: ref.label ?? entry.term, entry };
}
