// The words Tutor puts in front of the coach: first messages of new coach
// threads, the context a side chat starts from, the student's "work on this
// Rule" request, and configure's instructions.
import { SKILL_ID, TOOL_NAMES } from "../../shared/constants.ts";
import { formatLessonRef } from "../../shared/directives.ts";
import { coachThreadMetadataSchema, type Course, type Lesson, type Rule } from "../../shared/model.ts";

export type CoachThreadStart = "adopt" | "resume" | "revisit";

const MAX_QUESTION = 1500;

/** The tutor_* tools own adoption and the progress files, whatever the coach file says. */
const TOOLS_OWN_PROGRESS =
  "Never run fetch-iteration or fetch.sh, and never edit ITERATION or spec/PROGRESS.yaml by hand: the tutor_* tools own them.";

function method(coachPath: string | null): string {
  const how =
    coachPath === null
      ? "There is no coach file, so coach one small step at a time."
      : `Your coaching method is the coach file, ${coachPath}: follow its Coaching process and Rules, ` +
        "using the tutor_* tools wherever it tells you to fetch an iteration or change ITERATION.";
  return `${how} ${TOOLS_OWN_PROGRESS}`;
}

/**
 * The coach thread's first message. `coachPath` is the coaching method's file
 * (coach-file.ts). The lesson card line sits on its own line, exactly as the
 * coach must write it, so the lesson leads the thread.
 */
export function coachThreadPrompt(
  course: Course,
  coachPath: string | null,
  lesson: Lesson,
  start: CoachThreadStart,
  focus: Rule | null = null,
): string {
  const lines = [
    `You are the coach for Lesson ${lesson.id} "${lesson.title}" of the course "${course.title}".`,
    `Load the \`${SKILL_ID}\` skill and follow it. ${method(coachPath)}`,
    "Start your first reply with this line, exactly as written and on a line of its own. BB draws it as the lesson card: the lesson and its Rules.",
    formatLessonRef({ lessonId: lesson.id }),
  ];
  if (start === "adopt") {
    lines.push(
      `Then call ${TOOL_NAMES.adoptIteration} with iteration "${lesson.id}", commit as the coaching method says, and introduce the lesson.`,
    );
  } else if (start === "resume") {
    lines.push(`Then call ${TOOL_NAMES.status} and pick up where the student left off.`);
  } else {
    lines.push(
      `This lesson is already complete; the student has come back to it. Call ${TOOL_NAMES.status} if you need it, and answer their questions without changing their progress.`,
    );
  }
  if (focus !== null) lines.push(`The student asked to work on the Rule "${focus.name}" (${focus.key}) next.`);
  return lines.join("\n\n");
}

function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Agent-only context at the start of a side chat, which forks the coach
 * thread's conversation. `question` is the side question when the coach moved
 * one here (tutor_side_chat); from the "Ask a side question" button there is
 * none yet, and the student writes it.
 */
export function sideChatSeed(lesson: Lesson, rule: Rule | null, question: string | null = null): string {
  const about = rule === null ? `Lesson ${lesson.id}` : `the Rule "${rule.name}" (${rule.key}) of Lesson ${lesson.id}`;
  const lines = [
    `This is a side chat off the Lesson ${lesson.id} coach thread, for a side question about ${about}.`,
    "Answer it here, briefly, so the coach thread stays on its Rule. You can mark Examples, but only the coach thread moves the focus; suggest a different Rule to the student instead.",
  ];
  lines.push(
    question === null
      ? "Wait for the student's question."
      : `The student's question, which the coach moved here: ${clip(question, MAX_QUESTION)}`,
  );
  return lines.join("\n\n");
}

/** What BB's side chat panel shows as "Replying to", above the side chat. */
export function sideChatAnchor(lesson: Lesson, rule: Rule | null): string {
  return rule === null ? `A side question about Lesson ${lesson.id}` : `A side question about the Rule "${rule.name}"`;
}

/** Sent to the coach thread, as the student, when they ask for a Rule. */
export function redirectMessage(rule: Rule): string {
  return `I'd like to work on the Rule "${rule.name}" next. Please move the focus there with ${TOOL_NAMES.focusRule} (rule ${rule.key}).`;
}

/** Short: the course outline lists it under its lesson, with its Rule beneath ("from: …"). */
export function sideChatTitle(rule: Rule | null): string {
  return rule === null ? "Side question" : "Side question about a Rule";
}

export interface InstructionFacts {
  coachPath: string | null;
}

/** Where the configured thread sits under its lesson, from BB's thread structure. */
export type ThreadPlace =
  | { kind: "coach" }
  /** A fork of the coach thread: Tutor's (its metadata may name a Rule) or BB's own. */
  | { kind: "side-chat"; lessonId: string | null }
  /** A child Tutor spawned before side chats. */
  | { kind: "side-thread" };

/**
 * configure's short dynamic instructions. Metadata is untrusted: only values
 * that pass the schema (a three-digit id, a slug key) reach the text.
 */
export function coachInstructions(metadata: unknown, facts: InstructionFacts, place: ThreadPlace = { kind: "coach" }): string {
  const parsed = coachThreadMetadataSchema.safeParse(metadata);
  const lines = [`This thread belongs to Tutor, the course coach. Load the \`${SKILL_ID}\` skill and follow it.`];
  const lessonId = parsed.success ? parsed.data.lesson : place.kind === "side-chat" ? place.lessonId : null;
  const ruleKey = parsed.success ? parsed.data.ruleKey : undefined;
  const about = ruleKey === undefined ? "" : `, about Rule ${ruleKey}`;
  if (lessonId !== null) {
    if (place.kind === "coach" && parsed.success && parsed.data.role === "coach") {
      lines.push(`You are the coach thread for Lesson ${lessonId}: you move the focus and mark Examples.`);
    } else if (place.kind === "side-chat") {
      lines.push(
        `You are a side chat of the Lesson ${lessonId} coach thread${about}. ` +
          "Answer the side question here; you can mark Examples, but only the coach thread moves the focus.",
      );
    } else if (place.kind === "side-thread") {
      lines.push(
        `You are a side thread of the Lesson ${lessonId} coach thread${about}. ` +
          "You can mark Examples, but only the coach thread moves the focus.",
      );
    }
  }
  if (facts.coachPath !== null) lines.push(`Coaching method: ${facts.coachPath}.`);
  lines.push(TOOLS_OWN_PROGRESS);
  return lines.join("\n");
}
