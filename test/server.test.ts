// Tutor's backend end to end against the SDK's fake host: configure scoping,
// tool authorisation, coach thread spawn-or-find, and the PROGRESS.yaml round
// trip through the coach tools, including carry-over on adopt.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  makeMessageDispatchHookContext,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { ALL_TOOL_NAMES } from "../shared/constants.ts";
import { findLesson, lessonExamples } from "../shared/derive.ts";
import type { Completion, LessonDetail, Overview } from "../shared/rpc.ts";
import { NOT_A_TUTOR_THREAD } from "../server/coach/auth.ts";
import { makeSandbox, type Sandbox } from "./helpers/disk.ts";
import { makeTutorHost, PROJECT_ID, type TutorHost } from "./helpers/fake-bb.ts";

async function setup(t: TestContext, settings?: Record<string, string>): Promise<{ sandbox: Sandbox; host: TutorHost }> {
  const sandbox = await makeSandbox();
  const host = await makeTutorHost(sandbox.course, sandbox.factoryRoot, settings);
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  return { sandbox, host };
}

function text(result: PluginAgentToolResult): string {
  return typeof result === "string" ? result : result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function isError(result: PluginAgentToolResult): boolean {
  return typeof result !== "string" && result.isError === true;
}

async function tool(host: TutorHost, name: string, input: unknown, threadId: string): Promise<PluginAgentToolResult> {
  return host.harness.behavior.callAgentTool(name, input, { threadId, projectId: PROJECT_ID });
}

async function ok(host: TutorHost, name: string, input: unknown, threadId: string): Promise<string> {
  const result = await tool(host, name, input, threadId);
  assert.ok(!isError(result), `${name} failed: ${text(result)}`);
  return text(result);
}

async function openCoach(host: TutorHost, lessonId: string) {
  return (await host.harness.behavior.callRpc("openCoach", { lessonId })) as { threadId: string; created: boolean };
}

test("configure offers the tools, skill and instructions to Tutor's threads and to side chats of its coach threads", async (t) => {
  const { host } = await setup(t);
  const mine = await host.harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({
      origin: { kind: null, pluginId: "tutor" },
      pluginMetadata: { course: "software-factory", lesson: "002", role: "coach" },
    }),
  );
  assert.deepEqual(mine.tools.map((entry) => entry.name).sort(), [...ALL_TOOL_NAMES].sort());
  assert.deepEqual(mine.skills, ["tutor"]);
  assert.match(mine.instructions ?? "", /coach thread for Lesson 002/);

  const coach = (await openCoach(host, "000")).threadId;
  const sideChat = (sourceThreadId: string) =>
    host.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        origin: { kind: "fork", pluginId: "side-chat" },
        thread: { id: "thr_fork", title: null, parentThreadId: null, sourceThreadId },
      }),
    );
  const bbs = await sideChat(coach);
  assert.deepEqual(bbs.tools.map((entry) => entry.name).sort(), [...ALL_TOOL_NAMES].sort());
  assert.match(bbs.instructions ?? "", /side chat of the Lesson 000 coach thread/);

  for (const other of [
    await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ origin: { kind: null, pluginId: null } })),
    await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ origin: { kind: "fork", pluginId: "side-chat" } })),
    await sideChat("thr_not_a_coach"),
  ]) {
    assert.deepEqual([other.tools, other.skills, other.instructions], [[], [], null]);
  }
});

