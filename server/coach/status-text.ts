// tutor_status: a compact, bounded picture of the homework the coach can act
// on. Keys are listed because every other tool takes them.
import { countExamples, exampleStatus, findRule, homeworkExamples } from "../../shared/derive.ts";
import type { ExampleStatus } from "../../shared/model.ts";
import type { CoachState } from "./actions.ts";

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

export function statusText(state: CoachState): string {
  const { course, homework, pointer } = state;
  const progress = state.progress?.examples ?? {};
  const focus = state.progress?.focus ?? null;
  const counts = countExamples(homeworkExamples(homework), progress);
  const lines = [
    `Course: ${course.title}. Coaching method: ${course.coachPath ?? "(the course has no coach file)"}.`,
    `Factory: ${state.root}.`,
    `Homework ${homework.id} "${homework.title}": ${pointer.iterationStatus}. ` +
      `${counts.passing}/${counts.total} passing, ${counts.notYet} not yet, ${counts.skipped} skipped, ${counts.pending} pending.`,
    `Focus: ${focus ?? "none"}.`,
  ];
  const problems = state.student.problems;
  if (problems.length > 0) {
    const more = problems.length > MAX_PROBLEMS ? ` (and ${problems.length - MAX_PROBLEMS} more)` : "";
    lines.push(`Problems reading the factory: ${problems.slice(0, MAX_PROBLEMS).join(" ")}${more}`);
  }
  lines.push("", "Rules in suggested order (● focus; ✓ passing, ! not yet, ○ pending, – skipped):");
  for (const key of homework.suggestedRuleOrder) {
    const rule = findRule(homework, key);
    if (rule === undefined) continue;
    const ruleCounts = countExamples(rule.examples, progress);
    const marker = key === focus ? "●" : " ";
    lines.push(`${marker} ${rule.key} — ${rule.name} [${ruleCounts.passing}/${ruleCounts.total}, ${rule.novelty}]`);
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
