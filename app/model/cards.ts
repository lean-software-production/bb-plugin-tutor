// What the chat directives draw (mockup 3A). Attribute validation lives in
// shared/directives.ts; this turns a validated card or term into display text.
import { ruleKeyOfExample } from "../../shared/keys.ts";
import type { ProgressCard, ProgressKind, TermRef } from "../../shared/directives.ts";
import type { LexiconEntry } from "../../shared/model.ts";
import { homeworkLabel } from "./format.ts";

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
  rule: { homeworkId: string; ruleKey: string } | null;
  /** Homework whose completion page the card links to. */
  completedHomeworkId: string | null;
}

const LOOK: Record<ProgressKind, { tone: CardTone; mark: string; eyebrow: string }> = {
  "rule-passing": { tone: "green", mark: "✓", eyebrow: "Rule passing" },
  "example-passing": { tone: "green", mark: "✓", eyebrow: "Example passing" },
  "not-yet": { tone: "amber", mark: "!", eyebrow: "Not yet" },
  focus: { tone: "blue", mark: "●", eyebrow: "Now working on" },
  "homework-complete": { tone: "green", mark: "✓", eyebrow: "Lesson complete" },
};

export function progressCardView(card: ProgressCard): ProgressCardView {
  const look = LOOK[card.kind];
  const ruleKey = card.ruleKey ?? (card.exampleKey === null ? null : ruleKeyOfExample(card.exampleKey));
  const isComplete = card.kind === "homework-complete";
  return {
    kind: card.kind,
    tone: look.tone,
    mark: look.mark,
    eyebrow: isComplete && card.homeworkId !== null ? `${homeworkLabel(card.homeworkId)} complete` : look.eyebrow,
    title: card.title,
    ring: card.passed === null || card.total === null ? null : `${card.passed}/${card.total}`,
    next: card.kind === "rule-passing" ? card.next : null,
    note: card.note,
    rule: card.homeworkId !== null && ruleKey !== null && !isComplete ? { homeworkId: card.homeworkId, ruleKey } : null,
    completedHomeworkId: isComplete ? card.homeworkId : null,
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
