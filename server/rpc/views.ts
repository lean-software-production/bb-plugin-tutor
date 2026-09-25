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
  return {
    id: record.id,
    homeworkId: record.homeworkId,
    role: record.role,
    ruleKey: record.ruleKey,
    title: record.title,
    mainThreadId: record.mainThreadId,
  };
}

export function requireCourse(world: World): Course {
  if (world.course === null) throw new Error(`The course could not be loaded: ${world.courseError ?? "unknown error"}`);
  return world.course;
}

export function requireHomework(course: Course, homeworkId: string): Homework {
  const homework = findHomework(course, homeworkId);
  if (homework === undefined) throw new Error(`There is no lesson ${homeworkId} in this course.`);
  return homework;
}

/** Progress entries recorded for `homework`, current or from the history, else none. */
function progressMap(world: World, homeworkId: string): ProgressMap {
  return recordedProgress(world.student, homeworkId)?.examples ?? {};
}

function latest(values: readonly (string | undefined)[]): string | null {
  return values.filter((value): value is string => value !== undefined).sort().at(-1) ?? null;
}

export function outline(
  homework: Homework,
  progress: ProgressMap,
  focus: string | null,
  reached: ReadonlySet<string> = new Set(),
): FeatureOutline[] {
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
      reached: reached.has(rule.key),
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

/** The homework's features and Rules against what is recorded, with the Rules its coach thread has reached. */
function homeworkOutline(world: World, homework: Homework, main: TutorThreadRecord | undefined): FeatureOutline[] {
  const focus = progressFor(world.student, homework.id)?.focus ?? null;
  return outline(homework, progressMap(world, homework.id), focus, new Set(main?.reachedRules ?? []));
}

function currentState(world: World, course: Course, threads: readonly TutorThreadRecord[]): CurrentState | null {
  if (world.binding.status !== "bound" || world.pointer === null) return null;
  const homework = findHomework(course, world.pointer.homeworkId);
  if (homework === undefined) return null;
  const progress = progressMap(world, homework.id);
  const focus = progressFor(world.student, homework.id)?.focus ?? null;
  const main = findMainThread(threads, course.id, homework.id);
  return {
    homeworkId: homework.id,
    iterationStatus: world.pointer.iterationStatus,
    focus,
    focusRuleName: focus === null ? null : (findRule(homework, focus)?.name ?? null),
    counts: countExamples(homeworkExamples(homework), progress),
    outline: homeworkOutline(world, homework, main),
    coachThreadId: main?.id ?? null,
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
    homeworks: course.homeworks.map((homework) => {
      const main = findMainThread(courseThreads, course.id, homework.id);
      return {
        id: homework.id,
        title: homework.title,
        set: homework.set,
        builtin: homework.builtin,
        status: homeworkStatus(course, pointer, homework.id),
        counts: countExamples(homeworkExamples(homework), progressMap(world, homework.id)),
        coachThreadId: main?.id ?? null,
        outline: homeworkOutline(world, homework, main),
      };
    }),
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
  const main = findMainThread(threads, course.id, homework.id);
  return {
    homework,
    status,
    iterationStatus: isCurrent && pointer !== null ? pointer.iterationStatus : null,
    focus: current?.focus ?? null,
    progress: status === "ahead" ? {} : progressMap(world, homework.id),
    coachThreadId: main?.id ?? null,
    reachedRules: main?.reachedRules ?? [],
  };
}

/** `bbSideChats`: side chats of the homework's coach thread that BB made, which are not Tutor's threads. */
export function buildCompletion(
  world: World,
  homeworkId: string,
  threads: readonly TutorThreadRecord[],
  bbSideChats = 0,
): Completion {
  const course = requireCourse(world);
  const homework = requireHomework(course, homeworkId);
  if (world.pointer === null || homeworkStatus(course, world.pointer, homework.id) !== "done") {
    throw new Error(`Lesson ${homework.id} is not complete yet.`);
  }
  const progress = recordedProgress(world.student, homework.id);
  // Carry-over into the next homework comes from what passed in this one (its history entry once it is past).
  const passingHashes = new Set(
    Object.values(progress?.examples ?? {})
      .filter((entry) => entry.status === "passing")
      .map((entry) => entry.hash),
  );
  const next = nextHomework(course, homework.id);
  const nextExamples = next === undefined ? [] : homeworkExamples(next);
  return {
    homework: { id: homework.id, title: homework.title, set: homework.set },
    counts: countExamples(homeworkExamples(homework), progress?.examples ?? {}),
    freshRules: homework.features.flatMap((feature) => feature.rules).filter((rule) => rule.novelty !== "unchanged").length,
    sideThreads:
      threads.filter((thread) => thread.courseId === course.id && thread.homeworkId === homework.id && thread.role === "side").length +
      bbSideChats,
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
