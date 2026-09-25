// Pure derivations over the model that both the backend (overview, tools) and
// the frontend (start page, cards, outline) need, so the two can never disagree about what a
// glyph or a count means.
import { BUILTIN_LESSON_ID } from "./constants.ts";
import type {
  Course,
  Example,
  ExampleCounts,
  ExampleProgress,
  ExampleStatus,
  Lesson,
  LessonId,
  LessonStatus,
  IterationProgress,
  Rule,
  RuleStatus,
  StudentState,
} from "./model.ts";

export type ProgressMap = Readonly<Record<string, ExampleProgress>>;

/** An Example with no entry, or whose entry was recorded against different text, is pending. */
export function exampleStatus(example: Example, progress: ProgressMap): ExampleStatus {
  const entry = progress[example.key];
  if (entry === undefined || entry.hash !== example.hash) return "pending";
  return entry.status;
}

export function countExamples(examples: readonly Example[], progress: ProgressMap): ExampleCounts {
  const counts: ExampleCounts = { total: 0, passing: 0, notYet: 0, skipped: 0, pending: 0, fresh: 0 };
  for (const example of examples) {
    counts.total += 1;
    if (example.novelty !== "unchanged") counts.fresh += 1;
    switch (exampleStatus(example, progress)) {
      case "passing":
        counts.passing += 1;
        break;
      case "not-yet":
        counts.notYet += 1;
        break;
      case "skipped":
        counts.skipped += 1;
        break;
      case "pending":
        counts.pending += 1;
        break;
    }
  }
  return counts;
}

export function ruleStatus(rule: Rule, progress: ProgressMap): RuleStatus {
  const statuses = rule.examples.map((example) => exampleStatus(example, progress));
  if (statuses.includes("not-yet")) return "not-yet";
  if (statuses.length > 0 && statuses.every((s) => s === "passing" || s === "skipped")) {
    return "passing";
  }
  return "pending";
}

export function lessonExamples(lesson: Lesson): Example[] {
  return lesson.features.flatMap((feature) => feature.rules.flatMap((rule) => rule.examples));
}

export function findLesson(course: Course, id: string): Lesson | undefined {
  return course.lessons.find((lesson) => lesson.id === id);
}

/** The lesson after `id` in course order, or undefined for the last one. */
export function nextLesson(course: Course, id: string): Lesson | undefined {
  const index = course.lessons.findIndex((lesson) => lesson.id === id);
  return index < 0 ? undefined : course.lessons[index + 1];
}

export function findRule(lesson: Lesson, key: string): Rule | undefined {
  for (const feature of lesson.features) {
    const rule = feature.rules.find((candidate) => candidate.key === key);
    if (rule !== undefined) return rule;
  }
  return undefined;
}

export function findExample(lesson: Lesson, key: string): Example | undefined {
  return lessonExamples(lesson).find((example) => example.key === key);
}

export interface CurrentPointer {
  lessonId: LessonId;
  iterationStatus: IterationProgress;
}

/**
 * Where the student is. spec/ITERATION is canonical (decision 1) whenever it
 * names a lesson of this course. Otherwise PROGRESS.yaml on Lesson 0 means
 * Lesson 0 is under way, and Done once every one of its Examples is passing
 * or skipped. Anything else means nothing has been adopted yet.
 */
export function resolveCurrent(course: Course, student: StudentState): CurrentPointer {
  const fromIteration = student.iteration;
  if (fromIteration !== null && findLesson(course, fromIteration.iteration) !== undefined) {
    return { lessonId: fromIteration.iteration, iterationStatus: fromIteration.status };
  }
  const builtin = findLesson(course, BUILTIN_LESSON_ID);
  if (student.progress?.iteration === BUILTIN_LESSON_ID && builtin !== undefined) {
    const counts = countExamples(lessonExamples(builtin), student.progress.examples);
    const done = counts.total > 0 && counts.passing + counts.skipped === counts.total;
    return { lessonId: BUILTIN_LESSON_ID, iterationStatus: done ? "Done" : "WIP" };
  }
  return { lessonId: BUILTIN_LESSON_ID, iterationStatus: "not-started" };
}

/** Lessons before the current one are done; the current one is done once its status is Done. */
export function lessonStatus(course: Course, pointer: CurrentPointer, id: string): LessonStatus {
  const ids = course.lessons.map((lesson) => lesson.id);
  const current = ids.indexOf(pointer.lessonId);
  const index = ids.indexOf(id);
  if (index < 0) return "ahead";
  if (index < current) return "done";
  if (index > current) return "ahead";
  return pointer.iterationStatus === "Done" ? "done" : "current";
}
