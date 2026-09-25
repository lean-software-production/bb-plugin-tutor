// The Example text hash behind carry-over and novelty. The exact input is a
// contract (docs/tutor/IMPLEMENTATION.md "Example text hash"): changing it
// would reset every student's passing Examples, so it is pinned by tests.
import { createHash } from "node:crypto";
import type { Step, TextHash } from "../../shared/model.ts";

function normaliseLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/** The lines that are hashed, before normalisation. */
function exampleTextLines(name: string, steps: readonly Step[]): string[] {
  const lines = [name];
  for (const step of steps) {
    lines.push(`${step.keyword} ${step.text}`);
    if (step.docString !== null) {
      lines.push(`"""${step.docString.mediaType ?? ""}`, ...step.docString.content.split("\n"), `"""`);
    }
    for (const row of step.dataTable ?? []) lines.push(row.join(" | "));
  }
  return lines;
}

export function exampleHash(name: string, steps: readonly Step[]): TextHash {
  const text = exampleTextLines(name, steps).map(normaliseLine).join("\n");
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
