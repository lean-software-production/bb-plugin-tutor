// The coach's agent when no coachProvider setting names one: the first of
// these the student has already signed in to on the workspace's machine.
// BB reports each agent's state there (system.providerStates).

import type { Sdk } from "./threads.ts";

/** In order of preference. */
export const COACH_AGENTS = ["claude-code", "codex", "pi"] as const;

/**
 * The first agent in COACH_AGENTS that BB reports "ready" on `hostId`, or null
 * when none is (or BB can't say), to leave the choice to BB's default.
 */
export async function readyCoachAgent(sdk: Sdk, hostId: string, log: (message: string) => void): Promise<string | null> {
  let ready: Set<string>;
  try {
    const { providers } = await sdk.system.providerStates({ hostId });
    ready = new Set(providers.filter((provider) => provider.status === "ready").map((provider) => provider.providerId));
  } catch (cause) {
    log(`[tutor] couldn't ask which agents are ready on ${hostId}, so BB's default agent coaches: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
  return COACH_AGENTS.find((agent) => ready.has(agent)) ?? null;
}
