// Who is calling a coach tool. BB runs a plugin tool even when configure did
// not offer it, so every call re-checks the thread with BB itself; plugin
// metadata is never consulted.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Binding } from "../../shared/rpc.ts";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["get"]>>;

export interface Caller {
  threadId: string;
  /** The lesson's coach thread itself, as opposed to one of its side chats (or older side threads). */
  isMain: boolean;
  /** The coach thread a side chat or side thread belongs to; the caller itself when it is the coach thread. */
  mainThreadId: string;
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
export function isTutorMain(thread: Pick<Thread, "originPluginId" | "parentThreadId" | "sourceThreadId" | "originKind">, pluginId: string): boolean {
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
  if (isTutorMain(thread, pluginId)) return thread;
  const mainId =
    thread.originKind === "fork"
      ? thread.visibility === "hidden" ? thread.sourceThreadId : null
      : thread.originPluginId === pluginId ? thread.parentThreadId : null;
  if (mainId === null) return null;
  const main = await getThread(sdk, mainId);
  if (main === null || !isTutorMain(main, pluginId) || main.projectId !== thread.projectId || main.archivedAt !== null) return null;
  return main;
}

export async function authorizeCaller(
  sdk: Sdk,
  pluginId: string,
  threadId: string,
  binding: Binding,
): Promise<Caller | { error: string }> {
  const thread = await getThread(sdk, threadId);
  const main = thread === null ? null : await coachThreadOf(sdk, pluginId, thread);
  if (thread === null || main === null) return { error: NOT_A_TUTOR_THREAD };
  if (binding.status !== "bound") {
    return { error: "No factory project is set up yet. The student confirms it on the Course page." };
  }
  if (thread.projectId !== binding.projectId) {
    return { error: "This thread is not in the student's factory project, so Tutor's tools are off here." };
  }
  return { threadId: thread.id, isMain: main.id === thread.id, mainThreadId: main.id };
}
