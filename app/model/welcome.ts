// First run (mockup 8): confirm the detected workspace (8A), or explain
// how to set one up when nothing qualifies (8B). The plugin never creates it.
// A hosted student instead sees the Codespace offer (hostedWelcome): no
// candidates ever list there, so offerWorkspace drives the page instead.
import type { Workspace, CandidateProject, WorkspaceOffer } from "../../shared/rpc.ts";

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

export interface HostedWelcome {
  heading: string;
  body: string;
  action: { label: string; hostId: string; folder: string } | null;
}

/** The hosted first run's view of offerWorkspace's answer: the Codespace offer, or why there isn't one yet. */
export function hostedWelcome(offer: WorkspaceOffer): HostedWelcome {
  switch (offer.status) {
    case "no-machine":
      return {
        heading: "Open your Codespace",
        body: "Open your Codespace of capstone-project-starter. Tutor connects to it by itself; this page updates when it has.",
        action: null,
      };
    case "no-folder":
      return {
        heading: "Your workspace folder isn't there",
        body: `Tutor looked for ${offer.folder} on ${offer.machineName} and didn't find it. Create your Codespace from capstone-project-starter, or set the folder under Settings → Tutor → Workspace folder.`,
        action: null,
      };
    case "offer":
      return {
        heading: "Your workspace",
        body: `Tutor coaches you in ${offer.folder} on your Codespace (${offer.machineName}).`,
        action: { label: `Use ${offer.folder}`, hostId: offer.hostId, folder: offer.folder },
      };
  }
}
