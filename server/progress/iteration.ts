// ITERATION: one line, "<NNN> <WIP|Done>". Canonical (decision 1), and shared
// with fetch-iteration and coach-me outside BB, so the format never changes.
// It sits at the factory root; older factories kept it in spec/ITERATION.
import { FACTORY_FILES } from "../../shared/constants.ts";
import type { IterationState } from "../../shared/model.ts";

const LINE = /^(\d{3})\s+(wip|done)$/i;

/** Where ITERATION is looked for, in order: the root file wins over the legacy one. */
export const ITERATION_FILES = [FACTORY_FILES.iteration, FACTORY_FILES.legacyIteration] as const;

export type ParsedIteration = { state: IterationState } | { problem: string };

/** `label` is the file the text came from, named in the problem. */
export function parseIteration(text: string, label: string): ParsedIteration {
  const line = text.trim();
  const match = LINE.exec(line);
  if (match === null) {
    return { problem: `${label} should read like "003 WIP", but it reads "${line.slice(0, 40)}".` };
  }
  const [, iteration = "", status = ""] = match;
  return { state: { iteration, status: status.toLowerCase() === "done" ? "Done" : "WIP" } };
}

export function formatIteration(state: IterationState): string {
  return `${state.iteration} ${state.status}\n`;
}
