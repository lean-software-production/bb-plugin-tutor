// Tutor's backend end to end against the SDK's fake host: configure scoping,
// tool authorisation, coach thread spawn-or-find, and the PROGRESS.yaml round
// trip through the coach tools, including carry-over on adopt.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import {
  makeMessageDispatchHookContext,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { ALL_TOOL_NAMES } from "../shared/constants.ts";
import { findLesson, lessonExamples } from "../shared/derive.ts";
import { fixtureCourse, fixtureLayoutlessCourse } from "../shared/fixtures.ts";
import type { Completion, LessonDetail, Overview } from "../shared/rpc.ts";
import { NOT_A_TUTOR_THREAD } from "../server/coach/auth.ts";
import { WorkspaceUnreachableError, WriteConflictError, type WorkspaceAccess } from "../server/workspace/access.ts";
import { formatProgress, parseProgress } from "../layouts/progress/progress-yaml.ts";
import { createDiskAccess } from "./helpers/disk-access.ts";
import { emptyGitWorkspace, git, makeFixtureCourseRepo, makeSandbox, makeRepoSandbox, type FixtureCourseRepoOptions, type Sandbox } from "./helpers/disk.ts";
import { allPassing, callTool, makeTutorHost, PROJECT_ID, type TutorHost } from "./helpers/fake-bb.ts";
import { createCourseSource } from "../server/course/index.ts";
import { THREAD_PAGE_SIZE } from "../server/coach/threads.ts";

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

const tool = callTool;

/** Tutor's real built-in course: Lesson 0. */
const builtinCourse = await createCourseSource().loadBuiltin();

async function ok(host: TutorHost, name: string, input: unknown, threadId: string): Promise<string> {
  const result = await tool(host, name, input, threadId);
  assert.ok(!isError(result), `${name} failed: ${text(result)}`);
  return text(result);
}

/** Lesson 0 is the built-in course's; the others are the fixture course's unless `courseId` says otherwise. */
function courseOf(lessonId: string): string {
  return lessonId === "000" ? "tutor" : fixtureCourse.id;
}

async function openCoach(host: TutorHost, lessonId: string, courseId = courseOf(lessonId)) {
  return (await host.harness.behavior.callRpc("openCoach", { courseId, lessonId })) as { threadId: string; created: boolean };
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
    tutor_fetch_course: { course: "software-factory" },
  };
  for (const name of ALL_TOOL_NAMES) {
    const result = await tool(host, name, inputs[name], "thr_foreign");
    assert.ok(isError(result), name);
    assert.equal(text(result), NOT_A_TUTOR_THREAD);
    assert.equal(text(await tool(host, name, inputs[name], "thr_fork_of_plain")), NOT_A_TUTOR_THREAD, name);
    const elsewhere = await tool(host, name, inputs[name], "thr_elsewhere");
    assert.ok(isError(elsewhere) && /not in the student's workspace/.test(text(elsewhere)), name);
  }
  assert.deepEqual(await readdir(sandbox.factoryRoot), []);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.fork").length, 0);
});

test("tools refuse while there is no workspace", async (t) => {
  const { host } = await setup(t, {});
  host.addThread({ id: "thr_tutor", originPluginId: "tutor" });
  const result = await tool(host, "tutor_status", {}, "thr_tutor");
  assert.ok(isError(result) && /No workspace/.test(text(result)));
});

test("openCoach spawns one coach thread per lesson in the factory, then finds it again", async (t) => {
  const { sandbox, host } = await setup(t);
  const first = await openCoach(host, "000");
  assert.equal(first.created, true);
  const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.equal(spawn.title, "Coach · Lesson 000");
  assert.equal(spawn.projectId, PROJECT_ID);
  assert.deepEqual(spawn.pluginMetadata, { course: "tutor", lesson: "000", role: "coach" });
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

test("without a coachProvider setting, a coach thread spawns with no providerId (the Codespace)", async (t) => {
  const { host } = await setup(t);
  await openCoach(host, "000");
  const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.equal("providerId" in spawn, false);
  assert.equal("executionInputSources" in spawn, false);
});

test("a coachProvider setting pins coach threads to that provider explicitly", async (t) => {
  const { host } = await setup(t, { factoryProject: PROJECT_ID, coachProvider: "pi" });
  await openCoach(host, "000");
  const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.equal(spawn.providerId, "pi");
  assert.deepEqual(spawn.executionInputSources, { providerId: "explicit" });
});

test("a coachModel setting pins coach threads to that model explicitly", async (t) => {
  const { host } = await setup(t, { factoryProject: PROJECT_ID, coachProvider: "pi", coachModel: "openrouter/moonshotai/kimi-k2.6" });
  await openCoach(host, "000");
  const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.equal(spawn.providerId, "pi");
  assert.equal(spawn.model, "openrouter/moonshotai/kimi-k2.6");
  assert.deepEqual(spawn.executionInputSources, { providerId: "explicit", model: "explicit" });
});

test("without a coachModel setting, a coach thread spawns with no model", async (t) => {
  const { host } = await setup(t, { factoryProject: PROJECT_ID, coachProvider: "pi" });
  await openCoach(host, "000");
  const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.equal("model" in spawn, false);
});

test("the coach tools round-trip progress through the factory repo and carry passing Examples over", async (t) => {
  const { sandbox, host } = await setup(t);
  const root = sandbox.factoryRoot;
  const course = sandbox.course;

  // Lesson 0: the built-in course, tracked in .tutor/progress.yaml only.
  const coach0 = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach0);
  assert.deepEqual((await readdir(root)).sort(), [".tutor"]);
  assert.deepEqual(await readdir(join(root, ".tutor")), ["progress.yaml"]);
  const lesson0 = findLesson(builtinCourse, "000");
  assert.ok(lesson0 !== undefined);
  for (const example of lessonExamples(lesson0)) {
    await ok(host, "tutor_mark_example", { example: example.key, status: "passing", evidence: "seen in the outline" }, coach0);
  }
  await ok(host, "tutor_complete_iteration", { iteration: "000", summary: "You know your way around." }, coach0);

  // Lesson 1: adopted into spec/ like coach-me, then passed.
  const coach1 = ((await host.harness.behavior.callRpc("startNextLesson", { courseId: "software-factory", lessonId: "001" })) as { threadId: string }).threadId;
  assert.match(host.threads.find((thread) => thread.id === coach1)?.prompt ?? "", /tutor_adopt_iteration with iteration "001"/);
  const adopted = await ok(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  assert.match(adopted, /Adopt spec for iteration 001/);
  assert.equal(await readFile(join(root, "ITERATION"), "utf8"), "001 WIP\n");
  assert.deepEqual((await readdir(join(root, "spec/features"))).sort(), ["planning.feature"]);
  assert.equal(await readFile(join(sandbox.codebaseRoot, "seeds/tetris.md"), "utf8"), findLesson(course, "001")?.seedSpec);
  assert.ok(!(await readdir(root)).includes("seeds"), "the seed goes to ../seeds, not the factory");
  assert.deepEqual((await readdir(join(root, "stand-ins"))).sort(), ["README.md", "plan-alpha-beta"]);

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

  const detail = (await host.harness.behavior.callRpc("getLessonDetail", { courseId: "software-factory", lessonId: "001" })) as LessonDetail;
  assert.equal(detail.progress[seedBecomesPlan.key]?.status, "passing");
  assert.equal(detail.coachThreadId, coach1);

  await ok(host, "tutor_complete_iteration", { iteration: "001", summary: "It plans." }, coach1);
  assert.equal(await readFile(join(root, "ITERATION"), "utf8"), "001 Done\n");

  // Lesson 2: the unchanged Example carries over; the reworded one does not.
  const coach2 = ((await host.harness.behavior.callRpc("startNextLesson", { courseId: "software-factory", lessonId: "002" })) as { threadId: string }).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "002" }, coach2);
  const lesson2 = findLesson(course, "002");
  assert.ok(lesson2 !== undefined);
  const [carried, reworded] = lessonExamples(lesson2);
  assert.ok(carried !== undefined && reworded !== undefined);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.courses[1]?.current?.lessonId, "002");
  assert.equal(overview.courses[1]?.current?.iterationStatus, "WIP");
  assert.equal(overview.courses[1]?.current?.counts.passing, 1);
  assert.equal(overview.courses[1]?.current?.focus, lesson2.suggestedRuleOrder[0]);
  const progress2 = await readFile(join(root, "spec/PROGRESS.yaml"), "utf8");
  assert.match(progress2, new RegExp(`${carried.key}:\\n {4}status: passing\\n[\\s\\S]*carriedFrom: "001"`));
  const [current2, history2 = ""] = progress2.split(/^history:\n/m);
  assert.doesNotMatch(current2 ?? "", new RegExp(reworded.key));
  assert.deepEqual((await readdir(join(root, "spec/features"))).sort(), ["planning.feature", "validation.feature"]);

  // Lesson 1 stays truthful after moving on: its record moved into the history, without evidence.
  assert.match(history2, /^ {2}"001":\n {4}adopted: /m);
  assert.doesNotMatch(history2, /evidence/);
  const done1 = (await host.harness.behavior.callRpc("getLessonDetail", { courseId: "software-factory", lessonId: "001" })) as LessonDetail;
  assert.equal(done1.status, "done");
  assert.equal(done1.progress[keptPlan.key]?.status, "passing");
  const completion1 = (await host.harness.behavior.callRpc("getCompletion", { courseId: "software-factory", lessonId: "001" })) as Completion;
  assert.equal(completion1.counts.passing, 2);
  assert.equal(completion1.summary, "It plans.");
  assert.equal(completion1.next?.status, "current");
});

