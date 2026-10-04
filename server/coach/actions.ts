// What each coach tool does, as pure functions over the re-derived world.
// They return the text for the coach and the files to write; tools.ts checks
// the caller and performs the writes.
import { relative } from "node:path";
import { STARTER_LAYOUT, WORKSPACE_UNREACHABLE_TEXT } from "../../shared/constants.ts";
import {
  countExamples,
  findExample,
  findLesson,
  findRule,
  lessonExamples,
  nextLesson,
  ruleStatus,
  type CurrentPointer,
  type ProgressMap,
} from "../../shared/derive.ts";
import { formatProgressCard, type ProgressCard } from "../../shared/directives.ts";
import { ruleKeyOfExample } from "../../shared/keys.ts";
import type { Course, ExampleProgress, Lesson, IterationState, ProgressFile, Rule, StudentState } from "../../shared/model.ts";
import type { ToolParameters } from "../../shared/tools.ts";
import { carryOver } from "../../layouts/progress/carry-over.ts";
import { progressFor } from "../progress/current.ts";
import { needsFactoryMove } from "../../layouts/capstone-factory/factory-move.ts";
import { notReadyText, type CourseLayoutState } from "../../layouts/state.ts";
import type { CoachMethod } from "./coach-file.ts";
import { findCourse, methodCourse, type World } from "./world.ts";

const LATE_FACTORY = STARTER_LAYOUT.lateFactory;

export interface CoachState {
  course: Course;
  /** The coaching method (coach-file.ts). */
  coach: CoachMethod;
  projectId: string;
  /** The BB project's folder, where coach threads work: the student's repo, or (legacy) the factory itself. */
  root: string;
  /** The course's layout in it: the tools write progress to layout.progress, and a capstone lesson's spec into its factory. */
  layout: CourseLayoutState;
  hostId: string;
  lesson: Lesson;
  pointer: CurrentPointer;
  student: StudentState;
  /** The student's progress on the current lesson, or null. */
  progress: ProgressFile | null;
}

export type Outcome =
  | { error: string }
  | {
      text: string;
      progress?: ProgressFile;
      iteration?: IterationState;
      adopt?: Lesson;
      /** A Rule the coach thread has now reached: its section starts in the coach's next message. */
      reached?: string;
    };

/** The coach's view of one course: the caller's, from its coach thread's metadata (Lesson 0's is the built-in course). */
export function coachStateOf(world: World, courseId: string): CoachState | { error: string } {
  if (world.workspace.status === "unreachable") return { error: WORKSPACE_UNREACHABLE_TEXT };
  if (world.workspace.status !== "found" || world.hostId === null) {
    return { error: "No workspace is set up yet. The student confirms it on the Course page." };
  }
  const loaded = findCourse(world, courseId);
  if (loaded === undefined) {
    const why = world.courseErrors.map((entry) => entry.error).join(" ");
    return { error: `The course "${courseId}" isn't loaded${why === "" ? "" : `: ${why}`}` };
  }
  const { course, pointer, student } = loaded;
  const lesson = findLesson(course, pointer.lessonId);
  if (lesson === undefined) return { error: `Lesson ${pointer.lessonId} is not in this course.` };
  return {
    course,
    coach: methodCourse(world.courses, loaded).coach,
    projectId: world.workspace.projectId,
    root: world.workspace.root,
    layout: loaded.layout,
    hostId: world.hostId,
    lesson,
    pointer,
    student,
    progress: progressFor(student, lesson.id),
  };
}

/**
 * Why the tools that change progress refuse the current lesson: it is one of
 * the course's own and the course's layout isn't ready. Lesson 0 works in any
 * workspace, and tutor_status always answers, problems and all. Null when
 * nothing stands in the way.
 */
export function layoutError(state: CoachState): string | null {
  return !state.lesson.builtin && !state.layout.ready ? notReadyText(state.layout) : null;
}

/**
 * No progress is recorded for the current lesson: its progress file is
 * missing or about another lesson. A file that could not be read or parsed is
 * not "none": its marks are unknown, and adopting again would overwrite them.
 */
export function unrecorded(state: CoachState): boolean {
  return state.progress === null && state.student.progressUnreadable !== true;
}

/**
 * The progress file's path, relative to the workspace, for this course's
 * layout: `.tutor/progress.yaml` for Lesson 0, `.tutor/courses/<id>/progress.yaml`
 * for a layoutless course, and `spec/PROGRESS.yaml`, unchanged, for the
 * capstone-factory layout.
 */
export function progressFileText(state: Pick<CoachState, "root" | "layout">): string {
  if (state.layout.id === "capstone-factory") return state.layout.progress.progressFile;
  return `${relative(state.root, state.layout.progress.dir)}/${state.layout.progress.progressFile}`;
}

