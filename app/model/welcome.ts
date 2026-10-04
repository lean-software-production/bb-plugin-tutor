// First run (mockup 8): confirm the detected workspace (8A), or, when no
// project is on a connected machine, the Codespace offer (hostedWelcome, 8C):
// Tutor makes the project for the student's Codespace checkout once they say
// so. The same offer comes back when the workspace's machine is gone but the
// student has a new Codespace (unreachableView).
import { WORKSPACE_UNREACHABLE_TEXT } from "../../shared/constants.ts";
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

/**
 * Whether the first run offers the student's Codespace checkout (HostedOffer)
 * instead of the picker: when no candidate project has a folder on a machine
 * that is connected (none at all, or only ones on a Codespace that is gone).
 */
export function showsHostedOffer(candidates: readonly CandidateProject[]): boolean {
  return !candidates.some((candidate) => candidate.reachable && candidate.root !== null);
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
        body: `Tutor looked for ${offer.folder} on ${offer.machineName} and didn't find it. Create your Codespace from capstone-project-starter, or set the folder under Settings → Plugins → Tutor → Workspace folder.`,
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

/**
 * The page for a workspace whose machine is not connected: with an offer of
 * the student's current Codespace (a different machine with the workspace
 * folder: a rebuilt or new Codespace), one button to use it; otherwise (no
 * offer, or still asking) the Codespace is asleep.
 */
export function unreachableView(offer: WorkspaceOffer | null): HostedWelcome {
  if (offer?.status === "offer") {
    return {
      heading: "Your Codespace has changed",
      body: `Your workspace was on a Codespace that is stopped or gone. Your Codespace (${offer.machineName}) has ${offer.folder}: carry on there.`,
      action: { label: `Use ${offer.folder} on your Codespace (${offer.machineName})`, hostId: offer.hostId, folder: offer.folder },
    };
  }
  return { heading: "Your Codespace is asleep", body: WORKSPACE_UNREACHABLE_TEXT, action: null };
}