test("a coach thread only changes its own lesson: an old coach can't touch the lesson the student is on", async (t) => {
  const { sandbox, host } = await setup(t);
  const root = sandbox.factoryRoot;
  const lesson0 = findLesson(builtinCourse, "000") ?? assert.fail("no 000");
  const lesson1 = findLesson(sandbox.course, "001") ?? assert.fail("no 001");
  const coach0 = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach0);
  for (const example of lessonExamples(lesson0)) await ok(host, "tutor_mark_example", { example: example.key, status: "skipped" }, coach0);
  await ok(host, "tutor_complete_iteration", { iteration: "000", summary: "Done." }, coach0);

  // The Lesson 000 coach can't adopt Lesson 001: its own coach thread does that.
  const stolen = await tool(host, "tutor_adopt_iteration", { iteration: "001" }, coach0);
  assert.ok(isError(stolen), `adopted from the old coach: ${text(stolen)}`);
  assert.match(text(stolen), /This coach thread is for Lesson 000/);
  assert.equal(await readFile(join(root, "ITERATION"), "utf8").catch(() => null), null, "nothing adopted");

  const coach1 = ((await host.harness.behavior.callRpc("startNextLesson", { courseId: "software-factory", lessonId: "001" })) as { threadId: string }).threadId;
  // Before adopting, the new coach is told to adopt its lesson rather than act on Lesson 000.
  const early = await tool(host, "tutor_mark_example", { example: lessonExamples(lesson0)[0]?.key, status: "passing", evidence: "x" }, coach1);
  assert.ok(isError(early) && /tutor_adopt_iteration/.test(text(early)), text(early));
  await ok(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  const before = await readFile(join(root, "spec/PROGRESS.yaml"), "utf8");

  const [example1] = lessonExamples(lesson1);
  assert.ok(example1 !== undefined);
  const rule1 = lesson1.suggestedRuleOrder[0] ?? assert.fail("no rule");
  host.addThread({ id: "thr_old_side", originKind: "fork", originPluginId: "side-chat", sourceThreadId: coach0, visibility: "hidden" });
  const refusals: [string, unknown, string][] = [
    ["tutor_mark_example", { example: example1.key, status: "passing", evidence: "$ ./factory" }, coach0],
    ["tutor_mark_example", { example: example1.key, status: "passing", evidence: "$ ./factory" }, "thr_old_side"],
    ["tutor_focus_rule", { rule: rule1 }, coach0],
    ["tutor_complete_iteration", { iteration: "001", summary: "Stolen." }, coach0],
  ];
  // The Lesson 0 coach coaches the built-in course: Lesson 001's Examples, Rules and completion are not its to touch.
  for (const [name, input, threadId] of refusals) {
    const result = await tool(host, name, input, threadId);
    assert.ok(isError(result), `${name} from ${threadId} was allowed: ${text(result)}`);
    assert.match(text(result), /in lesson 000|on lesson 000, not 001/);
  }
  assert.equal(await readFile(join(root, "spec/PROGRESS.yaml"), "utf8"), before, "Lesson 001's progress is untouched");
  assert.equal(await readFile(join(root, "ITERATION"), "utf8"), "001 WIP\n");
  assert.deepEqual(host.threads.find((thread) => thread.id === coach0)?.metadata.reachedRules, undefined);

  // tutor_status still answers, each coach about its own course.
  const status = await ok(host, "tutor_status", {}, coach0);
  assert.match(status, /This thread coaches Lesson 000/);
  assert.match(status, /Lesson 000 "Using your tutor": Done/);
  assert.match(await ok(host, "tutor_status", {}, coach1), /Lesson 001 "Basic unvalidated loop": WIP/);

  // A side chat the old coach opens belongs to its own lesson, not the current one.
  await ok(host, "tutor_side_chat", { title: "Back then", prompt: "Why did Lesson 0 do that?" }, coach0);
  const side = host.threads.find((thread) => thread.sourceThreadId === coach0 && thread.originPluginId === "tutor");
  assert.equal(side?.metadata.lesson, "000");
  assert.match(side?.seed ?? "", /Lesson 000 coach thread/);

  // The current coach still works.
  await ok(host, "tutor_mark_example", { example: example1.key, status: "passing", evidence: "$ ./factory" }, coach1);
});

test("after fetch-iteration ran outside BB, the lesson's own coach adopts it again and keeps the student's seed", async (t) => {
  const { sandbox, host } = await setup(t);
  const root = sandbox.factoryRoot;
  // What fetch.sh leaves: ITERATION reads 001 WIP, the seed is there (and edited), no spec/PROGRESS.yaml.
  await writeFile(join(root, "ITERATION"), "001 WIP\n");
  await mkdir(join(sandbox.codebaseRoot, "seeds"));
  await writeFile(join(sandbox.codebaseRoot, "seeds/tetris.md"), "the student's own seed\n");

  const coach1 = (await openCoach(host, "001")).threadId;
  const adopted = await ok(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  assert.match(adopted, /Adopt spec for iteration 001/);
  assert.equal(await readFile(join(root, "ITERATION"), "utf8"), "001 WIP\n");
  assert.match(await readFile(join(root, "spec/PROGRESS.yaml"), "utf8"), /^iteration: "001"\n/);
  assert.equal(await readFile(join(sandbox.codebaseRoot, "seeds/tetris.md"), "utf8"), "the student's own seed\n");
  assert.deepEqual((await readdir(join(root, "stand-ins"))).sort(), ["README.md", "plan-alpha-beta"]);
});

test("a WIP lesson with a damaged spec/PROGRESS.yaml is never adopted again, and the file is left as it was", async (t) => {
  const { sandbox, host } = await setup(t);
  const root = sandbox.factoryRoot;
  const lesson1 = findLesson(sandbox.course, "001") ?? assert.fail("no 001");
  const [example1] = lessonExamples(lesson1);
  assert.ok(example1 !== undefined);
  // Marks made mid-lesson, not yet committed, then a merge conflict in the file.
  const damaged = [
    'iteration: "001"',
    "<<<<<<< HEAD",
    "examples:",
    `  ${example1.key}:`,
    "    status: passing",
    "=======",
    "examples: {}",
    ">>>>>>> theirs",
    "",
  ].join("\n");
  await writeFile(join(root, "ITERATION"), "001 WIP\n");
  await mkdir(join(root, "spec"));
  await writeFile(join(root, "spec/PROGRESS.yaml"), damaged);

  const coach1 = (await openCoach(host, "001")).threadId;
  const status = await ok(host, "tutor_status", {}, coach1);
  assert.match(status, /spec\/PROGRESS\.yaml could not be read/);
  const marked = await tool(host, "tutor_mark_example", { example: example1.key, status: "passing", evidence: "$ ./factory" }, coach1);
  assert.ok(isError(marked) && !/tutor_adopt_iteration/.test(text(marked)), text(marked));
  const refused = await tool(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  assert.ok(isError(refused), `adopted over a damaged spec/PROGRESS.yaml: ${text(refused)}`);
  assert.equal(await readFile(join(root, "spec/PROGRESS.yaml"), "utf8"), damaged, "spec/PROGRESS.yaml untouched");
  assert.equal(await readFile(join(root, "ITERATION"), "utf8"), "001 WIP\n");
});

test("an older factory that is its repo's top folder keeps its progress readable but refuses adoption", async (t) => {
  const { sandbox, host } = await setup(t);
  const root = sandbox.factoryRoot;
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "ITERATION"), "001 Done\n");

  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual([overview.courses[1]?.current?.lessonId, overview.courses[1]?.current?.iterationStatus], ["001", "Done"]);
  const coach2 = ((await host.harness.behavior.callRpc("startNextLesson", { courseId: "software-factory", lessonId: "002" })) as { threadId: string }).threadId;
  const refused = await tool(host, "tutor_adopt_iteration", { iteration: "002" }, coach2);
  assert.ok(isError(refused), `adopted into an old-layout factory: ${text(refused)}`);
  assert.match(text(refused), /its repo's top folder \(it holds \.git\)/);
  assert.equal(await readFile(join(root, "ITERATION"), "utf8"), "001 Done\n", "ITERATION untouched");
  assert.equal(await readdir(join(root, "spec")).catch(() => null), null, "no spec/ written");
});

test("coach discovery reads every page of Tutor's threads: many newer side chats don't hide the coach", async (t) => {
  const { host } = await setup(t);
  const coach = (await openCoach(host, "000")).threadId;
  // More side chats than one page of threads.list, all newer than the coach thread.
  for (let index = 0; index < 450; index += 1) {
    host.addThread({
      id: `thr_side_${index}`,
      originPluginId: "tutor",
      originKind: "fork",
      sourceThreadId: coach,
      lifecycleOwnerThreadId: coach,
      visibility: "hidden",
      metadata: { course: "software-factory", lesson: "000", role: "sideChat" },
    });
  }
  const again = await openCoach(host, "000");
  assert.deepEqual(again, { threadId: coach, created: false }, "found the existing coach instead of spawning another");
  const before = listCalls(host);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.threads.filter((thread) => thread.role === "coach")[0]?.id, coach, "the outline finds it too");
  const pages = listCalls(host) - before;
  assert.ok(pages >= 3, `listed ${pages} page(s)`);
});

