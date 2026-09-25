// First run (mockup 8): confirm the detected factory project (8A), or explain
// how to set one up when nothing qualifies (8B). The plugin never creates it.
import type { Binding, CandidateProject } from "../../shared/rpc.ts";

export interface WelcomeView {
  /** "confirm" when some project looks like a factory repo; "setup" otherwise. */
  mode: "confirm" | "setup";
  /** Projects that look like a factory repo, best first. */
  detected: CandidateProject[];
  /** Everything else, offered behind "Use a different project". */
  others: CandidateProject[];
  preselected: string | null;
  /** The stored project has gone or lost its local source. */
  missingProjectId: string | null;
}

export function welcomeView(candidates: readonly CandidateProject[], binding: Binding): WelcomeView {
  const detected = candidates.filter((candidate) => candidate.qualifies);
  const others = candidates.filter((candidate) => !candidate.qualifies);
  return {
    mode: detected.length > 0 ? "confirm" : "setup",
    detected,
    others,
    preselected: detected[0]?.projectId ?? null,
    missingProjectId: binding.status === "missing" ? binding.projectId : null,
  };
}
