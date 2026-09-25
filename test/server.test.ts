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
import { findHomework, homeworkExamples } from "../shared/derive.ts";
import type { Completion, Lesson, Overview } from "../shared/rpc.ts";
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

async function openCoach(host: TutorHost, homeworkId: string) {
  return (await host.harness.behavior.callRpc("openCoach", { homeworkId })) as { threadId: string; created: boolean };
}

test("configure offers the tools, skill and instructions only to Tutor-spawned threads", async (t) => {
  const { host } = await setup(t);
  const mine = await host.harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({
      origin: { kind: null, pluginId: "tutor" },
      pluginMetadata: { course: "software-factory", iteration: "002", role: "main" },
    }),
  );
  assert.deepEqual(mine.tools.map((entry) => entry.name).sort(), [...ALL_TOOL_NAMES].sort());
  assert.deepEqual(mine.skills, ["tutor"]);
  assert.match(mine.instructions ?? "", /main coach thread for Homework 002/);

  for (const origin of [
    { kind: null, pluginId: null },
    { kind: "fork" as const, pluginId: "side-chat" },
  ]) {
    const other = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ origin }));
    assert.deepEqual([other.tools, other.skills, other.instructions], [[], [], null]);
  }
});

test("every tool refuses threads Tutor did not spawn, whatever their metadata says", async (t) => {
  const { sandbox, host } = await setup(t);
  host.addThread({ id: "thr_foreign", metadata: { course: "software-factory", iteration: "000", role: "main" } });
  host.addThread({ id: "thr_elsewhere", originPluginId: "tutor", projectId: "prj_other" });
  const inputs: Record<string, unknown> = {
    tutor_status: {},
    tutor_focus_rule: { rule: "a/b" },
    tutor_mark_example: { example: "a/b/c", status: "skipped" },
    tutor_adopt_iteration: { iteration: "000" },
    tutor_complete_iteration: { iteration: "000", summary: "x" },
    tutor_side_thread: { title: "t", prompt: "p" },
  };
  for (const name of ALL_TOOL_NAMES) {
    const result = await tool(host, name, inputs[name], "thr_foreign");
    assert.ok(isError(result), name);
    assert.equal(text(result), NOT_A_TUTOR_THREAD);
    const elsewhere = await tool(host, name, inputs[name], "thr_elsewhere");
    assert.ok(isError(elsewhere) && /not in the student's factory project/.test(text(elsewhere)), name);
  }
  assert.deepEqual(await readdir(sandbox.factoryRoot), []);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
});

test("tools refuse while no factory project is bound", async (t) => {
  const { host } = await setup(t, {});
  host.addThread({ id: "thr_tutor", originPluginId: "tutor" });
  const result = await tool(host, "tutor_status", {}, "thr_tutor");
  assert.ok(isError(result) && /No factory project/.test(text(result)));
});

test("openCoach spawns one main thread per homework in the factory, then finds it again", async (t) => {
  const { sandbox, host } = await setup(t);
  const first = await openCoach(host, "000");
  assert.equal(first.created, true);
  const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.equal(spawn.title, "Coach · Homework 000");
  assert.equal(spawn.projectId, PROJECT_ID);
  assert.deepEqual(spawn.pluginMetadata, { course: "software-factory", iteration: "000", role: "main" });
  assert.deepEqual(spawn.environment, {
    type: "host",
    hostId: "host_1",
    workspace: { type: "unmanaged", path: sandbox.factoryRoot },
  });
  assert.match(String(spawn.prompt), /tutor_adopt_iteration with iteration "000"/);

  assert.deepEqual(await openCoach(host, "000"), { threadId: first.threadId, created: false });
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  await assert.rejects(openCoach(host, "002"), /has not started yet/);
  assert.ok(host.harness.inspection.realtimeSignals.some((signal) => (signal.payload as { reason: string }).reason === "threads"));
});

test("the coach tools round-trip progress through the factory repo and carry passing Examples over", async (t) => {
  const { sandbox, host } = await setup(t);
  const root = sandbox.factoryRoot;
  const course = sandbox.course;

  // Homework 0: tracked in PROGRESS.yaml only.
  const coach0 = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach0);
  assert.deepEqual((await readdir(join(root, "spec"))).sort(), ["PROGRESS.yaml"]);
  const homework0 = findHomework(course, "000");
  assert.ok(homework0 !== undefined);
  for (const example of homeworkExamples(homework0)) {
    await ok(host, "tutor_mark_example", { example: example.key, status: "passing", evidence: "seen in the rail" }, coach0);
  }
  await ok(host, "tutor_complete_iteration", { iteration: "000", summary: "You know your way around." }, coach0);

  // Homework 1: adopted into spec/ like coach-me, then passed.
  const coach1 = ((await host.harness.behavior.callRpc("startNextHomework", { homeworkId: "001" })) as { threadId: string }).threadId;
  assert.match(host.threads.find((thread) => thread.id === coach1)?.prompt ?? "", /tutor_adopt_iteration with iteration "001"/);
  const adopted = await ok(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  assert.match(adopted, /Adopt spec for iteration 001/);
  assert.equal(await readFile(join(root, "spec/ITERATION"), "utf8"), "001 WIP\n");
  assert.deepEqual((await readdir(join(root, "spec/features"))).sort(), ["planning.feature"]);
  assert.ok((await readdir(join(root, "seeds"))).includes("tetris.md"));

  const homework1 = findHomework(course, "001");
  assert.ok(homework1 !== undefined);
  const [seedBecomesPlan, keptPlan] = homeworkExamples(homework1);
  assert.ok(seedBecomesPlan !== undefined && keptPlan !== undefined);
  const notYet = await ok(host, "tutor_mark_example", { example: keptPlan.key, status: "not-yet", note: "Plan was rewritten." }, coach1);
  assert.match(notYet, /::tutor-progress\{kind="not-yet"/);
  await ok(host, "tutor_mark_example", { example: seedBecomesPlan.key, status: "passing", evidence: "$ ./factory\nplan written" }, coach1);
  const rulePassing = await ok(host, "tutor_mark_example", { example: keptPlan.key, status: "passing", evidence: "$ ./factory\nplan kept" }, coach1);
  assert.match(rulePassing, /::tutor-progress\{kind="rule-passing" title="The planner writes a plan" passed="2" total="2"/);

  const progress1 = await readFile(join(root, "spec/PROGRESS.yaml"), "utf8");
  assert.match(progress1, /^iteration: "001"\n/);
  assert.match(progress1, /evidence: \|-?\n {6}\$ \.\/factory\n {6}plan written/);

  const lesson = (await host.harness.behavior.callRpc("getLesson", { homeworkId: "001" })) as Lesson;
  assert.equal(lesson.progress[seedBecomesPlan.key]?.status, "passing");
  assert.equal(lesson.coachThreadId, coach1);

  await ok(host, "tutor_complete_iteration", { iteration: "001", summary: "It plans." }, coach1);
  assert.equal(await readFile(join(root, "spec/ITERATION"), "utf8"), "001 Done\n");

  // Homework 2: the unchanged Example carries over; the reworded one does not.
  const coach2 = ((await host.harness.behavior.callRpc("startNextHomework", { homeworkId: "002" })) as { threadId: string }).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "002" }, coach2);
  const homework2 = findHomework(course, "002");
  assert.ok(homework2 !== undefined);
  const [carried, reworded] = homeworkExamples(homework2);
  assert.ok(carried !== undefined && reworded !== undefined);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.current?.homeworkId, "002");
  assert.equal(overview.current?.iterationStatus, "WIP");
  assert.equal(overview.current?.counts.passing, 1);
  assert.equal(overview.current?.focus, homework2.suggestedRuleOrder[0]);
  const progress2 = await readFile(join(root, "spec/PROGRESS.yaml"), "utf8");
  assert.match(progress2, new RegExp(`${carried.key}:\\n {4}status: passing\\n[\\s\\S]*carriedFrom: "001"`));
  const [current2, history2 = ""] = progress2.split(/^history:\n/m);
  assert.doesNotMatch(current2 ?? "", new RegExp(reworded.key));
  assert.deepEqual((await readdir(join(root, "spec/features"))).sort(), ["planning.feature", "validation.feature"]);

  // Homework 1 stays truthful after moving on: its record moved into the history, without evidence.
  assert.match(history2, /^ {2}"001":\n {4}adopted: /m);
  assert.doesNotMatch(history2, /evidence/);
  const done1 = (await host.harness.behavior.callRpc("getLesson", { homeworkId: "001" })) as Lesson;
  assert.equal(done1.status, "done");
  assert.equal(done1.progress[keptPlan.key]?.status, "passing");
  const completion1 = (await host.harness.behavior.callRpc("getCompletion", { homeworkId: "001" })) as Completion;
  assert.equal(completion1.counts.passing, 2);
  assert.equal(completion1.summary, "It plans.");
  assert.equal(completion1.next?.status, "current");
});