test("every tool refuses threads Tutor did not spawn, whatever their metadata says", async (t) => {
  const { sandbox, host } = await setup(t);
  host.addThread({ id: "thr_foreign", metadata: { course: "software-factory", lesson: "000", role: "coach" } });
  host.addThread({ id: "thr_elsewhere", originPluginId: "tutor", projectId: "prj_other" });
  host.addThread({ id: "thr_plain_parent" });
  // Forks answer to their source: a side chat of an ordinary thread gets nothing, whatever its metadata claims.
  host.addThread({
    id: "thr_fork_of_plain",
    originKind: "fork",
    originPluginId: "tutor",
    sourceThreadId: "thr_plain_parent",
    visibility: "hidden",
    metadata: { course: "software-factory", lesson: "000", role: "sideChat" },
  });
  const inputs: Record<string, unknown> = {
    tutor_status: {},
    tutor_focus_rule: { rule: "a/b" },
    tutor_mark_example: { example: "a/b/c", status: "skipped" },
    tutor_adopt_iteration: { iteration: "000" },
    tutor_complete_iteration: { iteration: "000", summary: "x" },
    tutor_side_chat: { title: "t", prompt: "p" },
  };
  for (const name of ALL_TOOL_NAMES) {
    const result = await tool(host, name, inputs[name], "thr_foreign");
    assert.ok(isError(result), name);
    assert.equal(text(result), NOT_A_TUTOR_THREAD);
    assert.equal(text(await tool(host, name, inputs[name], "thr_fork_of_plain")), NOT_A_TUTOR_THREAD, name);
    const elsewhere = await tool(host, name, inputs[name], "thr_elsewhere");
    assert.ok(isError(elsewhere) && /not in the student's factory project/.test(text(elsewhere)), name);
  }
  assert.deepEqual(await readdir(sandbox.factoryRoot), []);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.fork").length, 0);
});

test("tools refuse while no factory project is bound", async (t) => {
  const { host } = await setup(t, {});
  host.addThread({ id: "thr_tutor", originPluginId: "tutor" });
  const result = await tool(host, "tutor_status", {}, "thr_tutor");
  assert.ok(isError(result) && /No factory project/.test(text(result)));
});

test("openCoach spawns one coach thread per lesson in the factory, then finds it again", async (t) => {
  const { sandbox, host } = await setup(t);
  const first = await openCoach(host, "000");
  assert.equal(first.created, true);
  const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.equal(spawn.title, "Coach · Lesson 000");
  assert.equal(spawn.projectId, PROJECT_ID);
  assert.deepEqual(spawn.pluginMetadata, { course: "software-factory", lesson: "000", role: "coach" });
  assert.deepEqual(spawn.environment, {
    type: "host",
    hostId: "host_1",
    workspace: { type: "unmanaged", path: sandbox.factoryRoot },
  });
  assert.match(String(spawn.prompt), /tutor_adopt_iteration with iteration "000"/);
  assert.match(String(spawn.prompt), /\n::tutor-lesson\{lesson="000"\}\n/);

  assert.deepEqual(await openCoach(host, "000"), { threadId: first.threadId, created: false });
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  await assert.rejects(openCoach(host, "002"), /has not started yet/);
  assert.ok(host.harness.inspection.realtimeSignals.some((signal) => (signal.payload as { reason: string }).reason === "threads"));
});

test("the coach tools round-trip progress through the factory repo and carry passing Examples over", async (t) => {
  const { sandbox, host } = await setup(t);
  const root = sandbox.factoryRoot;
  const course = sandbox.course;

  // Lesson 0: tracked in PROGRESS.yaml only.
  const coach0 = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach0);
  assert.deepEqual((await readdir(join(root, "spec"))).sort(), ["PROGRESS.yaml"]);
  const lesson0 = findLesson(course, "000");
  assert.ok(lesson0 !== undefined);
  for (const example of lessonExamples(lesson0)) {
    await ok(host, "tutor_mark_example", { example: example.key, status: "passing", evidence: "seen in the outline" }, coach0);
  }
  await ok(host, "tutor_complete_iteration", { iteration: "000", summary: "You know your way around." }, coach0);

  // Lesson 1: adopted into spec/ like coach-me, then passed.
  const coach1 = ((await host.harness.behavior.callRpc("startNextLesson", { lessonId: "001" })) as { threadId: string }).threadId;
  assert.match(host.threads.find((thread) => thread.id === coach1)?.prompt ?? "", /tutor_adopt_iteration with iteration "001"/);
  const adopted = await ok(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  assert.match(adopted, /Adopt spec for iteration 001/);
  assert.equal(await readFile(join(root, "spec/ITERATION"), "utf8"), "001 WIP\n");
  assert.deepEqual((await readdir(join(root, "spec/features"))).sort(), ["planning.feature"]);
  assert.ok((await readdir(join(root, "seeds"))).includes("tetris.md"));

  const lesson1 = findLesson(course, "001");
  assert.ok(lesson1 !== undefined);
  const [seedBecomesPlan, keptPlan] = lessonExamples(lesson1);
  assert.ok(seedBecomesPlan !== undefined && keptPlan !== undefined);
  const notYet = await ok(host, "tutor_mark_example", { example: keptPlan.key, status: "not-yet", note: "Plan was rewritten." }, coach1);
  assert.match(notYet, /::tutor-progress\{kind="not-yet"/);
  await ok(host, "tutor_mark_example", { example: seedBecomesPlan.key, status: "passing", evidence: "$ ./factory\nplan written" }, coach1);
  const rulePassing = await ok(host, "tutor_mark_example", { example: keptPlan.key, status: "passing", evidence: "$ ./factory\nplan kept" }, coach1);
  assert.match(rulePassing, /::tutor-progress\{kind="rule-passing" title="The planner writes a plan" passed="2" total="2"/);

  const progress1 = await readFile(join(root, "spec/PROGRESS.yaml"), "utf8");
  assert.match(progress1, /^iteration: "001"\n/);
  assert.match(progress1, /evidence: \|-?\n {6}\$ \.\/factory\n {6}plan written/);

  const detail = (await host.harness.behavior.callRpc("getLessonDetail", { lessonId: "001" })) as LessonDetail;
  assert.equal(detail.progress[seedBecomesPlan.key]?.status, "passing");
  assert.equal(detail.coachThreadId, coach1);

  await ok(host, "tutor_complete_iteration", { iteration: "001", summary: "It plans." }, coach1);
  assert.equal(await readFile(join(root, "spec/ITERATION"), "utf8"), "001 Done\n");

  // Lesson 2: the unchanged Example carries over; the reworded one does not.
  const coach2 = ((await host.harness.behavior.callRpc("startNextLesson", { lessonId: "002" })) as { threadId: string }).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "002" }, coach2);
  const lesson2 = findLesson(course, "002");
  assert.ok(lesson2 !== undefined);
  const [carried, reworded] = lessonExamples(lesson2);
  assert.ok(carried !== undefined && reworded !== undefined);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.current?.lessonId, "002");
  assert.equal(overview.current?.iterationStatus, "WIP");
  assert.equal(overview.current?.counts.passing, 1);
  assert.equal(overview.current?.focus, lesson2.suggestedRuleOrder[0]);
  const progress2 = await readFile(join(root, "spec/PROGRESS.yaml"), "utf8");
  assert.match(progress2, new RegExp(`${carried.key}:\\n {4}status: passing\\n[\\s\\S]*carriedFrom: "001"`));
  const [current2, history2 = ""] = progress2.split(/^history:\n/m);
  assert.doesNotMatch(current2 ?? "", new RegExp(reworded.key));
  assert.deepEqual((await readdir(join(root, "spec/features"))).sort(), ["planning.feature", "validation.feature"]);

  // Lesson 1 stays truthful after moving on: its record moved into the history, without evidence.
  assert.match(history2, /^ {2}"001":\n {4}adopted: /m);
  assert.doesNotMatch(history2, /evidence/);
  const done1 = (await host.harness.behavior.callRpc("getLessonDetail", { lessonId: "001" })) as LessonDetail;
  assert.equal(done1.status, "done");
  assert.equal(done1.progress[keptPlan.key]?.status, "passing");
  const completion1 = (await host.harness.behavior.callRpc("getCompletion", { lessonId: "001" })) as Completion;
  assert.equal(completion1.counts.passing, 2);
  assert.equal(completion1.summary, "It plans.");
  assert.equal(completion1.next?.status, "current");
});

