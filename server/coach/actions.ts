// What each coach tool does, as pure functions over the re-derived world.
// They return the text for the coach and the files to write; tools.ts checks
// the caller and performs the writes.
import { BUILTIN_HOMEWORK_ID } from "../../shared/constants.ts";
import {
  countExamples,
  findExample,
  findHomework,
  findRule,
  homeworkExamples,
  nextHomework,
  ruleStatus,
  type CurrentPointer,
  type ProgressMap,
} from "../../shared/derive.ts";
import { formatProgressCard, type ProgressCard } from "../../shared/directives.ts";
import { ruleKeyOfExample } from "../../shared/keys.ts";
import type { Course, ExampleProgress, Homework, IterationState, ProgressFile, Rule, StudentState } from "../../shared/model.ts";
import type { ToolParameters } from "../../shared/tools.ts";
import { carryOver } from "../progress/carry-over.ts";
import { progressFor } from "../progress/current.ts";
import type { World } from "./world.ts";

export interface CoachState {
  course: Course;
  projectId: string;
  root: string;
  hostId: string;
  homework: Homework;
  pointer: CurrentPointer;
  student: StudentState;
  /** The student's progress on the current homework, or null. */
  progress: ProgressFile | null;
}

export type Outcome =
  | { error: string }
  | {
      text: string;
      progress?: ProgressFile;
      iteration?: IterationState;
      adopt?: Homework;
      /** A Rule the coach thread has now reached: its section starts in the coach's next message. */
      reached?: string;
    };

export function coachStateOf(world: World): CoachState | { error: string } {
  if (world.course === null || world.pointer === null) {
    return { error: `The course could not be loaded: ${world.courseError ?? "unknown error"}` };
  }
  if (world.binding.status !== "bound" || world.factoryHostId === null) {
    return { error: "No factory project is set up yet. The student confirms it on the Course page." };
  }
  const homework = findHomework(world.course, world.pointer.homeworkId);
  if (homework === undefined) return { error: `Lesson ${world.pointer.homeworkId} is not in this course.` };
  return {
    course: world.course,
    projectId: world.binding.projectId,
    root: world.binding.root,
    hostId: world.factoryHostId,
    homework,
    pointer: world.pointer,
    student: world.student,
    progress: progressFor(world.student, homework.id),
  };
}

