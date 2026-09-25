// FACTORY.md compared line by line with the previous lesson's.
import { diffLines } from "diff";
import type { DiffLine } from "../../shared/model.ts";

/** Ends the text with exactly one newline, so a missing final newline is not a change. */
function terminated(text: string): string {
  return text === "" ? "" : `${text.replace(/\n+$/, "")}\n`;
}

export function factoryDiff(previous: string, current: string): DiffLine[] {
  return diffLines(terminated(previous), terminated(current)).flatMap((change) => {
    const kind: DiffLine["kind"] = change.added ? "add" : change.removed ? "del" : "ctx";
    return change.value
      .replace(/\n$/, "")
      .split("\n")
      .map((text) => ({ kind, text }));
  });
}
