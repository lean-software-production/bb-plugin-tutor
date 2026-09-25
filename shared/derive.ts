// Pure derivations over the model that both the backend (overview, tools) and
// the frontend (lesson page) need, so the two can never disagree about what a
// glyph or a count means.
import { BUILTIN_HOMEWORK_ID } from "./constants.ts";
import type {
  Course,
  Example,
  ExampleCounts,
  ExampleProgress,
  ExampleStatus,
  Homework,
  HomeworkId,
  HomeworkStatus,
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

export function homeworkExamples(homework: Homework): Example[] {
  return homework.features.flatMap((feature) => feature.rules.flatMap((rule) => rule.examples));
}

export function findHomework(course: Course, id: string): Homework | undefined {
  return course.homeworks.find((homework) => homework.id === id);
}

/** The homework after `id` in course order, or undefined for the last one. */
export function nextHomework(course: Course, id: string): Homework | undefined {
  const index = course.homeworks.findIndex((homework) => homework.id === id);
  return index < 0 ? undefined : course.homeworks[index + 1];
}

export function findRule(homework: Homework, key: string): Rule | undefined {
  for (const feature of homework.features) {
    const rule = feature.rules.find((candidate) => candidate.key === key);
    if (rule !== undefined) return rule;
  }
  return undefined;
}

export function findExample(homework: Homework, key: string): Example | undefined {
  return homeworkExamples(homework).find((example) => example.key === key);
}

export interface CurrentPointer {
  homeworkId: HomeworkId;
  iterationStatus: IterationProgress;
}

/**
 * Where the student is. spec/ITERATION is canonical (decision 1) whenever it
 * names a homework of this course. Otherwise PROGRESS.yaml on Homework 0 means
 * Homework 0 is under way, and Done once every one of its Examples is passing
 * or skipped. Anything else means nothing has been adopted yet.
 */
export function resolveCurrent(course: Course, student: StudentState): CurrentPointer {
  const fromIteration = student.iteration;
  if (fromIteration !== null && findHomework(course, fromIteration.iteration) !== undefined) {
    return { homeworkId: fromIteration.iteration, iterationStatus: fromIteration.status };
  }
  const builtin = findHomework(course, BUILTIN_HOMEWORK_ID);
  if (student.progress?.iteration === BUILTIN_HOMEWORK_ID && builtin !== undefined) {
    const counts = countExamples(homeworkExamples(builtin), student.progress.examples);
    const done = counts.total > 0 && counts.passing + counts.skipped === counts.total;
    return { homeworkId: BUILTIN_HOMEWORK_ID, iterationStatus: done ? "Done" : "WIP" };
  }
  return { homeworkId: BUILTIN_HOMEWORK_ID, iterationStatus: "not-started" };
}

/** Homeworks before the current one are done; the current one is done once its status is Done. */
export function homeworkStatus(course: Course, pointer: CurrentPointer, id: string): HomeworkStatus {
  const ids = course.homeworks.map((homework) => homework.id);
  const current = ids.indexOf(pointer.homeworkId);
  const index = ids.indexOf(id);
  if (index < 0) return "ahead";
  if (index < current) return "done";
  if (index > current) return "ahead";
  return pointer.iterationStatus === "Done" ? "done" : "current";
}
