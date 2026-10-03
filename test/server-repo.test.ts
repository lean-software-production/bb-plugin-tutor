// Tutor's backend with the BB project at a capstone-project-starter clone's top
// folder (v0.2.0): coach threads spawn there, the factory is tetris/.factory
// through lesson 003 and factory/ from 004, when Tutor moves it as the
// starter's fetch.sh does, and the seeds are tetris/seeds.
import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { findLesson, lessonExamples } from "../shared/derive.ts";
import { fixtureCourseTo004 } from "../shared/fixtures.ts";
import type { Course } from "../shared/model.ts";
import type { Overview } from "../shared/rpc.ts";
import { createCourseSource } from "../server/course/index.ts";
import { git, makeRepoSandbox, type Sandbox } from "./helpers/disk.ts";
import { makeTutorHost, PROJECT_ID, type TutorHost } from "./helpers/fake-bb.ts";

interface Setup {
  sandbox: Sandbox;
  host: TutorHost;
}

async function setup(t: TestContext, options: { course?: (course: Course) => Course; settings?: Record<string, string> } = {}): Promise<Setup> {
  const sandbox = await makeRepoSandbox({ git: true, course: fixtureCourseTo004 });
  const course = options.course === undefined ? sandbox.course : options.course(sandbox.course);
  const host = await makeTutorHost(course, sandbox.repoRoot, options.settings, { projectName: "capstone-project-starter" });
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

async function coachFor(host: TutorHost, lessonId: string): Promise<string> {
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  const course = overview.courses.find((entry) => entry.lessons.some((lesson) => lesson.id === lessonId)) ?? assert.fail(`no lesson ${lessonId}`);
  // A lesson under way (or done) has its coach opened; one ahead is started, as the completion page does.
  const status = course.lessons.find((lesson) => lesson.id === lessonId)?.status;
  const rpc = status === "ahead" ? "startNextLesson" : "openCoach";
  return ((await host.harness.behavior.callRpc(rpc, { courseId: course.course.id, lessonId })) as { threadId: string }).threadId;
}

/** Adopts `lessonId` with its own coach, passes every Example, completes it, and commits as the coach would. */
async function walk(setup: Setup, lessonId: string): Promise<string> {
  const { sandbox, host } = setup;
  const coach = await coachFor(host, lessonId);
  const adopted = await ok(host, "tutor_adopt_iteration", { iteration: lessonId }, coach);
  const lesson = findLesson(lessonId === "000" ? await createCourseSource().loadBuiltin() : sandbox.course, lessonId) ?? assert.fail(`no lesson ${lessonId}`);
  for (const example of lessonExamples(lesson)) {
    await ok(host, "tutor_mark_example", { example: example.key, status: "passing", evidence: "$ ./factory\nok" }, coach);
  }
  await ok(host, "tutor_complete_iteration", { iteration: lessonId, summary: `Done ${lessonId}.` }, coach);
  git(sandbox.repoRoot, "add", "-A");
  git(sandbox.repoRoot, "commit", "-q", "-m", `Iteration ${lessonId}`);
  return adopted;
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

test("coach threads spawn at the repo's top folder and are told to work in tetris/.factory", async (t) => {
  const { sandbox, host } = await setup(t);
  await coachFor(host, "000");
  const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.deepEqual(spawn.environment, { type: "host", hostId: "host_1", workspace: { type: "unmanaged", path: sandbox.repoRoot } });
  assert.match(String(spawn.prompt), /The factory is tetris\/\.factory\/ in this repo/);
  assert.match(String(spawn.prompt), /cd tetris\/\.factory/);
  assert.match(String(spawn.prompt), /follow its AGENTS\.md/);

  const config = await host.harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({
      origin: { kind: null, pluginId: "tutor" },
      pluginMetadata: { course: "software-factory", lesson: "000", role: "coach" },
    }),
  );
  assert.match(config.instructions ?? "", /The factory is tetris\/\.factory\/ in this repo/);
  assert.match(config.instructions ?? "", /moves it to factory\//);
});

test("lessons 001-003 write into tetris/.factory and tetris/seeds; adopting 004 moves the factory to factory/ as fetch.sh does", async (t) => {
  const s = await setup(t);
  const { sandbox, host } = s;
  const repo = sandbox.repoRoot;
  await walk(s, "000");
  const adopted1 = await walk(s, "001");
  assert.equal(await readFile(join(repo, "tetris/seeds/tetris.md"), "utf8"), findLesson(sandbox.course, "001")?.seedSpec);
  assert.equal(await exists(join(repo, "seeds")), false);
  assert.match(adopted1, /tetris\/\.factory\/spec\/ now holds/);
  assert.match(adopted1, /Commit tetris\/\.factory\/ and tetris\/seeds\//);
  assert.equal(await readFile(join(repo, "tetris/.factory/ITERATION"), "utf8"), "001 Done\n");
  await walk(s, "002");
  await walk(s, "003");
  assert.equal(await readFile(join(repo, "tetris/.factory/ITERATION"), "utf8"), "003 Done\n");
  assert.equal(await exists(join(repo, "factory")), false, "no move before 004");

  const coach4 = await coachFor(host, "004");
  const adopted4 = await ok(host, "tutor_adopt_iteration", { iteration: "004" }, coach4);
  assert.match(adopted4, /the factory now lives in factory\//);
  assert.match(adopted4, /Commit factory\/, tetris\/seeds\/ and the old tetris\/\.factory/);
  assert.equal(await exists(join(repo, "tetris/.factory")), false);
  assert.equal(await readFile(join(repo, "factory/ITERATION"), "utf8"), "004 WIP\n");
  assert.match(await readFile(join(repo, "factory/spec/PROGRESS.yaml"), "utf8"), /^iteration: "004"\n/);
  assert.match(await readFile(join(repo, "factory/spec/README.md"), "utf8"), /Homework 4/);
  assert.equal(await readlink(join(repo, "factory/.claude/skills")), "../../.agents/skills");
  // Staged as a rename, as fetch.sh leaves it, then rewritten as 004 WIP.
  assert.match(git(repo, "status", "--porcelain"), /^RM tetris\/\.factory\/ITERATION -> factory\/ITERATION$/m);

  // Tutor reads the student from factory/ now; the older coach still works, spawned at the same folder.
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual([overview.courses[1]?.current?.lessonId, overview.courses[1]?.current?.iterationStatus], ["004", "WIP"]);
  assert.equal(overview.courses[1]?.current?.counts.passing, 1, "the unchanged Example carried over from 003");
  const status = await ok(host, "tutor_status", {}, coach4);
  assert.match(status, /Factory: factory\/ \(in .*capstone-project-starter\)\./);
  const coach3 = ((await host.harness.behavior.callRpc("openCoach", { courseId: "software-factory", lessonId: "003" })) as { threadId: string }).threadId;
  assert.match(await ok(host, "tutor_status", {}, coach3), /Factory: factory\//);
  const config = await host.harness.behavior.resolveAgentConfiguration(
    makePluginAgentConfigurationContext({
      origin: { kind: null, pluginId: "tutor" },
      pluginMetadata: { course: "software-factory", lesson: "004", role: "coach" },
    }),
  );
  assert.match(config.instructions ?? "", /The factory is factory\/ in this repo/);
  for (const [, spawn] of host.harness.inspection.sdk.callsTo("threads.spawn").entries()) {
    const args = spawn[0] as { environment: { workspace: { path: string } } };
    assert.equal(args.environment.workspace.path, repo);
  }
});

test("adopting 004 once the factory is already factory/ (fetch.sh moved it) does not move anything", async (t) => {
  const s = await setup(t);
  const repo = s.sandbox.repoRoot;
  await writeFile(join(repo, "tetris/.factory/ITERATION"), "003 Done\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "003");
  git(repo, "mv", "tetris/.factory", "factory");
  git(repo, "commit", "-q", "-m", "moved");
  const coach4 = await coachFor(s.host, "004");
  const adopted = await ok(s.host, "tutor_adopt_iteration", { iteration: "004" }, coach4);
  assert.doesNotMatch(adopted, /now lives in factory/);
  assert.match(adopted, /factory\/spec\/ now holds/);
  assert.equal(await readFile(join(repo, "factory/ITERATION"), "utf8"), "004 WIP\n");
  assert.equal(await exists(join(repo, "tetris/.factory")), false);
});

test("a 004 set going outside Tutor, still in tetris/.factory, is adopted again by its coach and moved", async (t) => {
  const s = await setup(t);
  const repo = s.sandbox.repoRoot;
  await writeFile(join(repo, "tetris/.factory/ITERATION"), "004 WIP\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "004 by hand");
  const coach4 = ((await s.host.harness.behavior.callRpc("openCoach", { courseId: "software-factory", lessonId: "004" })) as { threadId: string }).threadId;
  const adopted = await ok(s.host, "tutor_adopt_iteration", { iteration: "004" }, coach4);
  assert.match(adopted, /the factory now lives in factory\//);
  assert.equal(await readFile(join(repo, "factory/ITERATION"), "utf8"), "004 WIP\n");
  assert.match(await readFile(join(repo, "factory/spec/PROGRESS.yaml"), "utf8"), /^iteration: "004"\n/);
});

test("a refused move changes nothing and says why", async (t) => {
  const s = await setup(t);
  const repo = s.sandbox.repoRoot;
  await writeFile(join(repo, "tetris/.factory/ITERATION"), "003 Done\n");
  // The tracked .claude/skills link is now a folder, not committed: git refuses to move the factory.
  await rm(join(repo, "tetris/.factory/.claude/skills"));
  await mkdir(join(repo, "tetris/.factory/.claude/skills/x"), { recursive: true });
  const coach4 = await coachFor(s.host, "004");
  const refused = await tool(s.host, "tutor_adopt_iteration", { iteration: "004" }, coach4);
  assert.ok(isError(refused), text(refused));
  assert.match(text(refused), /could not move tetris\/\.factory to factory\//);
  assert.equal(await readFile(join(repo, "tetris/.factory/ITERATION"), "utf8"), "003 Done\n");
  assert.equal(await exists(join(repo, "factory")), false);
  assert.equal(await exists(join(repo, "tetris/.factory/spec")), false);
});

test("without a course coach file, the coaching method is the starter's coach-me skill at the repo's top", async (t) => {
  const s = await setup(t, { course: (course) => ({ ...course, coachPath: null }) });
  const coach = await coachFor(s.host, "000");
  const status = await ok(s.host, "tutor_status", {}, coach);
  assert.match(status, /Coaching method: the file \.agents\/skills\/coach-me\/SKILL\.md in this workspace\./);
  const [spawn] = s.host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [Record<string, unknown>];
  assert.match(String(spawn.prompt), /\.agents\/skills\/coach-me\/SKILL\.md/);
});

test("a repo with no factory folder refuses to adopt the course's lessons and says where the factory should be; Lesson 0 goes ahead", async (t) => {
  const s = await setup(t);
  await rm(join(s.sandbox.repoRoot, "tetris/.factory"), { recursive: true });
  await assert.rejects(
    s.host.harness.behavior.callRpc("startNextLesson", { courseId: s.sandbox.course.id, lessonId: "001" }),
    /no factory folder/,
  );
  // A coach thread for 001 from before the factory went missing.
  s.host.addThread({ id: "thr_coach001", originPluginId: "tutor", metadata: { course: s.sandbox.course.id, lesson: "001", role: "coach" } });
  assert.match(await ok(s.host, "tutor_status", {}, "thr_coach001"), /no factory folder/);
  const refused = await tool(s.host, "tutor_adopt_iteration", { iteration: "001" }, "thr_coach001");
  assert.ok(isError(refused), text(refused));
  assert.match(text(refused), /no factory folder/);
  assert.deepEqual((await readdir(s.sandbox.repoRoot)).sort(), [".agents", ".git", "tetris"]);
  // Lesson 0 keeps its progress in .tutor/, whatever the capstone's layout.
  const coach = await coachFor(s.host, "000");
  await ok(s.host, "tutor_adopt_iteration", { iteration: "000" }, coach);
  assert.deepEqual((await readdir(s.sandbox.repoRoot)).sort(), [".agents", ".git", ".tutor", "tetris"]);
});

test("first run: the repo's top folder qualifies as the project", async (t) => {
  const s = await setup(t, { settings: {} });
  const { projects } = (await s.host.harness.behavior.callRpc("listCandidateProjects", null)) as {
    projects: { projectId: string; qualifies: boolean; detail: string }[];
  };
  const found = projects.find((project) => project.projectId === PROJECT_ID) ?? assert.fail("no project");
  assert.deepEqual([found.qualifies, found.detail], [true, "starter clone · factory in tetris/.factory"]);
  git(s.sandbox.repoRoot, "mv", "tetris/.factory", "factory");
  await writeFile(join(s.sandbox.repoRoot, "factory/ITERATION"), "004 WIP\n");
  const again = (await s.host.harness.behavior.callRpc("listCandidateProjects", null)) as {
    projects: { projectId: string; qualifies: boolean; detail: string }[];
  };
  assert.deepEqual(
    again.projects.filter((project) => project.projectId === PROJECT_ID).map((project) => [project.qualifies, project.detail]),
    [[true, "starter clone · factory in factory/ · ITERATION · 004 WIP"]],
  );
});
