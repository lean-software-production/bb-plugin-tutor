// Where the course page's root sends the student, and what BB's home page
// "Continue" section (mockup 5) says. Both read only getOverview, and both
// follow the course the student is on: Tutor's built-in course until Lesson 0
// is done, then the course after it.
import type { TutorRoute } from "../../shared/routes.ts";
import type { CourseOverview, Overview } from "../../shared/rpc.ts";
import { lessonLabel, lessonNumber, percent } from "./format.ts";

export type HomeDecision = { kind: "error"; message: string } | { kind: "redirect"; route: TutorRoute };

const NO_COURSE = "We couldn't load the course.";

/** Why no course could be shown: the first load error, else a general line. */
function noCourseMessage(overview: Overview): string {
  return overview.courseErrors[0]?.error ?? NO_COURSE;
}

/**
 * The course the student is on: the built-in course (Lesson 0) until it is
 * done, then the first course after it. With no other course, the built-in one.
 */
export function activeCourse(overview: Overview): CourseOverview | null {
  const builtin = overview.courses.find((entry) => entry.builtin);
  const next = overview.courses.find((entry) => !entry.builtin);
  if (builtin === undefined) return next ?? null;
  if (next === undefined) return builtin;
  const done = builtin.current?.iterationStatus === "Done" || (builtin.lessons.length > 0 && builtin.lessons.every((lesson) => lesson.status === "done"));
  return done ? next : builtin;
}

export function homeDecision(overview: Overview): HomeDecision {
  if (overview.courses.length === 0) return { kind: "error", message: noCourseMessage(overview) };
  if (overview.workspace.status !== "found") return { kind: "redirect", route: { kind: "welcome" } };
  const active = activeCourse(overview);
  if (active === null) return { kind: "error", message: noCourseMessage(overview) };
  const courseId = active.course.id;
  const current = active.current;
  if (current === null) {
    const first = active.lessons[0];
    return first === undefined
      ? { kind: "error", message: "This course has no lessons yet." }
      : { kind: "redirect", route: { kind: "start", courseId, lessonId: first.id } };
  }
  return {
    kind: "redirect",
    route: {
      kind: current.iterationStatus === "Done" ? "complete" : "start",
      courseId,
      lessonId: current.lessonId,
    },
  };
}

export type ContinueView =
  | { kind: "error"; message: string }
  | { kind: "setup"; courseTitle: string; missing: boolean }
  | {
      kind: "continue";
      courseId: string;
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

/** The course a first run sets up: the one after the built-in course, else the built-in one. */
function setupTitle(overview: Overview): string {
  return (overview.courses.find((entry) => !entry.builtin) ?? overview.courses[0])?.course.title ?? "Your course";
}

export function continueView(overview: Overview): ContinueView {
  if (overview.courses.length === 0) return { kind: "error", message: noCourseMessage(overview) };
  const active = activeCourse(overview);
  const current = active?.current ?? null;
  if (overview.workspace.status !== "found" || active === null || current === null) {
    return { kind: "setup", courseTitle: setupTitle(overview), missing: overview.workspace.status === "missing" };
  }
  const summary = active.lessons.find((lesson) => lesson.id === current.lessonId);
  const set = summary?.set ?? null;
  const rules = current.outline.flatMap((feature) => feature.rules).filter((rule) => rule.change !== "unchanged");
  return {
    kind: "continue",
    courseId: active.course.id,
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
      active.lessons.filter((lesson) => lesson.status === "done" && !lesson.builtin).map((lesson) => lesson.id),
    ),
    coachThreadId: current.coachThreadId,
    complete: current.iterationStatus === "Done",
  };
}