/** Why nothing can change the lesson's progress while its progress file is damaged. */
export function unreadableProgressText(progressPath: string, lessonId: string): string {
  return (
    `${progressPath} could not be read, so Lesson ${lessonId}'s marks are unknown. ` +
    "Help the student repair it (tutor_status names the problem; git may have a good copy). " +
    "Don't adopt the lesson again: that would replace the file and lose its marks."
  );
}

/** The lesson a calling thread coaches: its coach thread's, which its side chats inherit (auth.ts). */
export interface CallerLesson {
  courseId: string;
  lessonId: string;
}

/**
 * Why a thread may not change the student's progress: it coaches another
 * lesson than the one the student is on, as an old coach thread left open
 * does. Null when it coaches the current lesson.
 */
export function otherLessonError(state: CoachState, caller: CallerLesson): string | null {
  const current = state.lesson.id;
  if (caller.courseId !== state.course.id) {
    return `This coach thread is for another course, but the student is on Lesson ${current} of "${state.course.title}". Open Lesson ${current}'s coach from the course outline.`;
  }
  if (caller.lessonId === current) return null;
  if (adoptionTargets(state.course, state.pointer, unrecorded(state)).includes(caller.lessonId)) {
    return `This coach thread is for Lesson ${caller.lessonId}, which hasn't been adopted yet: the student is still on Lesson ${current}. Call tutor_adopt_iteration with iteration "${caller.lessonId}" first.`;
  }
  return `This coach thread is for Lesson ${caller.lessonId}, but the student is on Lesson ${current}. Open Lesson ${current}'s coach from the course outline.`;
}

/**
 * A coach thread adopts its own lesson: Tutor spawns each lesson's coach to
 * adopt it (coachThreadPrompt "adopt"), so an older coach never adopts the
 * next lesson in its own thread.
 */
export function adoptionByOtherError(state: CoachState, input: ToolParameters<"tutor_adopt_iteration">, caller: CallerLesson): string | null {
  if (caller.courseId !== state.course.id) return otherLessonError(state, caller);
  if (input.iteration === caller.lessonId) return null;
  return (
    `This coach thread is for Lesson ${caller.lessonId}, so it can only adopt Lesson ${caller.lessonId}. ` +
    `Lesson ${input.iteration} is adopted by its own coach thread: tell the student to start it from the course outline.`
  );
}

function card(fields: Partial<ProgressCard> & Pick<ProgressCard, "kind" | "title">): string {
  return formatProgressCard({
    passed: null,
    total: null,
    next: null,
    note: null,
    lessonId: null,
    ruleKey: null,
    exampleKey: null,
    ...fields,
  });
}

function echo(line: string): string {
  return `Echo this card in your reply, on a line of its own:\n${line}`;
}

/** The focus card opens the Rule's section, so it leads the message that turns to the Rule. */
function sectionHeader(line: string): string {
  return [
    "When you turn to this Rule, start your next message with this line, exactly as written and on a line of its own.",
    "Tutor draws it as the Rule card, where the Rule's section of this conversation starts; the course outline jumps there.",
    line,
  ].join("\n");
}

/** The progress to change, refusing when the lesson is not under way. */
function underWay(state: CoachState): ProgressFile | { error: string } {
  const { lesson, pointer } = state;
  if (state.progress === null && state.student.progressUnreadable === true) return { error: unreadableProgressText(progressFileText(state), lesson.id) };
  if (pointer.iterationStatus === "not-started" || state.progress === null) {
    return { error: `Lesson ${lesson.id} has not been adopted yet. Call tutor_adopt_iteration first.` };
  }
  if (pointer.iterationStatus === "Done" && !lesson.builtin) {
    return { error: `Lesson ${lesson.id} is already complete. Adopt the next one with tutor_adopt_iteration.` };
  }
  return state.progress;
}

/** The first Rule in the suggested order that does not hold yet, other than `except`. */
function suggestedNextRule(lesson: Lesson, progress: ProgressMap, except: string | null): Rule | undefined {
  for (const key of lesson.suggestedRuleOrder) {
    const rule = findRule(lesson, key);
    if (rule !== undefined && key !== except && ruleStatus(rule, progress) !== "passing") return rule;
  }
  return undefined;
}

