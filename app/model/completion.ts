// Between homeworks (mockup 7): the finished homework's recap and the next
// homework's introduction.
import { formatRoute } from "../../shared/routes.ts";
import type { DiffLine } from "../../shared/model.ts";
import type { Completion } from "../../shared/rpc.ts";
import { daysSince, homeworkLabel, plural, setLabel } from "./format.ts";
import type { Chip } from "./lesson.ts";

export interface Stat {
  value: string;
  label: string;
}

export interface NextHomeworkView {
  id: string;
  eyebrow: string;
  title: string;
  dek: string;
  chips: Chip[];
  diff: { title: string; lines: DiffLine[] } | null;
  /** The student has already started it: the button continues its coach thread. */
  started: boolean;
  startLabel: string;
  lessonSubPath: string;
}

export interface CompletionView {
  eyebrow: string;
  title: string;
  stats: Stat[];
  summary: string | null;
  next: NextHomeworkView | null;
}

/** "Lesson 4 · Also set after day 3" when both lessons were set the same day. */
function nextEyebrow(next: NonNullable<Completion["next"]>, finishedSet: string | null): string {
  const label = setLabel(next.set);
  if (label === null) return homeworkLabel(next.id);
  const also = next.set === finishedSet && label.startsWith("Set after");
  return `${homeworkLabel(next.id)} · ${also ? `Also ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}`;
}

export function completionView(completion: Completion, now: number): CompletionView {
  const { homework, counts, next } = completion;
  const since = daysSince(completion.adoptedAt, now);
  const stats: Stat[] = [
    { value: `${counts.passing}/${counts.total}`, label: "examples hold" },
    { value: String(completion.freshRules), label: completion.freshRules === 1 ? "new or reworded rule" : "new or reworded rules" },
    { value: String(completion.sideThreads), label: completion.sideThreads === 1 ? "side chat" : "side chats" },
  ];
  if (since !== null) stats.push({ value: since, label: since === "today" ? "adopted" : "since adopted" });
  return {
    eyebrow: `${homeworkLabel(homework.id)} complete`,
    title: homework.title,
    stats,
    summary: completion.summary,
    next:
      next === null
        ? null
        : {
            id: next.id,
            eyebrow: nextEyebrow(next, homework.set),
            title: next.title,
            dek: next.dek,
            chips: [
              { text: `${plural(next.rules, "rule")} · ${plural(next.examples, "example")}`, tone: "plain" },
              ...(next.carryOver > 0 ? [{ text: `${next.carryOver} carry over as passing`, tone: "green" as const }] : []),
              ...(next.fresh > 0 ? [{ text: `${next.fresh} new or reworded`, tone: "amber" as const }] : []),
            ],
            diff:
              next.factoryDiff === null || next.factoryDiff.length === 0
                ? null
                : {
                    title: `FACTORY.md — what changed since ${homeworkLabel(homework.id).toLowerCase()}`,
                    lines: next.factoryDiff,
                  },
            started: next.status !== "ahead",
            startLabel: `${next.status === "ahead" ? "Start" : "Continue"} ${homeworkLabel(next.id).toLowerCase()} with your coach →`,
            lessonSubPath: formatRoute({ kind: "lesson", homeworkId: next.id }),
          },
  };
}

export interface ConfettiPiece {
  left: number;
  top: number;
  rotate: number;
  color: string;
}

const CONFETTI_COLOURS = ["#2459a8", "#1f735b", "#e3b341", "#b43b3b", "#7c5cc4", "#2a9d8f"] as const;

/** The mockup's deterministic scatter, kept to the top right so the heading and summary stay clear. */
export function confettiPieces(count = 46): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => ({
    left: 55 + ((i * 37) % 45),
    top: Math.round(((i * 53) % 90) * 0.4),
    rotate: (i * 47) % 360,
    color: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length] ?? "#2459a8",
  }));
}
