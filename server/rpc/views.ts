// Pure builders for the read-side RPC payloads, from the re-derived world and
// the Tutor threads in the factory project.
import {
  countExamples,
  exampleStatus,
  findHomework,
  findRule,
  homeworkExamples,
  homeworkStatus,
  nextHomework,
  ruleStatus,
  type ProgressMap,
} from "../../shared/derive.ts";
import type { Course, Homework } from "../../shared/model.ts";
import type { Completion, CurrentState, FeatureOutline, Lesson, Overview, TutorThread } from "../../shared/rpc.ts";
import { progressFor, recordedProgress } from "../progress/current.ts";
import { findMainThread, type TutorThreadRecord } from "../coach/threads.ts";
import type { World } from "../coach/world.ts";

export function publicThread(record: TutorThreadRecord): TutorThread {
  return { id: record.id, homeworkId: record.homeworkId, role: record.role, ruleKey: record.ruleKey, title: record.title };
}

export function requireCourse(world: World): Course {
  if (world.course === null) throw new Error(`The course could not be loaded: ${world.courseError ?? "unknown error"}`);
  return world.course;
}

export function requireHomework(course: Course, homeworkId: string): Homework {
  const homework = findHomework(course, homeworkId);
  if (homework === undefined) throw new Error(`There is no homework ${homeworkId} in this course.`);
  return homework;
}

/** Progress entries recorded for `homework`, current or from the history, else none. */
function progressMap(world: World, homeworkId: string): ProgressMap {
  return recordedProgress(world.student, homeworkId)?.examples ?? {};
}

function latest(values: readonly (string | undefined)[]): string | null {
  return values.filter((value): value is string => value !== undefined).sort().at(-1) ?? null;
}

export function outline(homework: Homework, progress: ProgressMap, focus: string | null): FeatureOutline[] {
  return homework.features.map((feature) => ({
    slug: feature.slug,
    name: feature.name,
    path: feature.path,
    novelty: feature.novelty,
    counts: countExamples(feature.rules.flatMap((rule) => rule.examples), progress),
    rules: feature.rules.map((rule) => ({
      key: rule.key,
      name: rule.name,
      novelty: rule.novelty,
      status: ruleStatus(rule, progress),
      isFocus: rule.key === focus,
      counts: countExamples(rule.examples, progress),
      lastAt: latest(rule.examples.map((example) => progress[example.key]?.at)),
    })),
  }));
}

function lastNote(homework: Homework, progress: ProgressMap): CurrentState["lastNote"] {
  const notes = homeworkExamples(homework).flatMap((example) => {
    const entry = progress[example.key];
    if (entry?.note === undefined || exampleStatus(example, progress) !== "not-yet") return [];
    return [{ exampleKey: example.key, exampleName: example.name, note: entry.note, at: entry.at }];
  });
  return notes.sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
}

function currentState(world: World, course: Course, threads: readonly TutorThreadRecord[]): CurrentState | null {
  if (world.binding.status !== "bound" || world.pointer === null) return null;
  const homework = findHomework(course, world.pointer.homeworkId);
  if (homework === undefined) return null;
  const progress = progressMap(world, homework.id);
  const focus = progressFor(world.student, homework.id)?.focus ?? null;
  return {
    homeworkId: homework.id,
    iterationStatus: world.pointer.iterationStatus,
    focus,
    focusRuleName: focus === null ? null : (findRule(homework, focus)?.name ?? null),
    counts: countExamples(homeworkExamples(homework), progress),
    outline: outline(homework, progress, focus),
    coachThreadId: findMainThread(threads, course.id, homework.id)?.id ?? null,
    lastNote: lastNote(homework, progress),
  };
}

export function buildOverview(world: World, threads: readonly TutorThreadRecord[]): Overview {
  const course = world.course;
  const pointer = world.pointer;
  if (course === null || pointer === null) {
    return { course: null, courseError: world.courseError, binding: world.binding, homeworks: [], current: null, threads: [] };
  }
  const courseThreads =
    world.binding.status === "bound" ? threads.filter((thread) => thread.courseId === course.id) : [];
  return {
    course: { id: course.id, title: course.title, description: course.description },
    courseError: null,
    binding: world.binding,
    homeworks: course.homeworks.map((homework) => ({
      id: homework.id,
      title: homework.title,
      set: homework.set,
      builtin: homework.builtin,
      status: homeworkStatus(course, pointer, homework.id),
      counts: countExamples(homeworkExamples(homework), progressMap(world, homework.id)),
    })),
    current: currentState(world, course, courseThreads),
    threads: courseThreads.map(publicThread),
  };
}

export function buildLesson(world: World, homeworkId: string, threads: readonly TutorThreadRecord[]): Lesson {
  const course = requireCourse(world);
  const homework = requireHomework(course, homeworkId);
  const pointer = world.pointer;
  const isCurrent = pointer?.homeworkId === homework.id;
  const status = pointer === null ? "ahead" : homeworkStatus(course, pointer, homework.id);
  const current = progressFor(world.student, homework.id);
  return {
    homework,
    status,
    iterationStatus: isCurrent && pointer !== null ? pointer.iterationStatus : null,
    focus: current?.focus ?? null,
    progress: status === "ahead" ? {} : progressMap(world, homework.id),
    coachThreadId: findMainThread(threads, course.id, homework.id)?.id ?? null,
  };
}

export function buildCompletion(world: World, homeworkId: string, threads: readonly TutorThreadRecord[]): Completion {
  const course = requireCourse(world);
  const homework = requireHomework(course, homeworkId);
  if (world.pointer === null || homeworkStatus(course, world.pointer, homework.id) !== "done") {
    throw new Error(`Homework ${homework.id} is not complete yet.`);
  }
  const progress = recordedProgress(world.student, homework.id);
  const passingHashes = new Set(
    Object.values(world.student.progress?.examples ?? {})
      .filter((entry) => entry.status === "passing")
      .map((entry) => entry.hash),
  );
  const next = nextHomework(course, homework.id);
  const nextExamples = next === undefined ? [] : homeworkExamples(next);
  return {
    homework: { id: homework.id, title: homework.title, set: homework.set },
    counts: countExamples(homeworkExamples(homework), progress?.examples ?? {}),
    freshRules: homework.features.flatMap((feature) => feature.rules).filter((rule) => rule.novelty !== "unchanged").length,
    sideThreads: threads.filter(
      (thread) => thread.courseId === course.id && thread.homeworkId === homework.id && thread.role === "side",
    ).length,
    adoptedAt: progress?.adopted ?? null,
    summary: progress?.summary ?? null,
    next:
      next === undefined
        ? null
        : {
            id: next.id,
            status: homeworkStatus(course, world.pointer, next.id),
            title: next.title,
            set: next.set,
            dek: next.dek,
            rules: next.features.reduce((sum, feature) => sum + feature.rules.length, 0),
            examples: nextExamples.length,
            carryOver: nextExamples.filter((example) => passingHashes.has(example.hash)).length,
            fresh: nextExamples.filter((example) => example.novelty !== "unchanged").length,
            factoryDiff: next.factoryDiff,
          },
  };
}
