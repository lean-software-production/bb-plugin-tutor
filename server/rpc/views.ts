// Pure builders for the read-side RPC payloads, from the re-derived world and
// the Tutor threads in the factory project.
import {
  countExamples,
  exampleStatus,
  findLesson,
  findRule,
  lessonExamples,
  lessonStatus,
  nextLesson,
  ruleStatus,
  type ProgressMap,
} from "../../shared/derive.ts";
import type { Course, Lesson } from "../../shared/model.ts";
import type { Completion, CurrentState, FeatureOutline, LessonDetail, Overview, TutorThread } from "../../shared/rpc.ts";
import { progressFor, recordedProgress } from "../progress/current.ts";
import { findCoachThread, type TutorThreadRecord } from "../coach/threads.ts";
import type { World } from "../coach/world.ts";

export function publicThread(record: TutorThreadRecord): TutorThread {
  return {
    id: record.id,
    lessonId: record.lessonId,
    role: record.role,
    ruleKey: record.ruleKey,
    title: record.title,
    coachThreadId: record.coachThreadId,
    fork: record.fork,
  };
}

export function requireCourse(world: World): Course {
  if (world.course === null) throw new Error(`The course could not be loaded: ${world.courseError ?? "unknown error"}`);
  return world.course;
}

export function requireLesson(course: Course, lessonId: string): Lesson {
  const lesson = findLesson(course, lessonId);
  if (lesson === undefined) throw new Error(`There is no lesson ${lessonId} in this course.`);
  return lesson;
}

/** Progress entries recorded for `lesson`, current or from the history, else none. */
function progressMap(world: World, lessonId: string): ProgressMap {
  return recordedProgress(world.student, lessonId)?.examples ?? {};
}

function latest(values: readonly (string | undefined)[]): string | null {
  return values.filter((value): value is string => value !== undefined).sort().at(-1) ?? null;
}

export function outline(
  lesson: Lesson,
  progress: ProgressMap,
  focus: string | null,
  reached: ReadonlySet<string> = new Set(),
): FeatureOutline[] {
  return lesson.features.map((feature) => ({
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

function lastNote(lesson: Lesson, progress: ProgressMap): CurrentState["lastNote"] {
  const notes = lessonExamples(lesson).flatMap((example) => {
    const entry = progress[example.key];
    if (entry?.note === undefined || exampleStatus(example, progress) !== "not-yet") return [];
    return [{ exampleKey: example.key, exampleName: example.name, note: entry.note, at: entry.at }];
  });
  return notes.sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
}

/** The lesson's features and Rules against what is recorded, with the Rules its coach thread has reached. */
function lessonOutline(world: World, lesson: Lesson, coachThread: TutorThreadRecord | undefined): FeatureOutline[] {
  const focus = progressFor(world.student, lesson.id)?.focus ?? null;
  return outline(lesson, progressMap(world, lesson.id), focus, new Set(coachThread?.reachedRules ?? []));
}

function currentState(world: World, course: Course, threads: readonly TutorThreadRecord[]): CurrentState | null {
  if (world.binding.status !== "bound" || world.pointer === null) return null;
  const lesson = findLesson(course, world.pointer.lessonId);
  if (lesson === undefined) return null;
  const progress = progressMap(world, lesson.id);
  const focus = progressFor(world.student, lesson.id)?.focus ?? null;
  const coachThread = findCoachThread(threads, course.id, lesson.id);
  return {
    lessonId: lesson.id,
    iterationStatus: world.pointer.iterationStatus,
    focus,
    focusRuleName: focus === null ? null : (findRule(lesson, focus)?.name ?? null),
    counts: countExamples(lessonExamples(lesson), progress),
    outline: lessonOutline(world, lesson, coachThread),
    coachThreadId: coachThread?.id ?? null,
    lastNote: lastNote(lesson, progress),
  };
}

export function buildOverview(world: World, threads: readonly TutorThreadRecord[]): Overview {
  const course = world.course;
  const pointer = world.pointer;
  if (course === null || pointer === null) {
    return { course: null, courseError: world.courseError, binding: world.binding, lessons: [], current: null, threads: [] };
  }
  const courseThreads =
    world.binding.status === "bound" ? threads.filter((thread) => thread.courseId === course.id) : [];
  return {
    course: { id: course.id, title: course.title, description: course.description },
    courseError: null,
    binding: world.binding,
    lessons: course.lessons.map((lesson) => {
      const coachThread = findCoachThread(courseThreads, course.id, lesson.id);
      return {
        id: lesson.id,
        title: lesson.title,
        set: lesson.set,
        builtin: lesson.builtin,
        status: lessonStatus(course, pointer, lesson.id),
        counts: countExamples(lessonExamples(lesson), progressMap(world, lesson.id)),
        coachThreadId: coachThread?.id ?? null,
        outline: lessonOutline(world, lesson, coachThread),
      };
    }),
    current: currentState(world, course, courseThreads),
    threads: courseThreads.map(publicThread),
  };
}

export function buildLessonDetail(world: World, lessonId: string, threads: readonly TutorThreadRecord[]): LessonDetail {
  const course = requireCourse(world);
  const lesson = requireLesson(course, lessonId);
  const pointer = world.pointer;
  const isCurrent = pointer?.lessonId === lesson.id;
  const status = pointer === null ? "ahead" : lessonStatus(course, pointer, lesson.id);
  const current = progressFor(world.student, lesson.id);
  const coachThread = findCoachThread(threads, course.id, lesson.id);
  return {
    lesson,
    status,
    iterationStatus: isCurrent && pointer !== null ? pointer.iterationStatus : null,
    focus: current?.focus ?? null,
    progress: status === "ahead" ? {} : progressMap(world, lesson.id),
    coachThreadId: coachThread?.id ?? null,
    reachedRules: coachThread?.reachedRules ?? [],
  };
}

/** `bbSideChats`: side chats of the lesson's coach thread that BB made, which are not Tutor's threads. */
export function buildCompletion(
  world: World,
  lessonId: string,
  threads: readonly TutorThreadRecord[],
  bbSideChats = 0,
): Completion {
  const course = requireCourse(world);
  const lesson = requireLesson(course, lessonId);
  if (world.pointer === null || lessonStatus(course, world.pointer, lesson.id) !== "done") {
    throw new Error(`Lesson ${lesson.id} is not complete yet.`);
  }
  const progress = recordedProgress(world.student, lesson.id);
  // Carry-over into the next lesson comes from what passed in this one (its history entry once it is past).
  const passingHashes = new Set(
    Object.values(progress?.examples ?? {})
      .filter((entry) => entry.status === "passing")
      .map((entry) => entry.hash),
  );
  const next = nextLesson(course, lesson.id);
  const nextExamples = next === undefined ? [] : lessonExamples(next);
  return {
    lesson: { id: lesson.id, title: lesson.title, set: lesson.set },
    counts: countExamples(lessonExamples(lesson), progress?.examples ?? {}),
    freshRules: lesson.features.flatMap((feature) => feature.rules).filter((rule) => rule.novelty !== "unchanged").length,
    sideChats:
      threads.filter((thread) => thread.courseId === course.id && thread.lessonId === lesson.id && thread.role === "sideChat").length +
      bbSideChats,
    adoptedAt: progress?.adopted ?? null,
    summary: progress?.summary ?? null,
    next:
      next === undefined
        ? null
        : {
            id: next.id,
            status: lessonStatus(course, world.pointer, next.id),
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
