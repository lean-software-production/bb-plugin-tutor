// tutor_status: a compact, bounded picture of the lesson the coach can act
// on. Keys are listed because every other tool takes them.
import { relative } from "node:path";
import { countExamples, exampleStatus, findRule, lessonExamples } from "../../shared/derive.ts";
import type { ExampleStatus } from "../../shared/model.ts";
import { progressFileText, unrecorded, unreadableProgressText, type CoachState } from "./actions.ts";

const MAX_CHARS = 6000;
const MAX_NOTE = 140;
const MAX_TERMS = 60;
const MAX_PROBLEMS = 3;
const TRUNCATED = "\n… (truncated; ask about one Rule at a time)";
const GLYPH: Record<ExampleStatus, string> = { passing: "✓", "not-yet": "!", pending: "○", skipped: "–" };

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Where the work is. A capstone: the factory, in a starter clone its folder in the repo (tetris/.factory, then factory/ from 004).
 * A course without a layout: the workspace, and the folder Tutor keeps the course's progress in.
 */
function factoryLine(state: CoachState): string {
  if (state.layout.id === null) {
    return `Workspace: ${state.root}. Tutor keeps this course's progress in ${relative(state.root, state.layout.progress.dir)}/.`;
  }
  const { layout } = state.layout;
  if (layout.mode === "legacy") return `Factory: ${state.root}.`;
  return `Factory: ${layout.factoryShown}/ (in ${state.root}). Work in it: cd ${layout.factoryShown} and follow its AGENTS.md.`;
}

/** The calling thread's lesson, and why it may not change progress when that isn't the current lesson. */
export interface StatusCaller {
  lessonId: string;
  otherLesson: string | null;
}

/** The coaching method, named for tutor_status: too long to repeat for the course's own (it's in the instructions already). */
function coachMethodText(coach: CoachState["coach"]): string {
  if (coach === null) return "(no coach file)";
  return coach.kind === "workspace" ? `the file ${coach.relativePath} in this workspace` : "in your instructions above";
}

export function statusText(state: CoachState, caller: StatusCaller | null = null): string {
  const { course, coach, lesson, pointer } = state;
  const progress = state.progress?.examples ?? {};
  const focus = state.progress?.focus ?? null;
  const counts = countExamples(lessonExamples(lesson), progress);
  const lines: string[] = [];
  if (caller !== null) {
    lines.push(`This thread coaches Lesson ${caller.lessonId}.`);
    if (caller.otherLesson !== null) {
      lines.push(`${caller.otherLesson} Until then the tools that change progress refuse here. Below is the lesson the student is on.`);
    }
  }
  lines.push(
    `Course: ${course.title}. Coaching method: ${coachMethodText(coach)}.`,
    factoryLine(state),
    `Lesson ${lesson.id} "${lesson.title}": ${pointer.iterationStatus}. ` +
      `${counts.passing}/${counts.total} passing, ${counts.notYet} not yet, ${counts.skipped} skipped, ${counts.pending} pending.`,
    `Focus: ${focus ?? "none"}.`,
  );
  // A WIP lesson with no progress was set going outside Tutor (fetch-iteration), and needs adopting here.
  if (pointer.iterationStatus === "WIP" && state.progress === null) {
    lines.push(
      unrecorded(state)
        ? `Not adopted in Tutor yet: call tutor_adopt_iteration for Lesson ${lesson.id}.`
        : unreadableProgressText(progressFileText(state), lesson.id),
    );
  }
  const problems = state.student.problems;
  if (problems.length > 0) {
    const more = problems.length > MAX_PROBLEMS ? ` (and ${problems.length - MAX_PROBLEMS} more)` : "";
    lines.push(`Problems reading the ${state.layout.id === null ? "workspace" : "factory"}: ${problems.slice(0, MAX_PROBLEMS).join(" ")}${more}`);
  }
  lines.push("", "Rules in suggested order (● focus; ✓ passing, ! not yet, ○ pending, – skipped):");
  for (const key of lesson.suggestedRuleOrder) {
    const rule = findRule(lesson, key);
    if (rule === undefined) continue;
    const ruleCounts = countExamples(rule.examples, progress);
    const marker = key === focus ? "●" : " ";
    lines.push(`${marker} ${rule.key} — ${rule.name} [${ruleCounts.passing}/${ruleCounts.total}, ${rule.change}]`);
    for (const example of rule.examples) {
      const status = exampleStatus(example, progress);
      const note = status === "not-yet" ? progress[example.key]?.note : undefined;
      lines.push(`    ${GLYPH[status]} ${example.key} — ${example.name}${note === undefined ? "" : ` (${clip(note, MAX_NOTE)})`}`);
    }
  }
  const terms = course.lexicon.slice(0, MAX_TERMS).map((entry) => entry.id);
  if (terms.length > 0) lines.push("", `Lexicon ids for ::term: ${terms.join(", ")}.`);
  const text = lines.join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - TRUNCATED.length)}${TRUNCATED}` : text;
}
