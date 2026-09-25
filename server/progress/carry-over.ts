import { homeworkExamples } from "../../shared/derive.ts";
import type { ExampleProgress, Homework, PastHomework, ProgressFile } from "../../shared/model.ts";

/** `previous.history` plus `previous` itself as a finished homework, without its evidence. */
function historyAfter(previous: ProgressFile | null, adopting: string): Record<string, PastHomework> | undefined {
  if (previous === null) return undefined;
  const history = { ...previous.history };
  if (previous.iteration !== adopting) {
    const past: PastHomework = {
      examples: Object.fromEntries(Object.entries(previous.examples).map(([key, { evidence: _, ...entry }]) => [key, entry])),
    };
    if (previous.adopted !== undefined) past.adopted = previous.adopted;
    if (previous.summary !== undefined) past.summary = previous.summary;
    history[previous.iteration] = past;
  }
  return Object.keys(history).length === 0 ? undefined : history;
}

/**
 * A fresh PROGRESS.yaml for `homework`, keeping the previous homework in `history`. Every Example whose text hash matches
 * a passing entry of `previous`, under any key, starts passing, keeping that
 * entry's evidence and time and remembering which homework it was first
 * passed in. Everything else has no entry, which means pending.
 */
export function carryOver(previous: ProgressFile | null, homework: Homework, adopted: string): ProgressFile {
  const passingByHash = new Map<string, { entry: ExampleProgress; from: string }>();
  for (const entry of Object.values(previous?.examples ?? {})) {
    if (entry.status === "passing" && previous !== null && !passingByHash.has(entry.hash)) {
      passingByHash.set(entry.hash, { entry, from: entry.carriedFrom ?? previous.iteration });
    }
  }
  const examples: Record<string, ExampleProgress> = {};
  for (const example of homeworkExamples(homework)) {
    const match = passingByHash.get(example.hash);
    if (match === undefined) continue;
    const carried: ExampleProgress = { status: "passing", hash: example.hash, at: match.entry.at, carriedFrom: match.from };
    if (match.entry.evidence !== undefined) carried.evidence = match.entry.evidence;
    examples[example.key] = carried;
  }
  const next: ProgressFile = { iteration: homework.id, focus: homework.suggestedRuleOrder[0] ?? null, adopted, examples };
  const history = historyAfter(previous, homework.id);
  if (history !== undefined) next.history = history;
  return next;
}