test("side threads hang off the main thread, and only the main thread moves the cursor", async (t) => {
  const { host } = await setup(t);
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const status = await ok(host, "tutor_status", {}, coach);
  const rule = /^● (\S+) —/m.exec(status)?.[1];
  assert.ok(rule !== undefined, status);

  await ok(host, "tutor_side_thread", { title: "Why a rail?", prompt: "Why is there a rail?", rule }, coach);
  const side = host.threads.find((thread) => thread.parentThreadId === coach);
  assert.ok(side !== undefined);
  assert.equal(side.title, "Why a rail?");
  assert.deepEqual(side.metadata, { course: "software-factory", iteration: "000", role: "side", ruleKey: rule });

  const refused = await tool(host, "tutor_focus_rule", { rule }, side.id);
  assert.ok(isError(refused) && /Only the main coach thread/.test(text(refused)));
  await ok(host, "tutor_focus_rule", { rule }, coach);

  const context = (await host.harness.behavior.callRpc("getThreadContext", { threadId: side.id })) as {
    thread: { role: string; ruleKey: string } | null;
  };
  assert.deepEqual([context.thread?.role, context.thread?.ruleKey], ["side", rule]);
  host.addThread({ id: "thr_foreign" });
  assert.deepEqual(await host.harness.behavior.callRpc("getThreadContext", { threadId: "thr_foreign" }), { thread: null });
});