export function focusAction(state: CoachState, input: ToolParameters<"tutor_focus_rule">, isCoachThread: boolean): Outcome {
  if (!isCoachThread) {
    return { error: "Only the coach thread moves the focus. Suggest the Rule to the student instead." };
  }
  const progress = underWay(state);
  if ("error" in progress) return progress;
  const rule = findRule(state.lesson, input.rule);
  if (rule === undefined) {
    return { error: `There is no Rule ${input.rule} in lesson ${state.lesson.id}. Call tutor_status for the keys.` };
  }
  const counts = countExamples(rule.examples, progress.examples);
  const line = card({
    kind: "focus",
    title: rule.name,
    passed: counts.passing,
    total: counts.total,
    lessonId: state.lesson.id,
    ruleKey: rule.key,
  });
  return {
    text: `The focus is on ${rule.key}.\n${sectionHeader(line)}`,
    progress: { ...progress, focus: rule.key },
    reached: rule.key,
  };
}

export function markAction(state: CoachState, input: ToolParameters<"tutor_mark_example">, now: string): Outcome {
  const progress = underWay(state);
  if ("error" in progress) return progress;
  const { lesson } = state;
  const example = findExample(lesson, input.example);
  const rule = findRule(lesson, ruleKeyOfExample(input.example) ?? "");
  if (example === undefined || rule === undefined) {
    return { error: `There is no Example ${input.example} in lesson ${lesson.id}. Call tutor_status for the keys.` };
  }
  const entry: ExampleProgress = { status: input.status, hash: example.hash, at: now };
  if (input.note !== undefined) entry.note = input.note;
  if (input.evidence !== undefined) entry.evidence = input.evidence;
  const examples = { ...progress.examples, [example.key]: entry };

  const wasPassing = ruleStatus(rule, progress.examples) === "passing";
  const nowPassing = ruleStatus(rule, examples) === "passing";
  const totals = countExamples(lessonExamples(lesson), examples);
  const common = { passed: totals.passing, total: totals.total, lessonId: lesson.id, ruleKey: rule.key };
  let line: string;
  let hint = "";
  if (nowPassing && !wasPassing) {
    const next = suggestedNextRule(lesson, examples, rule.key);
    line = card({ kind: "rule-passing", title: rule.name, next: next?.name ?? null, ...common });
    hint = next === undefined
      ? "\nEvery Rule holds now. When the student is ready, finish with tutor_complete_iteration."
      : `\nSuggested next Rule: ${next.key}. Move the focus with tutor_focus_rule when you get there.`;
  } else if (input.status === "not-yet") {
    line = card({ kind: "not-yet", title: example.name, note: input.note ?? null, exampleKey: example.key, ...common });
  } else if (input.status === "passing") {
    line = card({ kind: "example-passing", title: example.name, exampleKey: example.key, ...common });
  } else {
    return { text: `Marked ${example.key} as ${input.status}.`, progress: { ...progress, examples } };
  }
  return { text: `Marked ${example.key} as ${input.status}.\n${echo(line)}${hint}`, progress: { ...progress, examples } };
}

/**
 * The lessons of this course tutor_adopt_iteration accepts now: its first
 * lesson while nothing is adopted (Lesson 0 in the built-in course), and the
 * lesson after a Done one. `unrecorded`: there is no progress for the current
 * lesson. A WIP lesson without any was set going outside Tutor, as
 * fetch-iteration does, and its own coach adopts it again; otherwise nothing
 * could start its spec/PROGRESS.yaml. Each course starts from its own
 * progress: nothing carries over from another course.
 */
export function adoptionTargets(course: Course, pointer: CurrentPointer, unrecorded = false): string[] {
  if (pointer.iterationStatus === "not-started") return findLesson(course, pointer.lessonId) === undefined ? [] : [pointer.lessonId];
  if (pointer.iterationStatus !== "Done") return pointer.iterationStatus === "WIP" && unrecorded ? [pointer.lessonId] : [];
  const next = nextLesson(course, pointer.lessonId);
  return next === undefined ? [] : [next.id];
}