/** Waits out the coach registry's start-up listing, so the listings a test counts or hooks are its own. */
async function startupListed(host: TutorHost): Promise<void> {
  for (let tries = 0; host.harness.inspection.sdk.callsTo("threads.list").length === 0; tries += 1) {
    if (tries > 200) assert.fail("the start-up listing never ran");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setImmediate(resolve));
}

const listCalls = (host: TutorHost) => host.harness.inspection.sdk.callsTo("threads.list").length;

/** A coach thread as a Tutor build without the lesson-to-coach record left it: in BB, but not in Tutor's storage. */
function unrecordedCoach(host: TutorHost, lessonId: string, course = "software-factory") {
  return host.addThread({
    id: `thr_coach_${course}_${lessonId}`,
    originPluginId: "tutor",
    title: `Coach · Lesson ${lessonId}`,
    metadata: { course, lesson: lessonId, role: "coach" },
  });
}

test("a coach thread is found although threads vanish between pages of the listing", async (t) => {
  const { host } = await setup(t);
  await startupListed(host);
  const coach = (await openCoach(host, "000")).threadId;
  // 201 of Tutor's threads: the coach thread and 200 newer side chats of it.
  for (let index = 0; index < THREAD_PAGE_SIZE; index += 1) {
    host.addThread({ id: `thr_side_${index}`, originPluginId: "tutor", originKind: "fork", sourceThreadId: coach, visibility: "hidden", metadata: { course: "software-factory", lesson: "000", role: "sideChat" } });
  }
  // One is archived just before the second page is read, so the coach thread slides onto the first.
  host.beforeList.hook = ({ offset = 0 }) => {
    const newest = host.threads.filter((thread) => thread.id.startsWith("thr_side_") && thread.archivedAt === null).at(-1);
    if (offset === THREAD_PAGE_SIZE && newest !== undefined) newest.archivedAt = 1;
  };
  assert.deepEqual(await openCoach(host, "000"), { threadId: coach, created: false });
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1, "no second coach thread");
});

test("coach discovery lists coach threads only, never their side chats, and records what it found", async (t) => {
  const { host } = await setup(t);
  await startupListed(host);
  const coach = unrecordedCoach(host, "000");
  // Side chats and side threads from before side chats, far more than a page, never enter the listing.
  for (let index = 0; index < 450; index += 1) {
    host.addThread({ id: `thr_side_${index}`, originPluginId: "tutor", originKind: "fork", sourceThreadId: coach.id, visibility: "hidden", metadata: { course: "software-factory", lesson: "000", role: "sideChat" } });
  }
  host.addThread({ id: "thr_child", originPluginId: "tutor", parentThreadId: coach.id, metadata: { course: "software-factory", lesson: "000", role: "sideChat" } });
  const before = listCalls(host);
  assert.deepEqual(await openCoach(host, "000"), { threadId: coach.id, created: false });
  assert.equal(listCalls(host) - before, 1, "one page: no side chat was listed");
  // Found once, it is recorded, for a later listing that misses it.
  assert.deepEqual(await host.bb.storage.kv.list().then((keys) => Promise.all(keys.map((key) => host.bb.storage.kv.get(key)))), [{ threadId: coach.id }]);
});

test("a listing that misses the coach thread is read once more before a coach thread is spawned", async (t) => {
  const { host } = await setup(t);
  await startupListed(host);
  const coach = unrecordedCoach(host, "000");
  // 200 newer coach threads of another course, one archived just before the second page is read.
  for (let index = 0; index < THREAD_PAGE_SIZE; index += 1) unrecordedCoach(host, `${index}`, "another-course");
  let archived = false;
  host.beforeList.hook = ({ offset = 0 }) => {
    if (offset !== THREAD_PAGE_SIZE || archived) return;
    archived = true;
    const other = host.threads.find((thread) => thread.id === "thr_coach_another-course_199");
    if (other !== undefined) other.archivedAt = 1;
  };
  assert.deepEqual(await openCoach(host, "000"), { threadId: coach.id, created: false });
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
});

test("a remembered coach thread counts only while BB still has it as the lesson's coach", async (t) => {
  const { host } = await setup(t);
  const first = (await openCoach(host, "000")).threadId;
  const [key, ...others] = await host.bb.storage.kv.list();
  assert.ok(key !== undefined && others.length === 0, "one lesson, one record");
  // A record naming a side chat (or anything but the lesson's coach thread) is ignored.
  host.addThread({ id: "thr_side", originPluginId: "tutor", originKind: "fork", sourceThreadId: first, visibility: "hidden", metadata: { course: "software-factory", lesson: "000", role: "coach" } });
  await host.bb.storage.kv.set(key, { threadId: "thr_side" });
  assert.deepEqual(await openCoach(host, "000"), { threadId: first, created: false });
  assert.deepEqual(await host.bb.storage.kv.get(key), { threadId: first }, "the record is corrected from the listing");
  // Once the coach thread is archived, the record no longer holds and a new coach thread is spawned.
  const archived = host.threads.find((thread) => thread.id === first);
  assert.ok(archived !== undefined);
  archived.archivedAt = 1;
  const second = await openCoach(host, "000");
  assert.equal(second.created, true);
  assert.notEqual(second.threadId, first);
  assert.deepEqual(await host.bb.storage.kv.get(key), { threadId: second.threadId });
  // Another lesson's coach thread, or one whose metadata names another lesson, never answers for this one.
  const renamed = host.threads.find((thread) => thread.id === second.threadId);
  assert.ok(renamed !== undefined);
  renamed.metadata = { ...renamed.metadata, lesson: "001" };
  const third = await openCoach(host, "000");
  assert.equal(third.created, true);
});

test("with two live coach threads for a lesson, opening the coach picks the one the outline shows", async (t) => {
  const { host } = await setup(t);
  const threadOf = (id: string) => host.threads.find((thread) => thread.id === id) ?? assert.fail(`no thread ${id}`);
  const older = (await openCoach(host, "000")).threadId;
  threadOf(older).archivedAt = 1;
  const newer = (await openCoach(host, "000")).threadId;
  // The student unarchives the older one and archives the newer, so the older is recorded again; then brings the newer back.
  threadOf(older).archivedAt = null;
  threadOf(newer).archivedAt = 1;
  assert.equal((await openCoach(host, "000")).threadId, older);
  threadOf(newer).archivedAt = null;
  const detail = (await host.harness.behavior.callRpc("getLessonDetail", { courseId: "tutor", lessonId: "000" })) as LessonDetail;
  assert.equal(detail.coachThreadId, newer, "the start page and the outline show the newest coach thread");
  assert.deepEqual(await openCoach(host, "000"), { threadId: newer, created: false });
  assert.deepEqual(await host.bb.storage.kv.get((await host.bb.storage.kv.list())[0] ?? ""), { threadId: newer }, "and the record follows");
});