function card(fields: Partial<ProgressCard> & Pick<ProgressCard, "kind" | "title">): string {
  return formatProgressCard({
    passed: null,
    total: null,
    next: null,
    note: null,
    homeworkId: null,
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
    "BB draws it as the Rule card, where the Rule's section of this conversation starts; the course outline jumps there.",
    line,
  ].join("\n");
}

/** The progress to change, refusing when the homework is not under way. */
function underWay(state: CoachState): ProgressFile | { error: string } {
  const { homework, pointer } = state;
  if (pointer.iterationStatus === "not-started" || state.progress === null) {
    return { error: `Lesson ${homework.id} has not been adopted yet. Call tutor_adopt_iteration first.` };
  }
  if (pointer.iterationStatus === "Done" && !homework.builtin) {
    return { error: `Lesson ${homework.id} is already complete. Adopt the next one with tutor_adopt_iteration.` };
  }
  return state.progress;
}

/** The first Rule in the suggested order that does not hold yet, other than `except`. */
function suggestedNextRule(homework: Homework, progress: ProgressMap, except: string | null): Rule | undefined {
  for (const key of homework.suggestedRuleOrder) {
    const rule = findRule(homework, key);
    if (rule !== undefined && key !== except && ruleStatus(rule, progress) !== "passing") return rule;
  }
  return undefined;
}

export function focusAction(state: CoachState, input: ToolParameters<"tutor_focus_rule">, isMain: boolean): Outcome {
  if (!isMain) {
    return { error: "Only the coach thread moves the focus. Suggest the Rule to the student instead." };
  }
  const progress = underWay(state);
  if ("error" in progress) return progress;
  const rule = findRule(state.homework, input.rule);
  if (rule === undefined) {
    return { error: `There is no Rule ${input.rule} in lesson ${state.homework.id}. Call tutor_status for the keys.` };
  }
  const counts = countExamples(rule.examples, progress.examples);
  const line = card({
    kind: "focus",
    title: rule.name,
    passed: counts.passing,
    total: counts.total,
    homeworkId: state.homework.id,
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
  const { homework } = state;
  const example = findExample(homework, input.example);
  const rule = findRule(homework, ruleKeyOfExample(input.example) ?? "");
  if (example === undefined || rule === undefined) {
    return { error: `There is no Example ${input.example} in lesson ${homework.id}. Call tutor_status for the keys.` };
  }
  const entry: ExampleProgress = { status: input.status, hash: example.hash, at: now };
  if (input.note !== undefined) entry.note = input.note;
  if (input.evidence !== undefined) entry.evidence = input.evidence;
  const examples = { ...progress.examples, [example.key]: entry };

  const wasPassing = ruleStatus(rule, progress.examples) === "passing";
  const nowPassing = ruleStatus(rule, examples) === "passing";
  const totals = countExamples(homeworkExamples(homework), examples);
  const common = { passed: totals.passing, total: totals.total, homeworkId: homework.id, ruleKey: rule.key };
  let line: string;
  let hint = "";
  if (nowPassing && !wasPassing) {
    const next = suggestedNextRule(homework, examples, rule.key);
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

/** The homeworks tutor_adopt_iteration accepts now. */
export function adoptionTargets(course: Course, pointer: CurrentPointer): string[] {
  const firstReal = course.homeworks.find((homework) => !homework.builtin)?.id;
  if (pointer.homeworkId === BUILTIN_HOMEWORK_ID) {
    const targets = firstReal === undefined ? [] : [firstReal];
    return pointer.iterationStatus === "not-started" ? [BUILTIN_HOMEWORK_ID, ...targets] : targets;
  }
  if (pointer.iterationStatus !== "Done") return [];
  const next = nextHomework(course, pointer.homeworkId);
  return next === undefined ? [] : [next.id];
}

export function adoptAction(state: CoachState, input: ToolParameters<"tutor_adopt_iteration">, now: string): Outcome {
  const targets = adoptionTargets(state.course, state.pointer);
  const homework = findHomework(state.course, input.iteration);
  if (homework === undefined || !targets.includes(input.iteration)) {
    const current = `The student is on lesson ${state.pointer.homeworkId} (${state.pointer.iterationStatus}).`;
    const allowed = targets.length === 0 ? "Nothing can be adopted now." : `You can adopt: ${targets.join(", ")}.`;
    return { error: `Lesson ${input.iteration} cannot be adopted now. ${current} ${allowed}` };
  }
  const progress = carryOver(state.student.progress, homework, now);
  const carried = Object.keys(progress.examples).length;
  const total = homeworkExamples(homework).length;
  const summary = `Adopted lesson ${homework.id} "${homework.title}": ${total} examples, ${carried} carried over as passing.`;
  if (homework.builtin) return { text: `${summary}\nThis lesson lives in Tutor only: nothing was copied into spec/.`, progress };
  return {
    text: [
      summary,
      `spec/ now holds its README.md, FACTORY.md and features/, and spec/ITERATION reads "${homework.id} WIP".`,
      `Commit with the message "Adopt spec for iteration ${homework.id}", then follow the coaching method:`,
      "show the student `git show --stat HEAD` and the diff of spec/FACTORY.md.",
    ].join("\n"),
    progress,
    iteration: { iteration: homework.id, status: "WIP" },
    adopt: homework,
  };
}

export function completeAction(state: CoachState, input: ToolParameters<"tutor_complete_iteration">): Outcome {
  const { homework, pointer } = state;
  if (input.iteration !== homework.id) {
    return { error: `The student is on lesson ${homework.id}, not ${input.iteration}.` };
  }
  const progress = state.progress;
  if (progress === null || pointer.iterationStatus === "not-started") {
    return { error: `Lesson ${homework.id} has not been adopted yet.` };
  }
  const counts = countExamples(homeworkExamples(homework), progress.examples);
  const open = counts.total - counts.passing - counts.skipped;
  if (homework.builtin && open > 0) {
    return { error: `Lesson 0 is done once every Example is passing or skipped; ${open} are not yet.` };
  }
  if (!homework.builtin && pointer.iterationStatus === "Done") {
    return { error: `Lesson ${homework.id} is already complete.` };
  }
  const line = card({
    kind: "homework-complete",
    title: homework.title,
    passed: counts.passing,
    total: counts.total,
    homeworkId: homework.id,
  });
  const caveat = open > 0 ? `\nNote: ${open} examples are not marked passing or skipped.` : "";
  const commit = homework.builtin ? "" : `\nCommit the implementation and spec/ with the message "Implement homework ${homework.id}".`;
  const outcome: Outcome = {
    text: `Lesson ${homework.id} is complete.${caveat}${commit}\n${echo(line)}`,
    progress: { ...progress, summary: input.summary },
  };
  if (!homework.builtin) outcome.iteration = { iteration: homework.id, status: "Done" };
  return outcome;
}
