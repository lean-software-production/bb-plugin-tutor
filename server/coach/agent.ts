// The coach's agent when no coachProvider setting names one: the first of
// these the student has already signed in to on the workspace's machine.
// BB reports each agent's state there (system.providerStates).

import type { CoachAgentState } from "../../shared/rpc.ts";
import type { Sdk } from "./threads.ts";

/** In order of preference. */
export const COACH_AGENTS = ["claude-code", "codex", "pi"] as const;

/**
 * The agent that would coach, and for each of COACH_AGENTS that isn't ready,
 * how to sign in. Null when BB can't say (readyCoachAgent then leaves the
 * choice to BB's default).
 */
export async function coachAgentState(sdk: Sdk, hostId: string, log: (message: string) => void): Promise<CoachAgentState | null> {
  try {
    const { providers } = await sdk.system.providerStates({ hostId });
    const byId = new Map(providers.map((p) => [p.providerId, p]));
    const ready = COACH_AGENTS.find((agent) => byId.get(agent)?.status === "ready") ?? null;
    const signIn = COACH_AGENTS.filter((agent) => byId.get(agent)?.status !== "ready").map((agent) => ({
      providerId: agent,
      name: byId.get(agent)?.displayName ?? agent,
      command: byId.get(agent)?.loginCommand ?? null,
    }));
    return { ready, signIn };
  } catch (cause) {
    log(`[tutor] couldn't ask which agents are ready on ${hostId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
}

/**
 * The first agent in COACH_AGENTS that BB reports "ready" on `hostId`, or null
 * when none is (or BB can't say), to leave the choice to BB's default.
 */
export async function readyCoachAgent(sdk: Sdk, hostId: string, log: (message: string) => void): Promise<string | null> {
  return (await coachAgentState(sdk, hostId, log))?.ready ?? null;
}