test("coach discovery fails loudly past its page bound instead of reading forever", async (t) => {
  const { host } = await setup(t);
  for (let index = 0; index < 10_001; index += 1) {
    host.addThread({ id: `thr_many_${index}`, originPluginId: "tutor" });
  }
  await assert.rejects(openCoach(host, "000"), /more than 10000 of Tutor's threads in the workspace project/);
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
      pluginMetadata: { course: "tutor", lesson: "000", role: "sideChat", ruleKey: rule },
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
  assert.equal(overview.courses[0]?.current?.coachThreadId, coach);
  assert.equal(overview.courses[0]?.lessons.find((lesson) => lesson.id === "000")?.coachThreadId, coach);
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

  const example = lessonExamples(findLesson(builtinCourse, "000") ?? assert.fail("no 000"))[0];
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
    courseId: "tutor",
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
  for (const lesson of lessonExamples(findLesson(builtinCourse, "000") ?? assert.fail("no 000"))) {
    await ok(host, "tutor_mark_example", { example: lesson.key, status: "skipped" }, coach);
  }
  await ok(host, "tutor_complete_iteration", { iteration: "000", summary: "Done." }, coach);
  const completion = (await host.harness.behavior.callRpc("getCompletion", { courseId: "tutor", lessonId: "000" })) as Completion;
  assert.equal(completion.sideChats, 1);
});

test("Ask a side question: startSideChat forks a side chat, retrying the tab write when another client wrote first", async (t) => {
  const { host } = await setup(t);
  await assert.rejects(host.harness.behavior.callRpc("startSideChat", { courseId: "tutor", lessonId: "000", ruleKey: null }), /Start with your coach for lesson 000 first/);
  const { coach, rule } = await adoptedCoach(host);
  host.tabConflicts.remaining = 2;
  const started = (await host.harness.behavior.callRpc("startSideChat", { courseId: "tutor", lessonId: "000", ruleKey: rule })) as {
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

test("a tab write that keeps conflicting fails after a few tries instead of looping, and leaves no side chat behind", async (t) => {
  const { host } = await setup(t);
  const { coach, rule } = await adoptedCoach(host);
  const liveSideChats = () => host.threads.filter((thread) => thread.sourceThreadId === coach && thread.archivedAt === null).map((thread) => thread.id);
  host.tabConflicts.remaining = 10;
  await assert.rejects(host.harness.behavior.callRpc("startSideChat", { courseId: "tutor", lessonId: "000", ruleKey: rule }), /Thread tabs changed/);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.tabs.update").length, 3);
  assert.deepEqual(liveSideChats(), [], "the button's fork was cleaned up");

  host.tabConflicts.remaining = 10;
  const result = await tool(host, "tutor_side_chat", { title: "t", prompt: "p", rule }, coach);
  assert.ok(isError(result) && /Thread tabs changed/.test(text(result)), text(result));
  assert.deepEqual(liveSideChats(), [], "the tool's fork was cleaned up");

  // When the clean-up fails too, both failures are reported.
  host.tabConflicts.remaining = 10;
  host.archiveRefusal.message = "database is locked";
  await assert.rejects(
    host.harness.behavior.callRpc("startSideChat", { courseId: "tutor", lessonId: "000", ruleKey: rule }),
    (error: Error) => /Thread tabs changed/.test(error.message) && /couldn't remove the unused side chat thr_\d+: database is locked/.test(error.message),
  );
});

test("a tab write that errors but lands keeps its side chat; one that really failed archives it", async (t) => {
  const { host } = await setup(t);
  const { coach, rule } = await adoptedCoach(host);
  const live = (id: string) => host.threads.find((thread) => thread.id === id)?.archivedAt === null;
  const shown = () => sideChatTabsOf(host, coach).map((tab) => (JSON.parse(tab.paramsJson ?? "{}") as { threadId: string }).threadId);

  // BB stored the tab but the reply was an error: the tab points at the fork, so the fork stays.
  host.tabWriteError.message = "upstream timed out";
  host.tabWriteError.landed = true;
  const landed = (await host.harness.behavior.callRpc("startSideChat", { courseId: "tutor", lessonId: "000", ruleKey: rule })) as { sideChatId: string };
  assert.ok(live(landed.sideChatId), "the side chat its tab shows is not archived");
  assert.deepEqual(shown(), [landed.sideChatId]);

  // Another client wrote our very tab during the last conflict: the tab is there, so the fork stays.
  host.tabWriteError.message = null;
  host.tabConflicts.remaining = 3;
  host.tabConflicts.withOurTab = true;
  const raced = await tool(host, "tutor_side_chat", { title: "t", prompt: "p", rule }, coach);
  assert.ok(!isError(raced), text(raced));
  const racedId = /Started side chat (thr_\d+)/.exec(text(raced))?.[1] ?? assert.fail(text(raced));
  assert.ok(live(racedId), "the side chat another client's tab shows is not archived");
  assert.deepEqual(shown(), [landed.sideChatId, racedId]);

  // The write really failed: no tab shows the fork, so it is archived and the error surfaces.
  host.tabConflicts.withOurTab = false;
  host.tabWriteError.message = "upstream timed out";
  host.tabWriteError.landed = false;
  const before = host.threads.length;
  await assert.rejects(host.harness.behavior.callRpc("startSideChat", { courseId: "tutor", lessonId: "000", ruleKey: rule }), /upstream timed out/);
  const failed = host.threads[before]?.id ?? assert.fail("no fork");
  assert.ok(!live(failed), "the tab-less fork is archived");
  assert.deepEqual(shown(), [landed.sideChatId, racedId]);
});

test("a provider that cannot fork gets a clear error, and no side thread is spawned instead", async (t) => {
  const { host } = await setup(t);
  const { coach, rule } = await adoptedCoach(host);
  host.forkRefusal.message = "Provider scripted does not support thread forks";
  await assert.rejects(
    host.harness.behavior.callRpc("startSideChat", { courseId: "tutor", lessonId: "000", ruleKey: rule }),
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
  const before = (await host.harness.behavior.callRpc("getLessonDetail", { courseId: "tutor", lessonId: "000" })) as LessonDetail;
  assert.deepEqual(before.reachedRules, [], "adopting sets a focus but opens no section");
  const focused = await ok(host, "tutor_focus_rule", { rule }, coach);
  assert.match(focused, /start your next message with this line/);
  await ok(host, "tutor_focus_rule", { rule }, coach);
  assert.deepEqual(host.threads.find((thread) => thread.id === coach)?.metadata.reachedRules, [rule]);
  const detail = (await host.harness.behavior.callRpc("getLessonDetail", { courseId: "tutor", lessonId: "000" })) as LessonDetail;
  assert.deepEqual(detail.reachedRules, [rule]);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  const rules = overview.courses[0]?.lessons.find((lesson) => lesson.id === "000")?.outline.flatMap((feature) => feature.rules) ?? [];
  assert.deepEqual(rules.filter((candidate) => candidate.reached).map((candidate) => candidate.key), [rule]);
  // The metadata is untrusted: junk in it is ignored, not fatal.
  const thread = host.threads.find((candidate) => candidate.id === coach);
  assert.ok(thread !== undefined);
  thread.metadata.reachedRules = [rule, 42, "not a key", { x: 1 }];
  const again = (await host.harness.behavior.callRpc("getLessonDetail", { courseId: "tutor", lessonId: "000" })) as LessonDetail;
  assert.deepEqual(again.reachedRules, [rule]);
});

test("redirectFocus asks the coach thread to move, as the student", async (t) => {
  const { sandbox, host } = await setup(t);
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const rule = findLesson(builtinCourse, "000")?.suggestedRuleOrder[0];
  assert.ok(rule !== undefined);
  assert.deepEqual(await host.harness.behavior.callRpc("redirectFocus", { courseId: "tutor", lessonId: "000", ruleKey: rule }), { threadId: coach });
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

  const factory = { dir: sandbox.factoryRoot, progressFile: "spec/PROGRESS.yaml", iterationFiles: ["ITERATION", "spec/ITERATION"] };
  await host.rt.store.writeIteration(host.rt.access("host_1"), factory, { iteration: "001", status: "WIP" });
  await host.harness.behavior.emitThreadEvent("thread.idle", idle);
  const last = host.harness.inspection.realtimeSignals.at(-1);
  assert.deepEqual([last?.channel, last?.payload], ["state-changed", { reason: "iteration", lessonId: "001" }]);
});

test("first run: candidates, confirmation and a course that will not load", async (t) => {
  const { sandbox, host } = await setup(t, {});
  const before = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(before.workspace, { status: "unset" });
  assert.deepEqual(before.courses.map((entry) => [entry.course.id, entry.current]), [["tutor", null], ["software-factory", null]]);
  const { projects } = (await host.harness.behavior.callRpc("listCandidateProjects", null)) as {
    projects: { projectId: string; qualifies: boolean }[];
  };
  assert.deepEqual(projects.map((project) => project.projectId), [PROJECT_ID]);
  await assert.rejects(host.harness.behavior.callRpc("confirmWorkspace", { projectId: "prj_gone" }), /no folder/);
  const workspace = await host.harness.behavior.callRpc("confirmWorkspace", { projectId: PROJECT_ID });
  assert.deepEqual(workspace, { status: "found", projectId: PROJECT_ID, projectName: "tetris/.factory", root: sandbox.factoryRoot });
  assert.ok(host.harness.inspection.realtimeSignals.some((signal) => (signal.payload as { reason: string }).reason === "workspace"));
  const after = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(after.courses.map((entry) => [entry.current?.lessonId, entry.current?.iterationStatus]), [["000", "not-started"], ["001", "not-started"]]);
});

test("first run: a folder qualifies on ITERATION, an older spec/ITERATION, or the starter's AGENTS.md", async (t) => {
  const { sandbox, host } = await setup(t, {});
  const root = sandbox.factoryRoot;
  const candidate = async () => {
    const { projects } = (await host.harness.behavior.callRpc("listCandidateProjects", null)) as {
      projects: { projectId: string; qualifies: boolean; detail: string }[];
    };
    const found = projects.find((project) => project.projectId === PROJECT_ID) ?? assert.fail("no factory project");
    return [found.qualifies, found.detail];
  };
  assert.deepEqual(await candidate(), [false, "no ITERATION"]);
  await writeFile(join(root, "AGENTS.md"), "Skills, in `../.agents/skills/`:\n\n- **coach-me** — when the student says \"coach me\".\n");
  assert.deepEqual(await candidate(), [true, "AGENTS.md points at the course"]);
  await mkdir(join(root, "spec"));
  await writeFile(join(root, "spec/ITERATION"), "001 Done\n");
  assert.deepEqual(await candidate(), [true, "ITERATION · 001 Done"]);
  await writeFile(join(root, "ITERATION"), "002 WIP\n");
  assert.deepEqual(await candidate(), [true, "ITERATION · 002 WIP"]);
});

test("concurrent tool calls never lose each other's progress", async (t) => {
  const { sandbox, host } = await setup(t);
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const lesson0 = findLesson(builtinCourse, "000");
  assert.ok(lesson0 !== undefined);
  const examples = lessonExamples(lesson0);
  await Promise.all(
    examples.map((example) => ok(host, "tutor_mark_example", { example: example.key, status: "skipped" }, coach)),
  );
  const detail = (await host.harness.behavior.callRpc("getLessonDetail", { courseId: "tutor", lessonId: "000" })) as LessonDetail;
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
  const start = () => host.harness.behavior.callRpc("startNextLesson", { courseId: "software-factory", lessonId: "001" }) as Promise<{ threadId: string }>;
  const started = await Promise.all([start(), start()]);
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1);
  assert.equal(started[0]?.threadId, started[1]?.threadId);
});

test("confirmWorkspace asks the workspace's machine for its real folder, not the server", async (t) => {
  const sandbox = await makeSandbox();
  t.after(() => sandbox.cleanup());
  const factory = join(sandbox.root, "tutorial-factory");
  await mkdir(factory);
  const asked: { hostId: string; path: string }[] = [];
  const disk = createDiskAccess();
  // On the machine, the project's folder is really the course checkout.
  const access = (hostId: string): WorkspaceAccess => ({
    ...disk,
    realPath: async (path) => (asked.push({ hostId, path }), path === factory ? sandbox.course.root : disk.realPath(path)),
  });
  const host = await makeTutorHost(sandbox.course, factory, { coursePath: sandbox.course.root }, { access });
  t.after(() => host.harness.lifecycle.dispose());
  await assert.rejects(host.harness.behavior.callRpc("confirmWorkspace", { projectId: PROJECT_ID }), /course/);
  assert.ok(asked.some((call) => call.hostId === "host_1" && call.path === factory));
});

test("confirmWorkspace refuses the course checkout, a folder inside it, or one holding it", async (t) => {
  const sandbox = await makeSandbox();
  t.after(() => sandbox.cleanup());
  const inside = join(sandbox.course.root, "docs");
  const linked = join(sandbox.root, "linked-course");
  await symlink(sandbox.course.root, linked);
  for (const root of [sandbox.course.root, inside, sandbox.root, linked]) {
    const host = await makeTutorHost(sandbox.course, root, { coursePath: sandbox.course.root });
    await assert.rejects(host.harness.behavior.callRpc("confirmWorkspace", { projectId: PROJECT_ID }), /course/, root);
    assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
    await host.harness.lifecycle.dispose();
  }
  const factory = join(sandbox.root, "tutorial-factory");
  await mkdir(factory);
  const host = await makeTutorHost(sandbox.course, factory, { coursePath: sandbox.course.root });
  t.after(() => host.harness.lifecycle.dispose());
  assert.equal(((await host.harness.behavior.callRpc("confirmWorkspace", { projectId: PROJECT_ID })) as { status: string }).status, "found");
});

test("a stored factoryProject that now leads into the course is treated as missing: no coach, no writes", async (t) => {
  const sandbox = await makeSandbox();
  t.after(() => sandbox.cleanup());
  const link = join(sandbox.root, "factory-link");
  await symlink(sandbox.course.root, link);
  const host = await makeTutorHost(sandbox.course, link, { factoryProject: PROJECT_ID, coursePath: sandbox.course.root });
  t.after(() => host.harness.lifecycle.dispose());
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.workspace.status, "missing");
  await assert.rejects(host.harness.behavior.callRpc("openCoach", { courseId: "tutor", lessonId: "000" }));
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  assert.equal(await readdir(join(sandbox.course.root, "spec")).catch(() => null), null, "nothing written into the course");
});

test("a Codespace set up by an older Tutor (factoryProject only) keeps its workspace, and confirming writes workspaceProject", async (t) => {
  const sandbox = await makeRepoSandbox();
  t.after(() => sandbox.cleanup());
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot, { factoryProject: PROJECT_ID });
  t.after(() => host.harness.lifecycle.dispose());
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.workspace.status, "found");
  await host.harness.behavior.callRpc("confirmWorkspace", { projectId: PROJECT_ID });
  assert.equal((await host.rt.settings.get()).workspaceProject, PROJECT_ID);
});

test("a capstone lesson waits for the layout, with its own message; a layoutless course's lesson does not", async (t) => {
  const ws = await mkdtemp(join(tmpdir(), "ws-"));
  t.after(() => rm(ws, { recursive: true, force: true }));
  await mkdir(join(ws, ".git"));
  const capstone = await makeTutorHost({ ...fixtureCourse, layout: "capstone-factory", coachPath: null }, ws);
  t.after(() => capstone.harness.lifecycle.dispose());
  // An empty git repo has no factory folder: the capstone says so in its own words (detect.ts), not "Add the course".
  await assert.rejects(capstone.harness.behavior.callRpc("startNextLesson", { courseId: "software-factory", lessonId: "001" }), /This repo has no factory folder/);
  const plain = await makeTutorHost(fixtureLayoutlessCourse, ws);
  t.after(() => plain.harness.lifecycle.dispose());
  const { threadId } = (await plain.harness.behavior.callRpc("startNextLesson", { courseId: fixtureLayoutlessCourse.id, lessonId: "001" })) as { threadId: string };
  assert.ok(threadId);
});

test("a not-ready capstone still answers tutor_status with its problem, and won't open a lesson's coach", async (t) => {
  const ws = await mkdtemp(join(tmpdir(), "ws-"));
  t.after(() => rm(ws, { recursive: true, force: true }));
  await mkdir(join(ws, ".git"));
  const host = await makeTutorHost({ ...fixtureCourse, coachPath: null }, ws);
  t.after(() => host.harness.lifecycle.dispose());
  // Lesson 0 is not held up by the capstone's missing factory.
  const coach0 = (await openCoach(host, "000")).threadId;
  assert.doesNotMatch(await ok(host, "tutor_status", {}, coach0), /This repo has no factory folder/);
  // A capstone coach thread from before the factory went missing still gets its status, problem and all.
  host.addThread({ id: "thr_coach001", originPluginId: "tutor", metadata: { course: fixtureCourse.id, lesson: "001", role: "coach" } });
  assert.match(await ok(host, "tutor_status", {}, "thr_coach001"), /This repo has no factory folder/);
  const lesson1 = findLesson(fixtureCourse, "001");
  const rule = lesson1?.features[0]?.rules[0];
  assert.ok(rule !== undefined);
  await assert.rejects(openCoach(host, "001"), /This repo has no factory folder/);
  await assert.rejects(host.harness.behavior.callRpc("redirectFocus", { courseId: "software-factory", lessonId: "001", ruleKey: rule.key }), /This repo has no factory folder/);
});

test("a layoutless course keeps its progress and ITERATION under .tutor/courses/<id>", async (t) => {
  const ws = await mkdtemp(join(tmpdir(), "ws-"));
  t.after(() => rm(ws, { recursive: true, force: true }));
  const host = await makeTutorHost(fixtureLayoutlessCourse, ws);
  t.after(() => host.harness.lifecycle.dispose());
  const { threadId } = (await host.harness.behavior.callRpc("startNextLesson", { courseId: fixtureLayoutlessCourse.id, lessonId: "001" })) as { threadId: string };
  assert.match(await ok(host, "tutor_adopt_iteration", { iteration: "001" }, threadId), /nothing was copied into your workspace/);
  const dir = join(ws, ".tutor/courses", fixtureLayoutlessCourse.id);
  assert.equal((await readFile(join(dir, "ITERATION"), "utf8")).trim(), "001 WIP");
  const lesson1 = findLesson(fixtureLayoutlessCourse, "001");
  const [example] = lesson1 === undefined ? [] : lessonExamples(lesson1);
  assert.ok(example !== undefined);
  await ok(host, "tutor_mark_example", { example: example.key, status: "passing", evidence: "$ ./run\nok" }, threadId);
  const progress = await readFile(join(dir, "progress.yaml"), "utf8");
  assert.match(progress, /iteration: "?001"?/);
  assert.ok(progress.includes(example.key), progress);
  assert.deepEqual((await readdir(ws)).sort(), [".tutor"], "nothing else is written into the workspace");
});

test("with no course configured, Tutor offers the built-in course alone, and Lesson 0 progress lands in .tutor/progress.yaml", async (t) => {
  const ws = await mkdtemp(join(tmpdir(), "ws-"));
  t.after(() => rm(ws, { recursive: true, force: true }));
  await mkdir(join(ws, ".git"));
  const host = await makeTutorHost(null, ws); // null: no configured course
  t.after(() => host.harness.lifecycle.dispose());
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor"]);
  const { threadId } = (await host.harness.behavior.callRpc("openCoach", { courseId: "tutor", lessonId: "000" })) as { threadId: string };
  const adopted = await callTool(host, "tutor_adopt_iteration", { iteration: "000" }, threadId);
  assert.ok(!isError(adopted), text(adopted));
  assert.match(await readFile(join(ws, ".tutor/progress.yaml"), "utf8"), /iteration: "?000"?/);
  assert.deepEqual((await readdir(ws)).sort(), [".git", ".tutor"]);
});

test("an older Codespace's Lesson 0 record in spec/PROGRESS.yaml still shows Lesson 0 done, and its coach thread is found", async (t) => {
  const lesson0 = (await createCourseSource().loadBuiltin()).lessons[0] ?? assert.fail("no Lesson 0");
  const sandbox = await makeRepoSandbox({ progress: { iteration: "001", history: { "000": { examples: allPassing(lesson0) } } }, iteration: "001 WIP" });
  t.after(() => sandbox.cleanup());
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot);
  t.after(() => host.harness.lifecycle.dispose());
  host.addThread({ id: "thr_old", originPluginId: "tutor", metadata: { course: "software-factory", lesson: "000", role: "coach" } });
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  const builtin = overview.courses.find((entry) => entry.builtin);
  assert.equal(builtin?.lessons[0]?.status, "done");
  assert.equal(builtin?.lessons[0]?.coachThreadId, "thr_old");
});

