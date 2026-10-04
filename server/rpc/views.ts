// Pure builders for the read-side RPC payloads, from the re-derived world and
// the Tutor threads in the workspace project: one entry per course, Tutor's
// built-in course first.
import {
  countExamples,
  exampleStatus,
  findLesson,
  findRule,
  lessonExamples,
  lessonStatus,
  nextLesson,
  resolveCurrent,
  ruleStatus,
  type CurrentPointer,
  type ProgressMap,
} from "../../shared/derive.ts";
import { BUILTIN_COURSE_ID } from "../../shared/constants.ts";
import type { Course, Lesson, StudentState } from "../../shared/model.ts";
import type { CoachAgentState, Completion, CourseOverview, CurrentState, FeatureOutline, LessonDetail, Overview, TutorThread } from "../../shared/rpc.ts";
import { progressFor, recordedProgress } from "../progress/current.ts";
import { adoptionTargets } from "../coach/actions.ts";
import { findCoachThread, type TutorThreadRecord } from "../coach/threads.ts";
import type { TurnFailures } from "../coach/turn-failures.ts";
import { findCourse, type LoadedCourse, type World } from "../coach/world.ts";

export function publicThread(record: TutorThreadRecord): TutorThread {
  return {
    id: record.id,
    courseId: record.courseId,
    lessonId: record.lessonId,
    role: record.role,
    ruleKey: record.ruleKey,
    title: record.title,
    coachThreadId: record.coachThreadId,
    fork: record.fork,
  };
}

/**
 * One course as the pages show it: as the workspace has it, or, before there
 * is a workspace, a preview with nothing recorded (a course with a layout
 * isn't ready then: there is nowhere to find it).
 */
export interface CourseView {
  course: Course;
  student: StudentState;
  pointer: CurrentPointer;
  ready: boolean;
}

const NOTHING_RECORDED: StudentState = { iteration: null, progress: null, problems: [] };

/** Every course to show, built-in first. */
export function courseViews(world: World): CourseView[] {
  if (world.workspace.status === "found") {
    return world.courses.map(({ course, student, pointer, layout }) => ({ course, student, pointer, ready: layout.ready }));
  }
  return world.allCourses.map((course) => ({
    course,
    student: NOTHING_RECORDED,
    pointer: resolveCurrent(course, NOTHING_RECORDED),
    ready: course.layout === null,
  }));
}

function noCourse(world: World, courseId: string): Error {
  const why = world.courseErrors.map((entry) => entry.error).join(" ");
  return new Error(why === "" ? `There is no course "${courseId}".` : `The course "${courseId}" could not be loaded: ${why}`);
}

/** The course to show, workspace or not. */
export function requireCourseView(world: World, courseId: string): CourseView {
  const view = courseViews(world).find((entry) => entry.course.id === courseId);
  if (view === undefined) throw noCourse(world, courseId);
  return view;
}

/** The course as the workspace has it; call once the workspace is known to be there. */
export function requireCourse(world: World, courseId: string): LoadedCourse {
  const loaded = findCourse(world, courseId);
  if (loaded === undefined) throw noCourse(world, courseId);
  return loaded;
}

export function requireLesson(course: Course, lessonId: string): Lesson {
  const lesson = findLesson(course, lessonId);
  if (lesson === undefined) throw new Error(`There is no lesson ${lessonId} in "${course.title}".`);
  return lesson;
}

