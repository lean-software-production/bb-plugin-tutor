// The collision guard: Tutor threads in one project share a working tree, so
// a Tutor thread's new turn waits while a sibling Tutor thread is running.
import type { BbPluginApi, MessageDispatchHookContext, MessageDispatchHookDecision } from "@get-bb/plugin-sdk";

type Sdk = BbPluginApi["sdk"];

/** A backstop: siblings going idle ask BB to re-check straight away. */
export const RECHECK_AFTER_MS = 60_000;

export async function decideDispatch(
  sdk: Sdk,
  pluginId: string,
  context: MessageDispatchHookContext,
  now: number,
): Promise<MessageDispatchHookDecision> {
  if (context.attempt === "join-turn" || context.thread.originPluginId !== pluginId) return { action: "proceed" };
  // listRunning is exact inside the hook; list only when something else runs.
  const running = new Set((await sdk.threads.listRunning()).map((thread) => thread.id));
  running.delete(context.thread.id);
  if (running.size === 0) return { action: "proceed" };
  const siblings = await sdk.threads.list({ originPluginId: pluginId, projectId: context.project.id, archived: false });
  const busy = siblings.find((thread) => thread.originPluginId === pluginId && running.has(thread.id));
  if (busy === undefined) return { action: "proceed" };
  return {
    action: "wait",
    reason: `Waiting for "${busy.title ?? "another coach thread"}" to finish: Tutor threads share one working tree.`,
    sendAt: now + RECHECK_AFTER_MS,
  };
}