test("an older Codespace part-way through Lesson 0 carries on: marks go to .tutor/progress.yaml, the capstone's file is left alone", async (t) => {
  const lesson0 = builtinCourse.lessons[0] ?? assert.fail("no Lesson 0");
  const [first, second] = lessonExamples(lesson0);
  assert.ok(first !== undefined && second !== undefined);
  const sandbox = await makeRepoSandbox({ progress: { iteration: "000", examples: { [first.key]: allPassing(lesson0)[first.key]! } } });
  t.after(() => sandbox.cleanup());
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot);
  t.after(() => host.harness.lifecycle.dispose());
  const capstoneFile = join(sandbox.factoryRoot, "spec/PROGRESS.yaml");
  const before = await readFile(capstoneFile, "utf8");
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses.map((entry) => [entry.course.id, entry.current?.lessonId, entry.current?.iterationStatus]), [
    ["tutor", "000", "WIP"],
    ["software-factory", "001", "not-started"],
  ]);
  const coach0 = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_mark_example", { example: second.key, status: "passing", evidence: "seen it" }, coach0);
  const progress = await readFile(join(sandbox.repoRoot, ".tutor/progress.yaml"), "utf8");
  assert.ok(progress.includes(first.key) && progress.includes(second.key), progress);
  assert.equal(await readFile(capstoneFile, "utf8"), before);
});

