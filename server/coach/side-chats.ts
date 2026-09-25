// Side chats: BB's own, as its built-in side-chat plugin makes them. A side
// chat is a hidden fork of the coach thread, shown by BB's "Side chat" panel
// in the coach thread's right panel. Tutor forks it with its own metadata (the
// homework and Rule it is about) and writes the tab BB writes for "Reply in
// side chat", because a plugin cannot open another plugin's panel itself.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BB_SIDE_CHAT } from "../../shared/constants.ts";
import type { CoachThreadMetadata } from "../../shared/model.ts";

type Sdk = BbPluginApi["sdk"];
type Tabs = Awaited<ReturnType<Sdk["threads"]["tabs"]["get"]>>["tabs"];
type Tab = Tabs[number];

const LIST_LIMIT = 200;
/** Another client (BB's own tab strip) can write the tabs between our read and write. */
export const TAB_WRITE_ATTEMPTS = 3;

export interface ForkSideChat {
  coachThreadId: string;
  courseId: string;
  homeworkId: string;
  ruleKey: string | null;
  title: string;
  /** Agent-only context the side chat's agent reads before the student's first message. */
  seed: string;
}

function errorCode(cause: unknown): string | null {
  return typeof cause === "object" && cause !== null && typeof (cause as { code?: unknown }).code === "string"
    ? (cause as { code: string }).code
    : null;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The error a student reads when BB will not fork the coach thread. */
export function forkFailure(cause: unknown): string {
  const text = errorText(cause);
  if (/does not support thread forks/i.test(text)) {
    return "Your coach's agent can't open side chats: its provider can't fork a conversation. Ask your question in the coach thread instead.";
  }
  if (errorCode(cause) === "fork_source_session_unavailable") {
    return "Your coach thread hasn't started a session yet, so there is nothing to fork. Send your coach a message first, then ask again.";
  }
  return `Couldn't start a side chat: ${text}`;
}

/**
 * A seed-only fork, as BB's side chat makes one: it sits idle until the
 * student writes in it, forks the coach's conversation at its tip, shares the
 * coach's working tree, and stops with the coach thread.
 */
export async function forkSideChat(sdk: Sdk, fork: ForkSideChat): Promise<string> {
  const pluginMetadata: CoachThreadMetadata = { course: fork.courseId, iteration: fork.homeworkId, role: "side" };
  if (fork.ruleKey !== null) pluginMetadata.ruleKey = fork.ruleKey;
  try {
    const thread = await sdk.threads.fork({
      sourceThreadId: fork.coachThreadId,
      lifecycleOwnerThreadId: fork.coachThreadId,
      visibility: "hidden",
      title: fork.title,
      pluginMetadata,
      agentContextSeed: [{ type: "text", text: fork.seed, mentions: [], visibility: "agent-only" }],
    });
    return thread.id;
  } catch (cause) {
    throw new Error(forkFailure(cause));
  }
}

/**
 * The tab BB 0.43.4 writes for "Reply in side chat" (observed with
 * `threads.tabs.get`): a plugin-panel tab of the side-chat plugin whose id
 * encodes the plugin, the action and the params.
 */
export function sideChatTab(sideChatId: string, coachThreadId: string, sourceMessageText: string): Tab {
  const paramsJson = JSON.stringify({ threadId: sideChatId, sourceThreadId: coachThreadId, sourceMessageText, sourceSeqEnd: null });
  return {
    id: `plugin-panel:${encodeURIComponent(`${BB_SIDE_CHAT.pluginId}:${BB_SIDE_CHAT.actionId}:${paramsJson}`)}:none`,
    kind: "plugin-panel",
    pluginId: BB_SIDE_CHAT.pluginId,
    actionId: BB_SIDE_CHAT.actionId,
    title: BB_SIDE_CHAT.title,
    paramsJson,
  };
}

function paramsThreadId(paramsJson: string | null): string | null {
  if (paramsJson === null) return null;
  try {
    const params: unknown = JSON.parse(paramsJson);
    return typeof params === "object" && params !== null && typeof (params as { threadId?: unknown }).threadId === "string"
      ? (params as { threadId: string }).threadId
      : null;
  } catch {
    return null;
  }
}

/** Whether a tab already shows the side chat, in either of BB's tab shapes for it. */
export function showsSideChat(tab: Tab, sideChatId: string): boolean {
  if (tab.kind === "side-chat") return tab.threadId === sideChatId;
  return tab.kind === "plugin-panel" && tab.pluginId === BB_SIDE_CHAT.pluginId && paramsThreadId(tab.paramsJson) === sideChatId;
}

/**
 * Adds the side chat's tab to the coach thread's right panel unless one is
 * there already, retrying when another client changed the tabs meanwhile.
 * True when it added one.
 */
export async function ensureSideChatTab(
  sdk: Sdk,
  coachThreadId: string,
  sideChatId: string,
  sourceMessageText: string,
): Promise<boolean> {
  for (let attempt = 1; ; attempt += 1) {
    const current = await sdk.threads.tabs.get({ threadId: coachThreadId });
    if (current.tabs.some((tab) => showsSideChat(tab, sideChatId))) return false;
    try {
      await sdk.threads.tabs.update({
        threadId: coachThreadId,
        expectedRevision: current.revision,
        tabs: [...current.tabs, sideChatTab(sideChatId, coachThreadId, sourceMessageText)],
      });
      return true;
    } catch (cause) {
      if (errorCode(cause) !== "thread_tabs_conflict" || attempt >= TAB_WRITE_ATTEMPTS) throw cause;
    }
  }
}

export interface SideChatRow {
  id: string;
  originPluginId: string | null;
  projectId: string;
  createdAt: number;
  sourceThreadId: string | null;
  visibility: "hidden" | "visible";
  archivedAt: number | null;
  title: string | null;
  titleFallback: string | null;
}

/** A side chat of `coachThreadId`: a live, hidden fork of it, whoever made it. */
export function isSideChatOf(row: SideChatRow, coachThreadId: string): boolean {
  return row.sourceThreadId === coachThreadId && row.visibility === "hidden" && row.archivedAt === null;
}

/** BB's side chat seeds its fork with this before the message it replies to (bb-app 0.43.4). */
export const BB_REPLY_PREFIX = /^Replying to this earlier message in the conversation:\s*/;

/** Every side chat of the coach thread: Tutor's and those BB's "Reply in side chat" made. */
export async function listSideChats(sdk: Sdk, coachThreadId: string): Promise<SideChatRow[]> {
  const rows = await sdk.threads.list({ sourceThreadId: coachThreadId, includeHidden: true, archived: false, limit: LIST_LIMIT });
  return rows.filter((row) => isSideChatOf(row, coachThreadId));
}
