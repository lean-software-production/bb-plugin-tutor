// Between lessons (mockup 7): the finished lesson's recap and the next
// lesson's introduction.
import { formatRoute } from "../../shared/routes.ts";
import type { DiffLine } from "../../shared/model.ts";
import type { Completion } from "../../shared/rpc.ts";
import { daysSince, lessonLabel, plural, setLabel } from "./format.ts";
import type { Chip } from "./lesson.ts";

export interface Stat {
  value: string;
  label: string;
}

export interface NextLessonView {
  id: string;
  eyebrow: string;
  title: string;
  dek: string;
  chips: Chip[];
  diff: { title: string; lines: DiffLine[] } | null;
  /** The student has already started it: the button continues its coach thread. */
  started: boolean;
  startLabel: string;
  startPath: string;
}

export interface CompletionView {
  eyebrow: string;
  title: string;
  stats: Stat[];
  summary: string | null;
  next: NextLessonView | null;
}

/** "Lesson 4 · Also set after day 3" when both lessons were set the same day. */
function nextEyebrow(next: NonNullable<Completion["next"]>, finishedSet: string | null): string {
  const label = setLabel(next.set);
  if (label === null) return lessonLabel(next.id);
  const also = next.set === finishedSet && label.startsWith("Set after");
  return `${lessonLabel(next.id)} · ${also ? `Also ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}`;
}

export function completionView(completion: Completion, now: number): CompletionView {
  const { lesson, counts, next } = completion;
  const since = daysSince(completion.adoptedAt, now);
  const stats: Stat[] = [
    { value: `${counts.passing}/${counts.total}`, label: "examples hold" },
    { value: String(completion.freshRules), label: completion.freshRules === 1 ? "new or reworded rule" : "new or reworded rules" },
    { value: String(completion.sideChats), label: completion.sideChats === 1 ? "side chat" : "side chats" },
  ];
  if (since !== null) stats.push({ value: since, label: since === "today" ? "adopted" : "since adopted" });
  return {
    eyebrow: `${lessonLabel(lesson.id)} complete`,
    title: lesson.title,
    stats,
    summary: completion.summary,
    next:
      next === null
        ? null
        : {
            id: next.id,
            eyebrow: nextEyebrow(next, lesson.set),
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
                    title: `FACTORY.md — what changed since ${lessonLabel(lesson.id).toLowerCase()}`,
                    lines: next.factoryDiff,
                  },
            started: next.status !== "ahead",
            startLabel: `${next.status === "ahead" ? "Start" : "Continue"} ${lessonLabel(next.id).toLowerCase()} with your coach →`,
            startPath: formatRoute({ kind: "start", lessonId: next.id }),
          },
  };
}

export interface DoneRibbonView {
  /** "Lesson 1 done." */
  kicker: string;
  /** "All 5 Examples hold.", or null before the stats have loaded. */
  line: string | null;
}

/** The lesson-complete ribbon. The kicker needs only the lesson, so it shows while the stats load. */
export function doneRibbon(lessonId: string, counts: Pick<Completion["counts"], "passing" | "total"> | null): DoneRibbonView {
  const kicker = `${lessonLabel(lessonId)} done.`;
  if (counts === null) return { kicker, line: null };
  const all = counts.passing === counts.total;
  return { kicker, line: all ? `All ${counts.total} Examples hold.` : `${counts.passing} of ${counts.total} Examples hold.` };
}

export interface WhatsNextView {
  label: string;
  /** "Lesson 2 · Checking the work", the end of the course, or null before the stats have loaded. */
  detail: string | null;
}

export function whatsNext(view: CompletionView | null): WhatsNextView {
  const label = "What's next →";
  if (view === null) return { label, detail: null };
  return { label, detail: view.next === null ? "That was the last lesson" : `${lessonLabel(view.next.id)} · ${view.next.title}` };
}
