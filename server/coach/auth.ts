// Who is calling a coach tool. BB runs a plugin tool even when configure did
// not offer it, so every call re-checks the thread with BB itself; plugin
// metadata is never consulted.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Binding } from "../../shared/rpc.ts";

type Sdk = BbPluginApi["sdk"];

export interface Caller {
  threadId: string;
  /** The homework's main coach thread (it has no parent), as opposed to a side thread. */
  isMain: boolean;
  /** The main thread a side thread hangs off; the caller itself when it is the main thread. */
  mainThreadId: string;
}

export const NOT_A_TUTOR_THREAD =
  "Tutor's tools only work in Tutor coach threads. Open the coach from the Course page in the sidebar.";

export async function authorizeCaller(
  sdk: Sdk,
  pluginId: string,
  threadId: string,
  binding: Binding,
): Promise<Caller | { error: string }> {
  let thread: Awaited<ReturnType<Sdk["threads"]["get"]>>;
  try {
    thread = await sdk.threads.get({ threadId });
  } catch {
    return { error: NOT_A_TUTOR_THREAD };
  }
  if (thread.originPluginId !== pluginId) return { error: NOT_A_TUTOR_THREAD };
  if (binding.status !== "bound") {
    return { error: "No factory project is set up yet. The student confirms it on the Course page." };
  }
  if (thread.projectId !== binding.projectId) {
    return { error: "This thread is not in the student's factory project, so Tutor's tools are off here." };
  }
  return {
    threadId: thread.id,
    isMain: thread.parentThreadId === null,
    mainThreadId: thread.parentThreadId ?? thread.id,
  };
}