test("before its first lesson is adopted, a course's lessons are ahead: its coach won't open, but the lesson can be started", async (t) => {
  const { host } = await setup(t);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses[1]?.lessons.map((lesson) => lesson.status), ["ahead", "ahead", "ahead"]);
  assert.equal(overview.courses[0]?.lessons[0]?.status, "current");
  await assert.rejects(openCoach(host, "001"), /has not started yet/);
  const { threadId } = (await host.harness.behavior.callRpc("startNextLesson", { courseId: fixtureCourse.id, lessonId: "001" })) as { threadId: string };
  assert.ok(threadId);
});

const UNREACHABLE = /Tutor can't reach your computer's machine right now\. Run `tutor status`\./;

test("a machine that is not connected makes the workspace unreachable, with its own message", async (t) => {
  const host = await makeTutorHost(null, "/nowhere", undefined, { hostStatus: "disconnected" });
  t.after(() => host.harness.lifecycle.dispose());
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.workspace, { status: "unreachable", projectId: PROJECT_ID, projectName: "tetris/.factory" });
  await assert.rejects(host.harness.behavior.callRpc("openCoach", { courseId: "tutor", lessonId: "000" }), UNREACHABLE);
  await assert.rejects(host.harness.behavior.callRpc("confirmWorkspace", { projectId: PROJECT_ID }), UNREACHABLE);
  // A coach thread from before the machine went away: its tools say the same.
  host.addThread({ id: "thr_coach", originPluginId: "tutor", metadata: { course: "tutor", lesson: "000", role: "coach" } });
  const result = await tool(host, "tutor_status", {}, "thr_coach");
  assert.ok(isError(result));
  assert.match(text(result), UNREACHABLE);
});

test("a host call that finds the machine offline makes the workspace unreachable, not missing", async (t) => {
  const sandbox = await makeSandbox();
  const offline: WorkspaceAccess = {
    ...createDiskAccess(),
    read: async () => {
      throw new WorkspaceUnreachableError();
    },
  };
  const host = await makeTutorHost(sandbox.course, sandbox.factoryRoot, undefined, { access: () => offline });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.workspace.status, "unreachable");
  await assert.rejects(openCoach(host, "000"), UNREACHABLE);
});

test("a progress file changed after the tool read it is retried once, then refused, and neither edit is lost", async (t) => {
  const sandbox = await makeSandbox();
  const disk = createDiskAccess();
  const progressPath = join(sandbox.factoryRoot, ".tutor/progress.yaml");
  // Every write of the progress file, and whether it was refused as a conflict.
  const writes: ("written" | "conflict")[] = [];
  const access: WorkspaceAccess = {
    ...disk,
    async write(path, text, expected) {
      try {
        await disk.write(path, text, expected);
        if (path === progressPath) writes.push("written");
      } catch (cause) {
        if (path === progressPath && cause instanceof WriteConflictError) writes.push("conflict");
        throw cause;
      }
    },
  };
  const host = await makeTutorHost(sandbox.course, sandbox.factoryRoot, undefined, { access: () => access });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const [first, second, third] = lessonExamples(findLesson(builtinCourse, "000") ?? assert.fail("lesson 000"));
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  const readProgress = async () => parseProgress(await readFile(progressPath, "utf8")).progress ?? assert.fail("progress unreadable");
  /** Another writer skips `example` in the progress file, at a new time each edit so the file always changes. */
  let edits = 0;
  const outsideEdit = async (example: typeof first) => {
    const text = await readFile(progressPath, "utf8");
    const progress = parseProgress(text).progress ?? assert.fail("progress unreadable");
    edits += 1;
    progress.examples[example.key] = { status: "skipped", hash: example.hash, at: `2026-09-25T10:00:${String(edits).padStart(2, "0")}Z` };
    await writeFile(progressPath, formatProgress(progress, text));
  };
  // The outside edit lands once the tool has loaded the world, before it writes: the window the
  // world's read and the tool's write leave open (recordReachedRule's BB round trip is in it).
  // A tool call loads the world once outside the workspace lock, then once per attempt inside it.
  const load = host.rt.world.load.bind(host.rt.world);
  let loads = 0;
  let afterLoad: ((count: number) => Promise<void>) | null = null;
  host.rt.world.load = async () => {
    const world = await load();
    loads += 1;
    await afterLoad?.(loads);
    return world;
  };

  // Once, after the first attempt's load: that attempt conflicts, the retry reloads (with the edit) and writes.
  loads = 0;
  writes.length = 0;
  afterLoad = async (count) => {
    if (count === 2) await outsideEdit(second);
  };
  await ok(host, "tutor_mark_example", { example: first.key, status: "passing", evidence: "seen in the outline" }, coach);
  assert.deepEqual(writes, ["conflict", "written"]);
  assert.equal(loads, 3, "the retry loaded the world again");
  const once = await readProgress();
  assert.equal(once.examples[first.key]?.status, "passing", "the tool's mark");
  assert.equal(once.examples[second.key]?.status, "skipped", "the outside edit");

  // After every load: the second conflict is refused, and the file keeps the outside edits.
  loads = 0;
  writes.length = 0;
  afterLoad = () => outsideEdit(third);
  const refused = await tool(host, "tutor_mark_example", { example: second.key, status: "passing", evidence: "seen it" }, coach);
  afterLoad = null;
  assert.ok(isError(refused));
  assert.equal(text(refused), "Your progress file changed while Tutor was writing it. Call tutor_status and try again.");
  assert.deepEqual(writes, ["conflict", "conflict"]);
  const after = await readProgress();
  assert.equal(after.examples[second.key]?.status, "skipped", "not marked: both attempts conflicted");
  assert.equal(after.examples[third.key]?.status, "skipped", "the outside edit");
  assert.equal(after.examples[first.key]?.status, "passing");
});


/** Every entry under `dir` but .git: folders, links with their targets, files with their contents. */
async function snapshot(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (path === ".git") continue;
    if (entry.isSymbolicLink()) out.push(`${path} -> ${await readlink(join(dir, path))}`);
    else if (entry.isDirectory()) out.push(`${path}/`, ...(await snapshot(dir, path)));
    else out.push(`${path}: ${await readFile(join(dir, path), "utf8")}`);
  }
  return out;
}

test("the server never copies course files itself: a capstone adoption is a single adoptLesson host call", async (t) => {
  // fetch-iteration ran outside BB: ITERATION reads 001 WIP, so lesson 001's coach adopts it.
  const sandbox = await makeRepoSandbox({ git: true, iteration: "001 WIP" });
  const calls: string[] = [];
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot, undefined, { onHostCall: (method) => calls.push(method) });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  const coach1 = (await openCoach(host, "001")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  assert.deepEqual(calls.filter((method) => method !== "inspect"), ["adoptLesson"]);
  assert.match(await readFile(join(sandbox.factoryRoot, "ITERATION"), "utf8"), /^001 WIP/);
  assert.match(await readFile(join(sandbox.factoryRoot, "spec/PROGRESS.yaml"), "utf8"), /^iteration: "001"\n/);
  assert.equal(await readFile(join(sandbox.codebaseRoot, "seeds/tetris.md"), "utf8"), findLesson(sandbox.course, "001")?.seedSpec);
});

test("a host call that fails mid-adoption (machine gone) leaves the workspace as it was", async (t) => {
  const sandbox = await makeRepoSandbox({ git: true, iteration: "001 WIP" });
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot, undefined, {
    onHostCall: (method) => {
      if (method === "adoptLesson") throw new WorkspaceUnreachableError();
    },
  });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  const coach1 = (await openCoach(host, "001")).threadId;
  const before = await snapshot(sandbox.repoRoot);
  const refused = await tool(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  assert.ok(isError(refused));
  assert.match(text(refused), UNREACHABLE);
  assert.deepEqual(await snapshot(sandbox.repoRoot), before);
});

