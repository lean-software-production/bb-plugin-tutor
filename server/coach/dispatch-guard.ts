// The collision guard: Tutor's threads in one project share a working tree
// (coach threads, their side chats and older side threads), so one's new turn
// waits while another is running.
import type { BbPluginApi, MessageDispatchHookContext, MessageDispatchHookDecision } from "@get-bb/plugin-sdk";
import { coachThreadOf } from "./auth.ts";

type Sdk = BbPluginApi["sdk"];

/** A backstop: siblings going idle ask BB to re-check straight away. */
export const RECHECK_AFTER_MS = 60_000;

export async function decideDispatch(
  sdk: Sdk,
  pluginId: string,
  context: MessageDispatchHookContext,
  now: number,
): Promise<MessageDispatchHookDecision> {
  const { thread } = context;
  const forked = thread.originKind === "fork" && thread.visibility === "hidden";
  if (context.attempt === "join-turn" || (thread.originPluginId !== pluginId && !forked)) return { action: "proceed" };
  // listRunning is exact inside the hook; everything else is only read when something else runs.
  const running = new Set((await sdk.threads.listRunning()).map((candidate) => candidate.id));
  running.delete(thread.id);
  if (running.size === 0) return { action: "proceed" };
  if ((await coachThreadOf(sdk, pluginId, thread)) === null) return { action: "proceed" };
  const siblings = await sdk.threads.list({ originPluginId: pluginId, projectId: context.project.id, archived: false, includeHidden: true });
  const tutorIds = new Set(siblings.filter((sibling) => sibling.originPluginId === pluginId).map((sibling) => sibling.id));
  let busy: { title: string | null; titleFallback: string | null } | undefined = siblings.find(
    (sibling) => tutorIds.has(sibling.id) && running.has(sibling.id),
  );
  // Side chats BB made are not Tutor's; they count when they fork a Tutor coach thread here.
  for (const id of running) {
    if (busy !== undefined) break;
    if (tutorIds.has(id)) continue;
    const other = await sdk.threads.get({ threadId: id }).catch(() => null);
    if (other !== null && other.projectId === context.project.id && other.originKind === "fork" && tutorIds.has(other.sourceThreadId ?? "")) {
      busy = other;
    }
  }
  if (busy === undefined) return { action: "proceed" };
  return {
    action: "wait",
    reason: `Waiting for "${busy.title ?? busy.titleFallback ?? "another coach thread"}" to finish: Tutor's threads share one working tree.`,
    sendAt: now + RECHECK_AFTER_MS,
  };
}