/** Progress entries recorded for `lesson`, current or from the history, else none. */
function progressMap(student: StudentState, lessonId: string): ProgressMap {
  return recordedProgress(student, lessonId)?.examples ?? {};
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
    change: feature.change,
    counts: countExamples(feature.rules.flatMap((rule) => rule.examples), progress),
    rules: feature.rules.map((rule) => ({
      key: rule.key,
      name: rule.name,
      change: rule.change,
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
function lessonOutline(student: StudentState, lesson: Lesson, coachThread: TutorThreadRecord | undefined): FeatureOutline[] {
  const focus = progressFor(student, lesson.id)?.focus ?? null;
  return outline(lesson, progressMap(student, lesson.id), focus, new Set(coachThread?.reachedRules ?? []));
}

function currentState(view: CourseView, threads: readonly TutorThreadRecord[]): CurrentState | null {
  const { course, student, pointer } = view;
  const lesson = findLesson(course, pointer.lessonId);
  if (lesson === undefined) return null;
  const progress = progressMap(student, lesson.id);
  const focus = progressFor(student, lesson.id)?.focus ?? null;
  const coachThread = findCoachThread(threads, course.id, lesson.id);
  return {
    lessonId: lesson.id,
    iterationStatus: pointer.iterationStatus,
    focus,
    focusRuleName: focus === null ? null : (findRule(lesson, focus)?.name ?? null),
    counts: countExamples(lessonExamples(lesson), progress),
    outline: lessonOutline(student, lesson, coachThread),
    coachThreadId: coachThread?.id ?? null,
    lastNote: lastNote(lesson, progress),
  };
}

function courseOverview(view: CourseView, workspaceFound: boolean, threads: readonly TutorThreadRecord[], turnFailures: TurnFailures): CourseOverview {
  const { course, student, pointer, ready } = view;
  const starts = adoptionTargets(course, pointer);
  return {
    course: { id: course.id, title: course.title, description: course.description },
    builtin: course.id === BUILTIN_COURSE_ID,
    layout: { id: course.layout, ready },
    lessons: course.lessons.map((lesson) => {
      const coachThread = findCoachThread(threads, course.id, lesson.id);
      return {
        id: lesson.id,
        title: lesson.title,
        set: lesson.set,
        builtin: lesson.builtin,
        status: lessonStatus(course, pointer, lesson.id),
        counts: countExamples(lessonExamples(lesson), progressMap(student, lesson.id)),
        coachThreadId: coachThread?.id ?? null,
        coachFailure: coachThread === undefined ? null : turnFailures.get(coachThread.id),
        outline: lessonOutline(student, lesson, coachThread),
        needsLayout: !lesson.builtin && !ready,
        // As startNextLesson allows it.
        canStart: !lesson.builtin && starts.includes(lesson.id),
      };
    }),
    current: workspaceFound ? currentState(view, threads) : null,
  };
}

export function buildOverview(
  world: World,
  threads: readonly TutorThreadRecord[],
  coachAgent: CoachAgentState | null = null,
  turnFailures: TurnFailures = { record: () => undefined, clear: () => undefined, get: () => null },
): Overview {
  const found = world.workspace.status === "found";
  const views = courseViews(world);
  const ids = new Set(views.map((view) => view.course.id));
  // Threads of the courses shown (Lesson 0's whatever course they name: threadCourse).
  const shown = found ? threads.filter((thread) => ids.has(thread.courseId)) : [];
  return {
    workspace: world.workspace,
    courses: views.map((view) => courseOverview(view, found, shown, turnFailures)),
    available: world.fetchable,
    courseErrors: world.courseErrors,
    threads: shown.map(publicThread),
    coachAgent,
  };
}

export function buildLessonDetail(world: World, courseId: string, lessonId: string, threads: readonly TutorThreadRecord[]): LessonDetail {
  const { course, student, pointer } = requireCourseView(world, courseId);
  const lesson = requireLesson(course, lessonId);
  const isCurrent = pointer.lessonId === lesson.id;
  const status = lessonStatus(course, pointer, lesson.id);
  const current = progressFor(student, lesson.id);
  const coachThread = findCoachThread(threads, course.id, lesson.id);
  return {
    lesson,
    status,
    iterationStatus: isCurrent ? pointer.iterationStatus : null,
    focus: current?.focus ?? null,
    progress: status === "ahead" ? {} : progressMap(student, lesson.id),
    coachThreadId: coachThread?.id ?? null,
    reachedRules: coachThread?.reachedRules ?? [],
  };
}

/**
 * The lesson after `lesson`: the next in its course, or, after the built-in
 * course's Lesson 0, the first lesson of the course that follows it.
 */
function nextAfter(world: World, view: CourseView, lesson: Lesson): { view: CourseView; lesson: Lesson } | null {
  const next = nextLesson(view.course, lesson.id);
  if (next !== undefined) return { view, lesson: next };
  if (view.course.id !== BUILTIN_COURSE_ID) return null;
  const following = courseViews(world).find((entry) => entry.course.id !== BUILTIN_COURSE_ID && entry.course.lessons.length > 0);
  const first = following?.course.lessons[0];
  return following === undefined || first === undefined ? null : { view: following, lesson: first };
}

/** `bbSideChats`: side chats of the lesson's coach thread that BB made, which are not Tutor's threads. */
export function buildCompletion(
  world: World,
  courseId: string,
  lessonId: string,
  threads: readonly TutorThreadRecord[],
  bbSideChats = 0,
): Completion {
  const view = requireCourseView(world, courseId);
  const { course, student, pointer } = view;
  const lesson = requireLesson(course, lessonId);
  if (world.workspace.status !== "found" || lessonStatus(course, pointer, lesson.id) !== "done") {
    throw new Error(`Lesson ${lesson.id} is not complete yet.`);
  }
  const progress = recordedProgress(student, lesson.id);
  // Carry-over into the next lesson comes from what passed in this one (its history entry once it is past).
  const passingHashes = new Set(
    Object.values(progress?.examples ?? {})
      .filter((entry) => entry.status === "passing")
      .map((entry) => entry.hash),
  );
  const after = nextAfter(world, view, lesson);
  const next = after?.lesson;
  // Nothing carries over from one course into another.
  const nextExamples = next === undefined ? [] : lessonExamples(next);
  const carries = after?.view === view;
  return {
    lesson: { id: lesson.id, title: lesson.title, set: lesson.set },
    counts: countExamples(lessonExamples(lesson), progress?.examples ?? {}),
    freshRules: lesson.features.flatMap((feature) => feature.rules).filter((rule) => rule.change !== "unchanged").length,
    sideChats:
      threads.filter((thread) => thread.courseId === course.id && thread.lessonId === lesson.id && thread.role === "sideChat").length +
      bbSideChats,
    adoptedAt: progress?.adopted ?? null,
    summary: progress?.summary ?? null,
    next:
      after === null || next === undefined
        ? null
        : {
            courseId: after.view.course.id,
            id: next.id,
            status: lessonStatus(after.view.course, after.view.pointer, next.id),
            title: next.title,
            set: next.set,
            dek: next.dek,
            rules: next.features.reduce((sum, feature) => sum + feature.rules.length, 0),
            examples: nextExamples.length,
            carryOver: carries ? nextExamples.filter((example) => passingHashes.has(example.hash)).length : 0,
            fresh: nextExamples.filter((example) => example.change !== "unchanged").length,
            factoryDiff: carries ? next.factoryDiff : null,
          },
  };
}