test("a progress file edited after the world was read: adoptLesson refuses with no writes, and the retry adopts", async (t) => {
  const sandbox = await makeRepoSandbox({ git: true, iteration: "001 Done", progress: { iteration: "001" } });
  const progressPath = join(sandbox.factoryRoot, "spec/PROGRESS.yaml");
  /** The workspace as each adoptLesson call found it. */
  const seen: string[][] = [];
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot, undefined, {
    onHostCall: async (method) => {
      if (method === "adoptLesson") seen.push(await snapshot(sandbox.repoRoot));
    },
  });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  const coach2 = ((await host.harness.behavior.callRpc("startNextLesson", { courseId: "software-factory", lessonId: "002" })) as { threadId: string }).threadId;
  // The outside edit lands once the first attempt has loaded the world (the second load), before its host call.
  const load = host.rt.world.load.bind(host.rt.world);
  let loads = 0;
  host.rt.world.load = async () => {
    const world = await load();
    loads += 1;
    if (loads === 2) await writeFile(progressPath, 'iteration: "001"\nsummary: edited meanwhile\nexamples: {}\n');
    return world;
  };
  await ok(host, "tutor_adopt_iteration", { iteration: "002" }, coach2);
  assert.equal(loads, 3, "the retry loaded the world again");
  assert.equal(seen.length, 2, "adoptLesson was called twice");
  assert.deepEqual(seen[1], seen[0], "the first call wrote nothing");
  assert.equal(await readFile(join(sandbox.factoryRoot, "ITERATION"), "utf8"), "002 WIP\n");
  const progress = await readFile(progressPath, "utf8");
  assert.match(progress, /^iteration: "002"\n/);
  assert.match(progress, /summary: edited meanwhile/, "the outside edit is kept, in the history");
});

test("refuses to adopt when ../seeds/ is, or holds, the course, writing nothing", async (t) => {
  const sandbox = await makeSandbox();
  // The course cloned into ../seeds.
  const courseRoot = join(sandbox.codebaseRoot, "seeds/tutorial");
  await mkdir(join(sandbox.codebaseRoot, "seeds"), { recursive: true });
  await rename(sandbox.course.root, courseRoot);
  const course = {
    ...sandbox.course,
    root: courseRoot,
    coachPath: sandbox.course.coachPath === null ? null : sandbox.course.coachPath.replace(sandbox.course.root, courseRoot),
    lessons: sandbox.course.lessons.map((lesson) => ({ ...lesson, dir: lesson.dir.replace(sandbox.course.root, courseRoot) })),
  };
  await writeFile(join(sandbox.factoryRoot, "ITERATION"), "001 WIP\n");
  const host = await makeTutorHost(course, sandbox.factoryRoot);
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  const coach1 = (await openCoach(host, "001")).threadId;
  const before = await snapshot(sandbox.root);
  const refused = await tool(host, "tutor_adopt_iteration", { iteration: "001" }, coach1);
  assert.ok(isError(refused));
  assert.match(text(refused), /shares a folder with, the course/);
  assert.deepEqual(await snapshot(sandbox.root), before);
});

test("through the machine: sdk.files and the host entry's inspect carry Lesson 0's progress", async (t) => {
  const sandbox = await makeSandbox();
  const host = await makeTutorHost(sandbox.course, sandbox.factoryRoot, undefined, { access: "machine" });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  const coach = (await openCoach(host, "000")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  const [first] = lessonExamples(findLesson(builtinCourse, "000") ?? assert.fail("lesson 000"));
  assert.ok(first !== undefined);
  await ok(host, "tutor_mark_example", { example: first.key, status: "passing", evidence: "seen in the outline" }, coach);
  const progress = parseProgress(await readFile(join(sandbox.factoryRoot, ".tutor/progress.yaml"), "utf8")).progress;
  assert.equal(progress?.examples[first.key]?.status, "passing");
  const inspected = host.harness.inspection.experimental_hostRpcCalls.filter((call) => call.method === "inspect");
  assert.ok(inspected.length > 0, "layout probes went to the host entry");
  assert.ok(inspected.every((call) => call.hostId === "host_1"));
});

test("the Feature's project hint is resolved on BB's own host, and left as it is when BB has none", async (t) => {
  const sandbox = await makeSandbox();
  /** An access that records the machines it was asked for. */
  const recording = (asked: string[]) => (hostId: string) => {
    asked.push(hostId);
    return createDiskAccess();
  };
  const env = { TUTOR_FACTORY_PATH: sandbox.factoryRoot };
  const askedWithHost: string[] = [];
  const asked: string[] = [];
  const withHost = await makeTutorHost(sandbox.course, sandbox.factoryRoot, {}, { env, access: recording(askedWithHost) });
  const standalone = await makeTutorHost(sandbox.course, sandbox.factoryRoot, {}, { env, access: recording(asked), serverHost: false });
  t.after(async () => {
    await withHost.harness.lifecycle.dispose();
    await standalone.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  assert.equal((await withHost.rt.world.load()).projectHint, sandbox.repoRoot);
  assert.deepEqual([...new Set(askedWithHost)], ["host_1"]);
  assert.equal((await standalone.rt.world.load()).projectHint, sandbox.factoryRoot);
  assert.deepEqual(asked, [], "nothing was probed");
});

// ---------------------------------------------------------------------------
// Adding a course (Task 13): fetched on request into BB's data dir, its starter seeded into the workspace.
// ---------------------------------------------------------------------------

interface Added {
  courseId: string;
  firstLessonId: string;
  seeded: { written: number; kept: string[] };
}

/** A standalone Tutor: no configured course, an empty git workspace, the fixture course in the catalog, and BB's data dir. */
async function standalone(
  t: TestContext,
  options: {
    layout?: "capstone-factory";
    starter?: boolean;
    onHostCall?: (method: string, input: unknown) => unknown;
    repo?: Omit<FixtureCourseRepoOptions, "layout" | "starter">;
  } = {},
): Promise<{ host: TutorHost; ws: string; dataDir: string }> {
  const repo = await makeFixtureCourseRepo({ layout: options.layout ?? "capstone-factory", starter: options.starter ?? true, ...options.repo });
  const dataDir = await mkdtemp(join(tmpdir(), "bbdata-"));
  const ws = await emptyGitWorkspace();
  const host = await makeTutorHost(null, ws, { workspaceProject: PROJECT_ID, courseCatalog: repo.catalogJson }, {
    dataDir,
    ...(options.onHostCall === undefined ? {} : { onHostCall: options.onHostCall }),
  });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await repo.cleanup();
    await rm(dataDir, { recursive: true, force: true });
    await rm(ws, { recursive: true, force: true });
  });
  return { host, ws, dataDir };
}

test("nothing from a course is on the computer until it is added; adding it seeds the workspace and lists its lessons after Lesson 0", async (t) => {
  const { host, ws, dataDir } = await standalone(t, { layout: "capstone-factory", starter: true });
  assert.deepEqual(await readdir(join(dataDir, "content")).catch(() => []), []);
  const before = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(before.available.map((entry) => [entry.id, entry.unfinished]), [["fixture", false]]);
  assert.deepEqual(before.courseErrors, []);
  assert.deepEqual(before.courses.map((entry) => entry.course.id), ["tutor"]);
  const added = (await host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" })) as Added;
  assert.deepEqual(added, { courseId: "fixture", firstLessonId: "001", seeded: { written: 2, kept: [] } });
  const after = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(after.courses.map((entry) => entry.course.id), ["tutor", "fixture"]);
  assert.deepEqual(after.available, []);
  assert.ok((await readdir(join(ws, "tetris"))).includes(".factory"));
  assert.equal(after.courses[1]?.layout.ready, true);
  // The starter's CI is not the student's, and the course itself stays on the server.
  assert.deepEqual((await readdir(ws)).sort(), [".agents", ".git", ".tutor", "tetris"]);
  assert.deepEqual(await readdir(join(dataDir, "content")), ["fixture"]);
  const { threadId } = (await host.harness.behavior.callRpc("startNextLesson", { courseId: "fixture", lessonId: "001" })) as { threadId: string };
  assert.ok(threadId);
});

test("with a configured course, fetching is refused and nothing is offered", async (t) => {
  const repo = await makeFixtureCourseRepo({ layout: "capstone-factory", starter: true });
  const dataDir = await mkdtemp(join(tmpdir(), "bbdata-"));
  const sandbox = await makeSandbox();
  const host = await makeTutorHost(sandbox.course, sandbox.factoryRoot, { factoryProject: PROJECT_ID, coursePath: sandbox.course.root, courseCatalog: repo.catalogJson }, { dataDir });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
    await repo.cleanup();
    await rm(dataDir, { recursive: true, force: true });
  });
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.available, []);
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor", "software-factory"]);
  await assert.rejects(host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" }), /This Tutor uses the course it was set up with\./);
  assert.deepEqual(await readdir(join(dataDir, "content")).catch(() => []), []);
});

test("with no course configured and nothing at the default course folder, there is no course error; a configured folder that is missing still is one", async (t) => {
  const ws = await emptyGitWorkspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  const host = await makeTutorHost(null, ws, { workspaceProject: PROJECT_ID });
  t.after(() => host.harness.lifecycle.dispose());
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courseErrors, []);
  assert.deepEqual(overview.available.map((entry) => entry.id), ["software-factory"]);
  const configured = await makeTutorHost(null, ws, { workspaceProject: PROJECT_ID, coursePath: join(ws, "no-course-here") });
  t.after(() => configured.harness.lifecycle.dispose());
  const missing = (await configured.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.match(missing.courseErrors.map((entry) => entry.error).join(" "), /There is no course folder at .*no-course-here/);
  assert.deepEqual(missing.available, []);
});

