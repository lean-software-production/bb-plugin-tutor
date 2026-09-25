// spec/ITERATION: one line, "<NNN> <WIP|Done>". Canonical (decision 1), and
// shared with coach-me outside BB, so the format never changes.
import type { IterationState } from "../../shared/model.ts";

const LINE = /^(\d{3})\s+(wip|done)$/i;

export type ParsedIteration = { state: IterationState } | { problem: string };

export function parseIteration(text: string): ParsedIteration {
  const line = text.trim();
  const match = LINE.exec(line);
  if (match === null) {
    return { problem: `spec/ITERATION should read like "003 WIP", but it reads "${line.slice(0, 40)}".` };
  }
  const [, iteration = "", status = ""] = match;
  return { state: { iteration, status: status.toLowerCase() === "done" ? "Done" : "WIP" } };
}

export function formatIteration(state: IterationState): string {
  return `${state.iteration} ${state.status}\n`;
}
