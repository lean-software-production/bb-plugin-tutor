// The words Tutor puts in front of the coach: first messages of new threads,
// the student's "work on this Rule" request, and configure's instructions.
import { SKILL_ID, TOOL_NAMES } from "../../shared/constants.ts";
import { coachThreadMetadataSchema, type Course, type Homework, type Rule } from "../../shared/model.ts";

export type MainThreadStart = "adopt" | "resume" | "revisit";

function method(course: Course): string {
  return course.coachPath === null
    ? "The course has no coach file, so coach one small step at a time."
    : `Your coaching method is the course's coach file, ${course.coachPath}: follow its Coaching process and Rules, ` +
        "using the tutor_* tools wherever it tells you to adopt a spec or change spec/ITERATION.";
}

export function mainThreadPrompt(course: Course, homework: Homework, start: MainThreadStart, focus: Rule | null = null): string {
  const lines = [
    `You are the coach for Homework ${homework.id} "${homework.title}" of the course "${course.title}".`,
    `Load the \`${SKILL_ID}\` skill and follow it. ${method(course)}`,
  ];
  if (start === "adopt") {
    lines.push(
      `Start by calling ${TOOL_NAMES.adoptIteration} with iteration "${homework.id}", commit as the coaching method says, then introduce the homework.`,
    );
  } else if (start === "resume") {
    lines.push(`Start with ${TOOL_NAMES.status}, then pick up where the student left off.`);
  } else {
    lines.push(
      `This homework is already complete; the student has come back to it. Call ${TOOL_NAMES.status} if you need it, and answer their questions without changing their progress.`,
    );
  }
  if (focus !== null) lines.push(`The student asked to work on the Rule "${focus.name}" (${focus.key}) next.`);
  return lines.join("\n\n");
}

export function sideThreadPrompt(homework: Homework, rule: Rule | null): string {
  const about = rule === null ? `Homework ${homework.id}` : `the Rule "${rule.name}" (${rule.key}) of Homework ${homework.id}`;
  return [
    `This is a side thread off the Homework ${homework.id} coach, for a question about ${about}.`,
    `Load the \`${SKILL_ID}\` skill. Say in one line what you can help with here, then ask the student what they would like to know.`,
  ].join("\n\n");
}

/** Sent to the main coach thread, as the student, when they click a Rule. */
export function redirectMessage(rule: Rule): string {
  return `I'd like to work on the Rule "${rule.name}" next. Please move the cursor there with ${TOOL_NAMES.focusRule} (rule ${rule.key}).`;
}

export function sideThreadTitle(homework: Homework, rule: Rule | null): string {
  const title = rule === null ? `Question · Homework ${homework.id}` : `Question · ${rule.name}`;
  return title.length > 120 ? `${title.slice(0, 119)}…` : title;
}

export interface InstructionFacts {
  coachPath: string | null;
}

/**
 * configure's short dynamic instructions. Metadata is untrusted: only values
 * that pass the schema (a three-digit id, a slug key) reach the text.
 */
export function coachInstructions(metadata: unknown, facts: InstructionFacts): string {
  const parsed = coachThreadMetadataSchema.safeParse(metadata);
  const lines = [`This thread belongs to Tutor, the course coach. Load the \`${SKILL_ID}\` skill and follow it.`];
  if (parsed.success) {
    const { iteration, role, ruleKey } = parsed.data;
    lines.push(
      role === "main"
        ? `You are the main coach thread for Homework ${iteration}: you move the cursor and mark Examples.`
        : `You are a side thread of the Homework ${iteration} coach${ruleKey === undefined ? "" : `, about Rule ${ruleKey}`}. ` +
            "You can mark Examples, but only the main thread moves the cursor.",
    );
  }
  if (facts.coachPath !== null) lines.push(`Coaching method: ${facts.coachPath}.`);
  lines.push("Never edit spec/PROGRESS.yaml or spec/ITERATION by hand: the tutor_* tools own them.");
  return lines.join("\n");
}