test("a fetched course whose seed did not finish is still offered, as Finish adding the course, and adding it again finishes the seed", async (t) => {
  let failSeeds = 1;
  const { host, ws } = await standalone(t, {
    onHostCall: (method) => {
      if (method === "seedWorkspace" && failSeeds > 0) {
        failSeeds -= 1;
        throw new Error("The connection to the machine dropped.");
      }
      return undefined;
    },
  });
  await assert.rejects(host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" }), /connection to the machine dropped/);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses.map((entry) => [entry.course.id, entry.layout.ready]), [["tutor", true], ["fixture", false]]);
  // Still offered, as "Finish adding the course": not a dead end.
  assert.deepEqual(
    overview.available.map((entry) => [entry.id, entry.unfinished]),
    [["fixture", true]],
  );
  const refused = host.harness.behavior.callRpc("startNextLesson", { courseId: "fixture", lessonId: "001" });
  await assert.rejects(refused, (cause: Error) => {
    assert.match(cause.message, /Finish adding the course from the outline/);
    assert.doesNotMatch(cause.message, /Restore it from git/);
    return true;
  });
  const added = (await host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" })) as Added;
  assert.equal(added.seeded.written, 2);
  assert.ok((await readdir(join(ws, ".tutor/seeds"))).includes("fixture.json"));
  const after = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(after.courses[1]?.layout.ready, true);
  assert.deepEqual(after.available, []);
  const { threadId } = (await host.harness.behavior.callRpc("startNextLesson", { courseId: "fixture", lessonId: "001" })) as { threadId: string };
  assert.ok(threadId);
});

test("a fetched course that no longer loads is offered again, as unfinished", async (t) => {
  const { host, dataDir } = await standalone(t);
  await host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" });
  await rm(join(dataDir, "content/fixture/course/course.yaml"));
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor"]);
  assert.match(overview.courseErrors.map((entry) => entry.error).join(" "), /is not a course/);
  assert.deepEqual(overview.available.map((entry) => [entry.id, entry.unfinished]), [["fixture", true]]);
});

test("tutor_fetch_course adds a course from Lesson 0's coach thread and tells the coach to commit the starter, naming files it kept", async (t) => {
  const { host, ws } = await standalone(t);
  // The student already has an AGENTS.md of their own where the starter puts one.
  await mkdir(join(ws, "tetris/.factory"), { recursive: true });
  await writeFile(join(ws, "tetris/.factory/AGENTS.md"), "# Mine\n");
  const { threadId } = (await host.harness.behavior.callRpc("openCoach", { courseId: "tutor", lessonId: "000" })) as { threadId: string };
  const result = await tool(host, "tutor_fetch_course", { course: "fixture" }, threadId);
  assert.ok(!isError(result), text(result));
  assert.match(
    text(result),
    /^Added "Build a software factory"\. Its lessons follow Lesson 0 in the outline\. 1 starter files are now in your workspace; commit them \("Add the Build a software factory starter"\) before you start its first lesson\./,
  );
  assert.match(text(result), /These files were already there and were kept: tetris\/\.factory\/AGENTS\.md/);
  assert.equal(await readFile(join(ws, "tetris/.factory/AGENTS.md"), "utf8"), "# Mine\n");
  const unknown = await tool(host, "tutor_fetch_course", { course: "nope" }, threadId);
  assert.ok(isError(unknown));
  assert.match(text(unknown), /no course "nope"/);
  // Not a Tutor thread: refused like every tool.
  host.addThread({ id: "thr_stranger" });
  assert.ok(isError(await tool(host, "tutor_fetch_course", { course: "fixture" }, "thr_stranger")));
});

test("a course fetched over https:// may not name a file:// starter: adding it is refused and nothing is seeded", async (t) => {
  const repo = await makeFixtureCourseRepo({ layout: "capstone-factory", starter: true });
  const dataDir = await mkdtemp(join(tmpdir(), "bbdata-"));
  const ws = await emptyGitWorkspace();
  // The catalog names the course over https; its clone is already in place at v1, so nothing goes to the network.
  const catalog = JSON.stringify([{ id: "fixture", title: "Fixture", description: "", repo: "https://example.invalid/course.git", ref: "v1" }]);
  await mkdir(join(dataDir, "content/fixture"), { recursive: true });
  git(join(dataDir, "content/fixture"), "clone", "-q", "--branch", "v1", pathToFileURL(repo.courseRepo).href, "course");
  const host = await makeTutorHost(null, ws, { workspaceProject: PROJECT_ID, courseCatalog: catalog }, { dataDir });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await repo.cleanup();
    await rm(dataDir, { recursive: true, force: true });
    await rm(ws, { recursive: true, force: true });
  });
  await assert.rejects(host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" }), /fetched over https:\/\/ may only name an https:\/\/ starter/);
  assert.deepEqual((await readdir(ws)).sort(), [".git"]);
  assert.deepEqual((await readdir(join(dataDir, "content/fixture"))).sort(), ["course"]);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor"]);
});

test("a fetched course goes by its catalog id, whatever its course.yaml says: listed, routed, seeded and coached under it", async (t) => {
  const { host, ws } = await standalone(t, { repo: { courseYamlId: "its-own-id" } });
  const added = (await host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" })) as Added;
  assert.equal(added.courseId, "fixture");
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor", "fixture"]);
  assert.deepEqual(overview.courseErrors, []);
  assert.deepEqual(await readdir(join(ws, ".tutor/seeds")), ["fixture.json"]);
  assert.equal(overview.courses[1]?.layout.ready, true);
  const detail = (await host.harness.behavior.callRpc("getLessonDetail", { courseId: "fixture", lessonId: "001" })) as { lesson: { id: string } };
  assert.equal(detail.lesson.id, "001");
  const { threadId } = (await host.harness.behavior.callRpc("startNextLesson", { courseId: "fixture", lessonId: "001" })) as { threadId: string };
  const threads = ((await host.harness.behavior.callRpc("getOverview", null)) as Overview).threads;
  assert.deepEqual(threads.filter((thread) => thread.id === threadId).map((thread) => thread.courseId), ["fixture"]);
  await assert.rejects(host.harness.behavior.callRpc("getLessonDetail", { courseId: "its-own-id", lessonId: "001" }), /no course "its-own-id"|could not be loaded/);
});

test("a course that does not load leaves no record: it is not listed, and it is still offered", async (t) => {
  const { host, dataDir } = await standalone(t, { repo: { notACourse: true } });
  await assert.rejects(host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" }), /is not a course/);
  assert.deepEqual((await readdir(join(dataDir, "content/fixture"))).includes("fetched.json"), false);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor"]);
  assert.deepEqual(overview.courseErrors, []);
  assert.deepEqual(overview.available.map((entry) => entry.id), ["fixture"]);
});

test("a catalog course under Tutor's own id is refused and leaves no record", async (t) => {
  const { host, ws, dataDir } = await standalone(t, { repo: { id: "tutor", courseYamlId: "something-else" } });
  await assert.rejects(host.harness.behavior.callRpc("fetchCourse", { courseId: "tutor" }), /uses the id "tutor"/);
  assert.deepEqual(await readdir(join(dataDir, "content")).catch(() => []), [], "nothing was fetched");
  assert.deepEqual((await readdir(ws)).sort(), [".git"]);
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor"]);
});

test("after Add the course, its first lesson can be started from its start page, whether or not Lesson 0 is done (Decision 16)", async (t) => {
  const { host } = await standalone(t);
  await host.harness.behavior.callRpc("fetchCourse", { courseId: "fixture" });
  const canStart = async () => {
    const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
    return overview.courses.flatMap((entry) => entry.lessons.map((lesson) => [entry.course.id, lesson.id, lesson.status, lesson.canStart]));
  };
  const lessons = await canStart();
  assert.deepEqual(lessons.filter(([course]) => course === "tutor"), [["tutor", "000", "current", false]]);
  assert.deepEqual(lessons.find(([course, id]) => course === "fixture" && id === "001"), ["fixture", "001", "ahead", true]);
  assert.ok(lessons.filter(([course, id]) => course === "fixture" && id !== "001").every(([, , , can]) => can === false));
  // Lesson 0 done: still the course's first lesson, still startable.
  const coach0 = (await openCoach(host, "000", "tutor")).threadId;
  await ok(host, "tutor_adopt_iteration", { iteration: "000" }, coach0);
  for (const example of lessonExamples(findLesson(builtinCourse, "000") ?? assert.fail("lesson 000"))) {
    await ok(host, "tutor_mark_example", { example: example.key, status: "passing", evidence: "seen in the outline" }, coach0);
  }
  const after = await canStart();
  assert.deepEqual(after.find(([course]) => course === "tutor"), ["tutor", "000", "done", false]);
  assert.deepEqual(after.find(([course, id]) => course === "fixture" && id === "001"), ["fixture", "001", "ahead", true]);
  const { threadId } = (await host.harness.behavior.callRpc("startNextLesson", { courseId: "fixture", lessonId: "001" })) as { threadId: string };
  assert.ok(threadId);
});
