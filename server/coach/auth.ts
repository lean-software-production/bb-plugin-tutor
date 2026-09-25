// Who is calling a coach tool. BB runs a plugin tool even when configure did
// not offer it, so every call re-checks the thread with BB itself; plugin
// metadata is never consulted.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FactoryProject } from "../../shared/rpc.ts";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["get"]>>;

export interface Caller {
  threadId: string;
  /** The lesson's coach thread itself, as opposed to one of its side chats (or older side threads). */
  isCoachThread: boolean;
  /** The coach thread a side chat or side thread belongs to; the caller itself when it is the coach thread. */
  coachThreadId: string;
}

export const NOT_A_TUTOR_THREAD =
  "Tutor's tools only work in Tutor coach threads and their side chats. Open the coach from the course outline in the sidebar.";

async function getThread(sdk: Sdk, threadId: string): Promise<Thread | null> {
  try {
    return await sdk.threads.get({ threadId });
  } catch {
    return null;
  }
}

/** A thread Tutor spawned as a lesson's coach: neither a fork nor a child. */
export function isTutorCoachThread(thread: Pick<Thread, "originPluginId" | "parentThreadId" | "sourceThreadId" | "originKind">, pluginId: string): boolean {
  return thread.originPluginId === pluginId && thread.parentThreadId === null && thread.sourceThreadId === null && thread.originKind === null;
}

/**
 * The coach thread `thread` answers to, or null when it is not a Tutor
 * thread. Tutor's coach threads answer to themselves. Their side chats are
 * forks of them: Tutor's own (Tutor metadata) and those BB's "Reply in side
 * chat" made (the side-chat plugin's), which count as side chats of that
 * lesson without a Rule. A side chat is hidden: a visible fork ("Fork into
 * new thread") is a thread of its own. Side threads from before side chats
 * are children Tutor spawned. Anything else, a fork of a fork included,
 * answers to nobody.
 */
export async function coachThreadOf(sdk: Sdk, pluginId: string, thread: Thread): Promise<Thread | null> {
  if (isTutorCoachThread(thread, pluginId)) return thread;
  const coachId =
    thread.originKind === "fork"
      ? thread.visibility === "hidden" ? thread.sourceThreadId : null
      : thread.originPluginId === pluginId ? thread.parentThreadId : null;
  if (coachId === null) return null;
  const coachThread = await getThread(sdk, coachId);
  if (coachThread === null || !isTutorCoachThread(coachThread, pluginId) || coachThread.projectId !== thread.projectId || coachThread.archivedAt !== null) return null;
  return coachThread;
}

export async function authorizeCaller(
  sdk: Sdk,
  pluginId: string,
  threadId: string,
  factoryProject: FactoryProject,
): Promise<Caller | { error: string }> {
  const thread = await getThread(sdk, threadId);
  const coachThread = thread === null ? null : await coachThreadOf(sdk, pluginId, thread);
  if (thread === null || coachThread === null) return { error: NOT_A_TUTOR_THREAD };
  if (factoryProject.status !== "found") {
    return { error: "No factory project is set up yet. The student confirms it on the Course page." };
  }
  if (thread.projectId !== factoryProject.projectId) {
    return { error: "This thread is not in the student's factory project, so Tutor's tools are off here." };
  }
  return { threadId: thread.id, isCoachThread: coachThread.id === thread.id, coachThreadId: coachThread.id };
}