async function adoptedCoach(host: TutorHost): Promise<{ coach: string; rule: string }> {
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const status = await ok(host, "tutor_status", {}, coach);
  const rule = /^● (\S+) —/m.exec(status)?.[1];
  assert.ok(rule !== undefined, status);
  return { coach, rule };
}

type Tab = { id: string; kind: string; pluginId?: string; actionId?: string; title?: string; paramsJson?: string | null };

function sideChatTabsOf(host: TutorHost, coach: string): Tab[] {
  return (host.tabs.get(coach)?.tabs ?? []).filter((tab) => (tab as Tab).pluginId === "side-chat") as Tab[];
}

test("tutor_side_chat forks the coach thread as a hidden side chat and adds BB's Side chat tab", async (t) => {
  const { host } = await setup(t);
  const { coach, rule } = await adoptedCoach(host);
  host.tabs.set(coach, { revision: 4, tabs: [{ id: "thread-info:thread-info:none", kind: "thread-info" }] });

  const started = await ok(host, "tutor_side_chat", { title: "Why an outline?", prompt: "Why is there an outline?", rule }, coach);
  const [fork] = host.harness.inspection.sdk.callsTo("threads.fork")[0] as [Record<string, unknown>];
  assert.deepEqual(
    { ...fork, agentContextSeed: undefined },
    {
      sourceThreadId: coach,
      lifecycleOwnerThreadId: coach,
      visibility: "hidden",
      title: "Why an outline?",
      pluginMetadata: { course: "software-factory", lesson: "000", role: "sideChat", ruleKey: rule },
      origin: "plugin",
      originPluginId: "tutor",
      agentContextSeed: undefined,
    },
  );
  const seed = fork.agentContextSeed as { type: string; text: string; mentions: unknown[]; visibility: string }[];
  assert.equal(seed.length, 1);
  assert.deepEqual([seed[0]?.type, seed[0]?.visibility, seed[0]?.mentions], ["text", "agent-only", []]);
  assert.match(seed[0]?.text ?? "", /The student's question, which the coach moved here: Why is there an outline\?/);

  const sideChat = host.threads.find((thread) => thread.sourceThreadId === coach);
  assert.ok(sideChat !== undefined);
  assert.match(started, new RegExp(`Started side chat ${sideChat.id}`));
  const stored = host.tabs.get(coach);
  assert.equal(stored?.revision, 5);
  assert.equal(stored?.tabs[0]?.kind, "thread-info", "BB's own tabs stay");
  const [tab] = sideChatTabsOf(host, coach);
  assert.ok(tab !== undefined);
  const paramsJson = JSON.stringify({ threadId: sideChat.id, sourceThreadId: coach, sourceMessageText: tab.paramsJson === undefined ? "" : JSON.parse(tab.paramsJson ?? "{}").sourceMessageText, sourceSeqEnd: null });
  assert.deepEqual(tab, {
    id: `plugin-panel:${encodeURIComponent(`side-chat:side-chat:${paramsJson}`)}:none`,
    kind: "plugin-panel",
    pluginId: "side-chat",
    actionId: "side-chat",
    title: "Side chat",
    paramsJson,
  });

  // A side chat can mark Examples but never moves the focus; the coach thread can.
  const refused = await tool(host, "tutor_focus_rule", { rule }, sideChat.id);
  assert.ok(isError(refused) && /Only the coach thread moves the focus/.test(text(refused)));
  await ok(host, "tutor_focus_rule", { rule }, coach);

  const context = (await host.harness.behavior.callRpc("getThreadContext", { threadId: sideChat.id })) as {
    thread: { role: string; ruleKey: string; coachThreadId: string } | null;
  };
  assert.deepEqual([context.thread?.role, context.thread?.ruleKey, context.thread?.coachThreadId], ["sideChat", rule, coach]);
  host.addThread({ id: "thr_foreign" });
  assert.deepEqual(await host.harness.behavior.callRpc("getThreadContext", { threadId: "thr_foreign" }), { thread: null });
});

test("a side chat never counts as the coach thread, even when its metadata says it is", async (t) => {
  const { host } = await setup(t);
  const { coach } = await adoptedCoach(host);
  // A fork made after the coach, claiming to be a coach thread: the newest "coach" would otherwise win.
  host.addThread({
    id: "thr_claims_main",
    originKind: "fork",
    originPluginId: "tutor",
    sourceThreadId: coach,
    visibility: "hidden",
    metadata: { course: "software-factory", lesson: "000", role: "coach" },
  });
  assert.deepEqual(await openCoach(host, "000"), { threadId: coach, created: false });
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.current?.coachThreadId, coach);
  assert.equal(overview.lessons.find((lesson) => lesson.id === "000")?.coachThreadId, coach);
  assert.deepEqual(
    overview.threads.map((thread) => [thread.id, thread.role, thread.coachThreadId]).sort(),
    [
      [coach, "coach", coach],
      ["thr_claims_main", "sideChat", coach],
    ].sort(),
  );
  const refused = await tool(host, "tutor_focus_rule", { rule: "tutor/x" }, "thr_claims_main");
  assert.ok(isError(refused) && /Only the coach thread moves the focus/.test(text(refused)));
});

