// Where the course page's root sends the student, and what BB's home page
// "Continue" section (mockup 5) says. Both read only getOverview.
import type { TutorRoute } from "../../shared/routes.ts";
import type { Overview } from "../../shared/rpc.ts";
import { lessonLabel, lessonNumber, percent } from "./format.ts";

export type HomeDecision = { kind: "error"; message: string } | { kind: "redirect"; route: TutorRoute };

export function homeDecision(overview: Overview): HomeDecision {
  if (overview.course === null) {
    return { kind: "error", message: overview.courseError ?? "The course could not be loaded." };
  }
  if (overview.binding.status !== "bound") return { kind: "redirect", route: { kind: "welcome" } };
  const current = overview.current;
  if (current === null) {
    const first = overview.lessons[0];
    return first === undefined
      ? { kind: "error", message: "This course has no lessons yet." }
      : { kind: "redirect", route: { kind: "start", lessonId: first.id } };
  }
  return {
    kind: "redirect",
    route: {
      kind: current.iterationStatus === "Done" ? "complete" : "start",
      lessonId: current.lessonId,
    },
  };
}

export type ContinueView =
  | { kind: "error"; message: string }
  | { kind: "setup"; courseTitle: string; missing: boolean }
  | {
      kind: "continue";
      lessonId: string;
      eyebrow: string;
      title: string;
      focusRuleName: string | null;
      lastNote: { exampleName: string; note: string } | null;
      passing: number;
      total: number;
      percent: number;
      freshRules: number;
      freshRulesPassing: number;
      /** "Lessons 1–2 done ✓", or null before any real lesson is done. */
      doneLabel: string | null;
      coachThreadId: string | null;
      complete: boolean;
    };

/** "Lessons 1–2", "Lessons 1, 3", "Lesson 1". */
export function doneLessonsLabel(ids: readonly string[]): string | null {
  const numbers = ids.map(lessonNumber).sort((a, b) => a - b);
  const first = numbers[0];
  const last = numbers.at(-1);
  if (first === undefined || last === undefined) return null;
  if (numbers.length === 1) return `Lesson ${first} done ✓`;
  const contiguous = numbers.every((n, index) => n === first + index);
  return contiguous ? `Lessons ${first}–${last} done ✓` : `Lessons ${numbers.join(", ")} done ✓`;
}

export function continueView(overview: Overview): ContinueView {
  if (overview.course === null) {
    return { kind: "error", message: overview.courseError ?? "The course could not be loaded." };
  }
  const current = overview.current;
  if (overview.binding.status !== "bound" || current === null) {
    return { kind: "setup", courseTitle: overview.course.title, missing: overview.binding.status === "missing" };
  }
  const summary = overview.lessons.find((lesson) => lesson.id === current.lessonId);
  const set = summary?.set ?? null;
  const rules = current.outline.flatMap((feature) => feature.rules).filter((rule) => rule.novelty !== "unchanged");
  return {
    kind: "continue",
    lessonId: current.lessonId,
    eyebrow: ["Continue", lessonLabel(current.lessonId), set].filter((part) => part !== null).join(" · "),
    title: summary?.title ?? lessonLabel(current.lessonId),
    focusRuleName: current.focusRuleName,
    lastNote: current.lastNote === null ? null : { exampleName: current.lastNote.exampleName, note: current.lastNote.note },
    passing: current.counts.passing,
    total: current.counts.total,
    percent: percent(current.counts.passing, current.counts.total),
    freshRules: rules.length,
    freshRulesPassing: rules.filter((rule) => rule.status === "passing").length,
    doneLabel: doneLessonsLabel(
      overview.lessons.filter((lesson) => lesson.status === "done" && !lesson.builtin).map((lesson) => lesson.id),
    ),
    coachThreadId: current.coachThreadId,
    complete: current.iterationStatus === "Done",
  };
}