export function adoptAction(state: CoachState, input: ToolParameters<"tutor_adopt_iteration">, now: string): Outcome {
  const targets = adoptionTargets(state.course, state.pointer, unrecorded(state));
  const lesson = findLesson(state.course, input.iteration);
  if (lesson === undefined || !targets.includes(input.iteration)) {
    const current = `The student is on lesson ${state.pointer.lessonId} (${state.pointer.iterationStatus}).`;
    const allowed = targets.length === 0 ? "Nothing can be adopted now." : `You can adopt: ${targets.join(", ")}.`;
    const damaged = state.student.progressUnreadable === true ? ` ${unreadableProgressText(progressFileText(state), state.pointer.lessonId)}` : "";
    return { error: `Lesson ${input.iteration} cannot be adopted now. ${current} ${allowed}${damaged}` };
  }
  const { layout: course } = state;
  if (!lesson.builtin && !course.ready) return { error: notReadyText(course) };
  if (course.blocked !== null) return { error: `Lesson ${input.iteration} cannot be adopted: ${course.blocked}` };
  const progress = carryOver(state.student.progress, lesson, now);
  const carried = Object.keys(progress.examples).length;
  const total = lessonExamples(lesson).length;
  const summary = `Adopted lesson ${lesson.id} "${lesson.title}": ${total} examples, ${carried} carried over as passing.`;
  if (lesson.builtin) {
    const dir = `${relative(state.root, course.progress.dir)}/`;
    return { text: `${summary}\nThis lesson lives in Tutor only: nothing was copied into ${dir}.`, progress };
  }
  const iteration = { iteration: lesson.id, status: "WIP" as const };
  if (course.id === null) {
    return { text: `${summary} Its spec is in the course; nothing was copied into your workspace.`, progress, iteration };
  }
  const { layout } = course;
  const adopted = { progress, iteration, adopt: lesson };
  if (layout.mode === "legacy") {
    return {
      text: [
        summary,
        "spec/ now holds its README.md, FACTORY.md and features/, and ../seeds/ its sample seed unless one was there already.",
        `stand-ins/ is refreshed from the course, and ITERATION reads "${lesson.id} WIP".`,
        `Commit spec/, ../seeds/ and ITERATION with the message "Adopt spec for iteration ${lesson.id}", then follow the coaching method:`,
        "show the student `git show --stat HEAD` and the diff of spec/FACTORY.md.",
      ].join("\n"),
      ...adopted,
    };
  }
  // A starter clone: paths from the repo's top folder, where the coach thread works.
  const move = needsFactoryMove(layout, lesson);
  const factory = move ? LATE_FACTORY : layout.factoryShown;
  const seeds = layout.seedsShown;
  const lines = [summary];
  if (move) {
    lines.push(
      `Lesson ${lesson.id} gives the factory a codebase of its own, so Tutor moved it as the starter's fetch.sh does: ` +
        `git mv ${layout.factoryShown} ${LATE_FACTORY}, with ${LATE_FACTORY}/.claude/skills linked to the repo's .agents/skills again, ` +
        `so the factory now lives in ${LATE_FACTORY}/: cd there to work on it from now on, and follow its AGENTS.md.`,
    );
  }
  lines.push(
    `${factory}/spec/ now holds its README.md, FACTORY.md and features/, and ${seeds}/ its sample seed unless one was there already.`,
    `${factory}/stand-ins/ is refreshed from the course, and ${factory}/ITERATION reads "${lesson.id} WIP".`,
    move
      ? `Commit ${factory}/, ${seeds}/ and the old ${layout.factoryShown} (git add -A ${factory} ${seeds} ${layout.factoryShown}) with the message "Adopt spec for iteration ${lesson.id}", then follow the coaching method:`
      : `Commit ${factory}/ and ${seeds}/ with the message "Adopt spec for iteration ${lesson.id}", then follow the coaching method:`,
    `show the student \`git show --stat HEAD\` and the diff of ${factory}/spec/FACTORY.md.`,
  );
  return { text: lines.join("\n"), ...adopted };
}

export function completeAction(state: CoachState, input: ToolParameters<"tutor_complete_iteration">): Outcome {
  const { lesson, pointer } = state;
  if (input.iteration !== lesson.id) {
    return { error: `The student is on lesson ${lesson.id}, not ${input.iteration}.` };
  }
  const progress = state.progress;
  if (progress === null || pointer.iterationStatus === "not-started") {
    return { error: `Lesson ${lesson.id} has not been adopted yet.` };
  }
  const counts = countExamples(lessonExamples(lesson), progress.examples);
  const open = counts.total - counts.passing - counts.skipped;
  if (lesson.builtin && open > 0) {
    return { error: `Lesson 0 is done once every Example is passing or skipped; ${open} are not yet.` };
  }
  if (!lesson.builtin && pointer.iterationStatus === "Done") {
    return { error: `Lesson ${lesson.id} is already complete.` };
  }
  const line = card({
    kind: "lesson-complete",
    title: lesson.title,
    passed: counts.passing,
    total: counts.total,
    lessonId: lesson.id,
  });
  const caveat = open > 0 ? `\nNote: ${open} examples are not marked passing or skipped.` : "";
  const commit = lesson.builtin ? "" : `\nCommit the implementation, ITERATION and ${progressFileText(state)} with the message "Implement homework ${lesson.id}".`;
  const outcome: Outcome = {
    text: `Lesson ${lesson.id} is complete.${caveat}${commit}\n${echo(line)}`,
    progress: { ...progress, summary: input.summary },
  };
  if (!lesson.builtin) outcome.iteration = { iteration: lesson.id, status: "Done" };
  return outcome;
}