test("a side chat BB made of a coach thread can mark Examples; a visible fork or a fork of a side chat cannot", async (t) => {
  const { sandbox, host } = await setup(t);
  const { coach, rule } = await adoptedCoach(host);
  const bbFork = (id: string, source: string, visibility: "hidden" | "visible" = "hidden") =>
    host.addThread({ id, originKind: "fork", originPluginId: "side-chat", sourceThreadId: source, visibility });
  const signals = host.harness.inspection.realtimeSignals.length;
  const created = bbFork("thr_bb_side", coach);
  await host.harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ ...created }) });
  assert.deepEqual(host.harness.inspection.realtimeSignals.slice(signals).map((signal) => signal.payload), [{ reason: "threads", lessonId: "000" }]);
  bbFork("thr_bb_visible", coach, "visible");
  bbFork("thr_bb_nested", "thr_bb_side");

  const example = lessonExamples(findLesson(sandbox.course, "000") ?? assert.fail("no 000"))[0];
  assert.ok(example !== undefined);
  await ok(host, "tutor_mark_example", { example: example.key, status: "skipped" }, "thr_bb_side");
  const refused = await tool(host, "tutor_focus_rule", { rule }, "thr_bb_side");
  assert.ok(isError(refused) && /Only the coach thread moves the focus/.test(text(refused)));
  for (const id of ["thr_bb_visible", "thr_bb_nested"]) {
    assert.equal(text(await tool(host, "tutor_status", {}, id)), NOT_A_TUTOR_THREAD, id);
  }
  const context = (await host.harness.behavior.callRpc("getThreadContext", { threadId: "thr_bb_side" })) as {
    thread: { lessonId: string; role: string; ruleKey: string | null; coachThreadId: string } | null;
  };
  assert.deepEqual(context.thread && { ...context.thread, id: undefined, title: undefined }, {
    id: undefined,
    title: undefined,
    lessonId: "000",
    role: "sideChat",
    ruleKey: null,
    coachThreadId: coach,
    fork: true,
  });
  // The overview lists it under its lesson, as Tutor lists its own side chats.
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(
    overview.threads.filter((thread) => thread.id === "thr_bb_side").map((thread) => [thread.lessonId, thread.coachThreadId, thread.fork]),
    [["000", coach, true]],
  );
  assert.ok(!overview.threads.some((thread) => thread.id === "thr_bb_visible" || thread.id === "thr_bb_nested"));
  // Side chats BB made count on the completion page.
  for (const lesson of lessonExamples(findLesson(sandbox.course, "000") ?? assert.fail("no 000"))) {
    await ok(host, "tutor_mark_example", { example: lesson.key, status: "skipped" }, coach);
  }
  await ok(host, "tutor_complete_iteration", { iteration: "000", summary: "Done." }, coach);
  const completion = (await host.harness.behavior.callRpc("getCompletion", { lessonId: "000" })) as Completion;
  assert.equal(completion.sideChats, 1);
});

