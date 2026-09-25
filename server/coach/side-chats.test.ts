import assert from "node:assert/strict";
import { test } from "node:test";
import { forkFailure, isSideChatOf, listSideChats, showsSideChat, sideChatTab } from "./side-chats.ts";

test("the side chat tab is the one BB writes for Reply in side chat", () => {
  const tab = sideChatTab("thr_fork", "thr_coach", "A side question about the Rule \"X\"");
  const paramsJson = '{"threadId":"thr_fork","sourceThreadId":"thr_coach","sourceMessageText":"A side question about the Rule \\"X\\"","sourceSeqEnd":null}';
  assert.deepEqual(tab, {
    id: `plugin-panel:${encodeURIComponent(`side-chat:side-chat:${paramsJson}`)}:none`,
    kind: "plugin-panel",
    pluginId: "side-chat",
    actionId: "side-chat",
    title: "Side chat",
    paramsJson,
  });
  assert.ok(showsSideChat(tab, "thr_fork"));
  assert.ok(!showsSideChat(tab, "thr_other"));
});

test("a side chat is shown by either of BB's tab shapes, and nothing else", () => {
  const legacy = { id: "t", kind: "side-chat", threadId: "thr_fork", title: "Side chat", sourceMessageText: "", sourceSeqEnd: null } as const;
  assert.ok(showsSideChat(legacy, "thr_fork"));
  const otherPlugin = { ...sideChatTab("thr_fork", "thr_coach", ""), pluginId: "tutor" };
  assert.ok(!showsSideChat(otherPlugin, "thr_fork"));
  const broken = { ...sideChatTab("thr_fork", "thr_coach", ""), paramsJson: "{not json" };
  assert.ok(!showsSideChat(broken, "thr_fork"));
  assert.ok(!showsSideChat({ id: "i", kind: "thread-info" }, "thr_fork"));
});

test("only a live, hidden fork of the coach thread is its side chat", () => {
  const row = { id: "f", originPluginId: "side-chat", projectId: "p", createdAt: 1, sourceThreadId: "c", visibility: "hidden" as const, archivedAt: null, title: null, titleFallback: null };
  assert.ok(isSideChatOf(row, "c"));
  assert.ok(!isSideChatOf(row, "d"));
  assert.ok(!isSideChatOf({ ...row, visibility: "visible" }, "c"));
  assert.ok(!isSideChatOf({ ...row, archivedAt: 5 }, "c"));
});

test("fork failures read as advice to the student", () => {
  assert.match(forkFailure(new Error("Provider scripted does not support thread forks")), /can't open side chats/);
  assert.match(
    forkFailure(Object.assign(new Error("Cannot fork: source has no active session to clone"), { code: "fork_source_session_unavailable" })),
    /Send your coach a message first/,
  );
  assert.equal(forkFailure("boom"), "Couldn't start a side chat: boom");
});

test("every side chat of a coach thread is listed, past the first page", async () => {
  const forks = Array.from({ length: 250 }, (_, index) => ({
    id: `thr_fork_${index}`,
    originPluginId: null,
    projectId: "prj_factory",
    createdAt: 250 - index,
    sourceThreadId: "thr_coach",
    visibility: "hidden" as const,
    archivedAt: null,
    title: null,
    titleFallback: null,
  }));
  const sdk = {
    threads: { list: async ({ limit, offset = 0 }: { limit: number; offset?: number }) => forks.slice(offset, offset + limit) },
  } as unknown as Parameters<typeof listSideChats>[0];
  assert.equal((await listSideChats(sdk, "thr_coach")).length, 250);
});
