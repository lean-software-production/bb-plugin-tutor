// First run (mockup 8): confirm the detected workspace (8A), or explain
// how to set one up when nothing qualifies (8B). The plugin never creates it.
import type { Workspace, CandidateProject } from "../../shared/rpc.ts";

export interface WelcomeView {
  /** "confirm" when some project qualifies as the workspace; "setup" otherwise. */
  mode: "confirm" | "setup";
  /** Projects that qualify, best first. */
  detected: CandidateProject[];
  /** Everything else, offered behind "Use a different project". */
  others: CandidateProject[];
  preselected: string | null;
  /** The stored project has gone or lost its local source. */
  missingProjectId: string | null;
}

export function welcomeView(candidates: readonly CandidateProject[], workspace: Workspace): WelcomeView {
  const detected = candidates.filter((candidate) => candidate.qualifies);
  const others = candidates.filter((candidate) => !candidate.qualifies);
  return {
    mode: detected.length > 0 ? "confirm" : "setup",
    detected,
    others,
    preselected: detected[0]?.projectId ?? null,
    missingProjectId: workspace.status === "missing" ? workspace.projectId : null,
  };
}