test("Ask a side question: startSideChat forks a side chat, retrying the tab write when another client wrote first", async (t) => {
  const { host } = await setup(t);
  await assert.rejects(host.harness.behavior.callRpc("startSideChat", { lessonId: "000", ruleKey: null }), /Start with your coach for lesson 000 first/);
  const { coach, rule } = await adoptedCoach(host);
  host.tabConflicts.remaining = 2;
  const started = (await host.harness.behavior.callRpc("startSideChat", { lessonId: "000", ruleKey: rule })) as {
    coachThreadId: string;
    sideChatId: string;
  };
  assert.equal(started.coachThreadId, coach);
  const sideChat = host.threads.find((thread) => thread.id === started.sideChatId);
  assert.deepEqual([sideChat?.visibility, sideChat?.originKind, sideChat?.sourceThreadId], ["hidden", "fork", coach]);
  assert.match(sideChat?.seed ?? "", /Wait for the student's question/);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.tabs.update").length, 3);
  const tabs = host.tabs.get(coach)?.tabs ?? [];
  assert.deepEqual(tabs.map((tab) => tab.kind), ["new-tab", "new-tab", "plugin-panel"], "the other client's tabs survive");
  assert.ok(host.harness.inspection.realtimeSignals.some((signal) => (signal.payload as { reason: string }).reason === "threads"));

  // ensureSideChatTab puts a closed tab back, once.
  host.tabs.set(coach, { revision: 9, tabs: [] });
  assert.deepEqual(await host.harness.behavior.callRpc("ensureSideChatTab", { sideChatId: started.sideChatId }), { coachThreadId: coach });
  assert.deepEqual(await host.harness.behavior.callRpc("ensureSideChatTab", { sideChatId: started.sideChatId }), { coachThreadId: coach });
  assert.equal(sideChatTabsOf(host, coach).length, 1);
  assert.match(sideChatTabsOf(host, coach)[0]?.paramsJson ?? "", /A side question about the Rule/);

  // ...and does the same for a side chat BB made, which it recognises in either tab shape.
  host.addThread({
    id: "thr_bb_side",
    originKind: "fork",
    originPluginId: "side-chat",
    sourceThreadId: coach,
    visibility: "hidden",
    titleFallback: "Replying to this earlier message in the conversation: the outline is…",
  });
  host.tabs.set(coach, { revision: 12, tabs: [{ id: "legacy", kind: "side-chat", threadId: "thr_bb_side", title: "Side chat", sourceMessageText: "", sourceSeqEnd: null }] });
  await host.harness.behavior.callRpc("ensureSideChatTab", { sideChatId: "thr_bb_side" });
  assert.equal(host.tabs.get(coach)?.revision, 12, "a legacy side-chat tab already shows it");
  host.tabs.set(coach, { revision: 13, tabs: [] });
  await host.harness.behavior.callRpc("ensureSideChatTab", { sideChatId: "thr_bb_side" });
  assert.match(sideChatTabsOf(host, coach)[0]?.paramsJson ?? "", /"sourceMessageText":"the outline is…"/);

  host.addThread({ id: "thr_plain" });
  await assert.rejects(host.harness.behavior.callRpc("ensureSideChatTab", { sideChatId: "thr_plain" }), /isn't a side chat/);
  await assert.rejects(host.harness.behavior.callRpc("ensureSideChatTab", { sideChatId: coach }), /isn't a side chat/);
});

test("a tab write that keeps conflicting fails after a few tries instead of looping", async (t) => {
  const { host } = await setup(t);
  const { rule } = await adoptedCoach(host);
  host.tabConflicts.remaining = 10;
  await assert.rejects(host.harness.behavior.callRpc("startSideChat", { lessonId: "000", ruleKey: rule }), /Thread tabs changed/);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.tabs.update").length, 3);
});

test("a provider that cannot fork gets a clear error, and no side thread is spawned instead", async (t) => {
  const { host } = await setup(t);
  const { coach, rule } = await adoptedCoach(host);
  host.forkRefusal.message = "Provider scripted does not support thread forks";
  await assert.rejects(
    host.harness.behavior.callRpc("startSideChat", { lessonId: "000", ruleKey: rule }),
    /can't open side chats: its provider can't fork a conversation/,
  );
  const result = await tool(host, "tutor_side_chat", { title: "t", prompt: "p" }, coach);
  assert.ok(isError(result) && /can't open side chats/.test(text(result)));
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1, "only the coach thread was ever spawned");
  assert.equal(host.tabs.get(coach), undefined);
});

test("focusing a Rule records it on the coach thread, so the outline can jump to its section", async (t) => {
  const { host } = await setup(t);
  const { coach, rule } = await adoptedCoach(host);
  const before = (await host.harness.behavior.callRpc("getLessonDetail", { lessonId: "000" })) as LessonDetail;
  assert.deepEqual(before.reachedRules, [], "adopting sets a focus but opens no section");
  const focused = await ok(host, "tutor_focus_rule", { rule }, coach);
  assert.match(focused, /start your next message with this line/);
  await ok(host, "tutor_focus_rule", { rule }, coach);
  assert.deepEqual(host.threads.find((thread) => thread.id === coach)?.metadata.reachedRules, [rule]);
  const detail = (await host.harness.behavior.callRpc("getLessonDetail", { lessonId: "000" })) as LessonDetail;
  assert.deepEqual(detail.reachedRules, [rule]);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  const rules = overview.lessons.find((lesson) => lesson.id === "000")?.outline.flatMap((feature) => feature.rules) ?? [];
  assert.deepEqual(rules.filter((candidate) => candidate.reached).map((candidate) => candidate.key), [rule]);
  // The metadata is untrusted: junk in it is ignored, not fatal.
  const thread = host.threads.find((candidate) => candidate.id === coach);
  assert.ok(thread !== undefined);
  thread.metadata.reachedRules = [rule, 42, "not a key", { x: 1 }];
  const again = (await host.harness.behavior.callRpc("getLessonDetail", { lessonId: "000" })) as LessonDetail;
  assert.deepEqual(again.reachedRules, [rule]);
});

test("redirectFocus asks the coach thread to move, as the student", async (t) => {
  const { sandbox, host } = await setup(t);
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const rule = findLesson(sandbox.course, "000")?.suggestedRuleOrder[0];
  assert.ok(rule !== undefined);
  assert.deepEqual(await host.harness.behavior.callRpc("redirectFocus", { lessonId: "000", ruleKey: rule }), { threadId: coach });
  assert.equal(host.sent.length, 1);
  assert.match(host.sent[0]?.text ?? "", /tutor_focus_rule/);
});

test("the dispatch guard holds a Tutor turn while a sibling Tutor thread runs", async (t) => {
  const { host } = await setup(t);
  const guard = host.harness.inspection.registrations.hooks["message.dispatch"];
  assert.ok(guard !== null);
  const coach = (await openCoach(host, "000")).threadId;
  host.addThread({ id: "thr_side", originPluginId: "tutor", parentThreadId: coach, title: "Side" });
  host.addThread({ id: "thr_plain" });
  host.addThread({ id: "thr_bb_side", originKind: "fork", originPluginId: "side-chat", sourceThreadId: coach, visibility: "hidden", titleFallback: "Replying to…" });
  host.addThread({ id: "thr_tutor_side", originKind: "fork", originPluginId: "tutor", sourceThreadId: coach, visibility: "hidden", title: "Side question" });
  const attempt = (id: string) => {
    const thread = host.threads.find((candidate) => candidate.id === id);
    assert.ok(thread !== undefined);
    return guard(
      makeMessageDispatchHookContext({
        thread: makeThreadResponse({ ...thread, projectId: PROJECT_ID }),
        project: { id: PROJECT_ID },
      }),
    );
  };

  assert.deepEqual(await attempt("thr_side"), { action: "proceed" });
  host.running.add(coach);
  for (const id of ["thr_side", "thr_bb_side", "thr_tutor_side"]) {
    const held = await attempt(id);
    assert.equal(held.action, "wait", id);
    assert.match(held.action === "wait" ? held.reason : "", /Coach · Lesson 000/);
  }
  assert.deepEqual(await attempt("thr_plain"), { action: "proceed" });
  assert.deepEqual(await attempt(coach), { action: "proceed" });

  // A running side chat, BB's or Tutor's (both hidden), holds the coach thread's turn.
  host.running.delete(coach);
  for (const id of ["thr_bb_side", "thr_tutor_side"]) {
    host.running.add(id);
    const held = await attempt(coach);
    assert.equal(held.action, "wait", id);
    host.running.delete(id);
  }

  await host.harness.behavior.emitThreadEvent("thread.idle", {
    thread: makeThreadResponse({ id: coach, originPluginId: "tutor", projectId: PROJECT_ID }),
    lastAssistantText: null,
  });
  assert.ok(host.harness.inspection.recheckCount >= 1);
});

test("a Tutor thread going idle re-reads the factory and signals changes made outside the tools", async (t) => {
  const { sandbox, host } = await setup(t);
  await host.harness.behavior.callRpc("getOverview", null);
  const before = host.harness.inspection.realtimeSignals.length;
  await writeFile(join(sandbox.factoryRoot, "PROGRESS-ignored.txt"), "");
  const idle = { thread: makeThreadResponse({ id: "thr_x", originPluginId: "tutor", projectId: PROJECT_ID }), lastAssistantText: null };
  await host.harness.behavior.emitThreadEvent("thread.idle", idle);
  assert.equal(host.harness.inspection.realtimeSignals.length, before);

  await host.rt.store.writeIteration(sandbox.factoryRoot, { iteration: "001", status: "WIP" });
  await host.harness.behavior.emitThreadEvent("thread.idle", idle);
  const last = host.harness.inspection.realtimeSignals.at(-1);
  assert.deepEqual([last?.channel, last?.payload], ["state-changed", { reason: "iteration", lessonId: "001" }]);
});

test("first run: candidates, confirmation and a course that will not load", async (t) => {
  const { sandbox, host } = await setup(t, {});
  const unbound = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(unbound.binding, { status: "unbound" });
  assert.equal(unbound.current, null);
  const { projects } = (await host.harness.behavior.callRpc("listCandidateProjects", null)) as {
    projects: { projectId: string; qualifies: boolean }[];
  };
  assert.deepEqual(projects.map((project) => project.projectId), [PROJECT_ID]);
  await assert.rejects(host.harness.behavior.callRpc("confirmFactory", { projectId: "prj_gone" }), /no folder/);
  const binding = await host.harness.behavior.callRpc("confirmFactory", { projectId: PROJECT_ID });
  assert.deepEqual(binding, { status: "bound", projectId: PROJECT_ID, projectName: "my-factory", root: sandbox.factoryRoot });
  assert.ok(host.harness.inspection.realtimeSignals.some((signal) => (signal.payload as { reason: string }).reason === "binding"));
  const bound = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(bound.current?.iterationStatus, "not-started");
});

test("concurrent tool calls never lose each other's progress", async (t) => {
  const { sandbox, host } = await setup(t);
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const lesson0 = findLesson(sandbox.course, "000");
  assert.ok(lesson0 !== undefined);
  const examples = lessonExamples(lesson0);
  await Promise.all(
    examples.map((example) => ok(host, "tutor_mark_example", { example: example.key, status: "skipped" }, coach)),
  );
  const detail = (await host.harness.behavior.callRpc("getLessonDetail", { lessonId: "000" })) as LessonDetail;
  assert.deepEqual(
    examples.filter((example) => detail.progress[example.key]?.status !== "skipped").map((example) => example.key),
    [],
  );
});

test("concurrent requests to open a lesson's coach spawn one coach thread", async (t) => {
  const { host } = await setup(t);
  const opened = await Promise.all([openCoach(host, "000"), openCoach(host, "000"), openCoach(host, "000")]);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  assert.equal(new Set(opened.map((result) => result.threadId)).size, 1);
  assert.deepEqual(opened.map((result) => result.created).sort(), [false, false, true]);
});

test("concurrent starts of the next lesson spawn one coach thread", async (t) => {
  const { host } = await setup(t);
  const start = () => host.harness.behavior.callRpc("startNextLesson", { lessonId: "001" }) as Promise<{ threadId: string }>;
  const started = await Promise.all([start(), start()]);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  assert.equal(started[0]?.threadId, started[1]?.threadId);
});

test("confirmFactory refuses the course checkout, a folder inside it, or one holding it", async (t) => {
  const sandbox = await makeSandbox();
  t.after(() => sandbox.cleanup());
  const inside = join(sandbox.course.root, "docs");
  const linked = join(sandbox.root, "linked-course");
  await symlink(sandbox.course.root, linked);
  for (const root of [sandbox.course.root, inside, sandbox.root, linked]) {
    const host = await makeTutorHost(sandbox.course, root, { coursePath: sandbox.course.root });
    await assert.rejects(host.harness.behavior.callRpc("confirmFactory", { projectId: PROJECT_ID }), /course/, root);
    assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
    await host.harness.lifecycle.dispose();
  }
  const factory = join(sandbox.root, "tutorial-factory");
  await mkdir(factory);
  const host = await makeTutorHost(sandbox.course, factory, { coursePath: sandbox.course.root });
  t.after(() => host.harness.lifecycle.dispose());
  assert.equal(((await host.harness.behavior.callRpc("confirmFactory", { projectId: PROJECT_ID })) as { status: string }).status, "bound");
});

test("a stored binding that now leads into the course is treated as missing: no coach, no writes", async (t) => {
  const sandbox = await makeSandbox();
  t.after(() => sandbox.cleanup());
  const link = join(sandbox.root, "factory-link");
  await symlink(sandbox.course.root, link);
  const host = await makeTutorHost(sandbox.course, link, { factoryProject: PROJECT_ID, coursePath: sandbox.course.root });
  t.after(() => host.harness.lifecycle.dispose());
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.binding.status, "missing");
  await assert.rejects(host.harness.behavior.callRpc("openCoach", { lessonId: "000" }));
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.equal(await readdir(join(sandbox.course.root, "spec")).catch(() => null), null, "nothing written into the course");
});