test("redirectFocus asks the main coach thread to move, as the student", async (t) => {
  const { sandbox, host } = await setup(t);
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const rule = findHomework(sandbox.course, "000")?.suggestedRuleOrder[0];
  assert.ok(rule !== undefined);
  assert.deepEqual(await host.harness.behavior.callRpc("redirectFocus", { homeworkId: "000", ruleKey: rule }), { threadId: coach });
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
  const attempt = (id: string, originPluginId: string | null) =>
    guard(
      makeMessageDispatchHookContext({
        thread: makeThreadResponse({ id, originPluginId, projectId: PROJECT_ID }),
        project: { id: PROJECT_ID },
      }),
    );

  assert.deepEqual(await attempt("thr_side", "tutor"), { action: "proceed" });
  host.running.add(coach);
  const held = await attempt("thr_side", "tutor");
  assert.equal(held.action, "wait");
  assert.match(held.action === "wait" ? held.reason : "", /Coach · Homework 000/);
  assert.deepEqual(await attempt("thr_plain", null), { action: "proceed" });
  assert.deepEqual(await attempt(coach, "tutor"), { action: "proceed" });

  host.running.delete(coach);
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
  assert.deepEqual([last?.channel, last?.payload], ["state-changed", { reason: "iteration", homeworkId: "001" }]);
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
  const homework0 = findHomework(sandbox.course, "000");
  assert.ok(homework0 !== undefined);
  const examples = homeworkExamples(homework0);
  await Promise.all(
    examples.map((example) => ok(host, "tutor_mark_example", { example: example.key, status: "skipped" }, coach)),
  );
  const lesson = (await host.harness.behavior.callRpc("getLesson", { homeworkId: "000" })) as Lesson;
  assert.deepEqual(
    examples.filter((example) => lesson.progress[example.key]?.status !== "skipped").map((example) => example.key),
    [],
  );
});

test("concurrent requests to open a homework's coach spawn one main thread", async (t) => {
  const { host } = await setup(t);
  const opened = await Promise.all([openCoach(host, "000"), openCoach(host, "000"), openCoach(host, "000")]);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  assert.equal(new Set(opened.map((result) => result.threadId)).size, 1);
  assert.deepEqual(opened.map((result) => result.created).sort(), [false, false, true]);
});

test("concurrent starts of the next homework spawn one main thread", async (t) => {
  const { host } = await setup(t);
  const start = () => host.harness.behavior.callRpc("startNextHomework", { homeworkId: "001" }) as Promise<{ threadId: string }>;
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
  await assert.rejects(host.harness.behavior.callRpc("openCoach", { homeworkId: "000" }));
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.equal(await readdir(join(sandbox.course.root, "spec")).catch(() => null), null, "nothing written into the course");
});
