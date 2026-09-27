// Integration test against real checkouts of capstone-project-starter and the
// tutorial course. Run it with
//
//   TUTOR_TEST_STARTER=/path/to/capstone-project-starter TUTOR_TEST_COURSE=/path/to/tutorial npm test
//
// It is skipped otherwise. Both checkouts are copied into a temp folder and
// never written to. One copy of the starter adopts lessons 001 to 004 through
// Tutor's tools, with the BB project at its top folder; the other runs the
// starter's own fetch.sh, offline (a fake curl tars the course copy). After 004
// both must hold the same files, staged the same way, with the factory moved
// to factory/ and its skills link repointed: Tutor adopts as fetch.sh does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { findLesson, lessonExamples } from "../shared/derive.ts";
import type { Course } from "../shared/model.ts";
import type { Overview } from "../shared/rpc.ts";
import { createCourseSource } from "../server/course/index.ts";
import { makeTutorHost, PROJECT_ID, type TutorHost } from "./helpers/fake-bb.ts";

const starterPath = process.env["TUTOR_TEST_STARTER"];
const coursePath = process.env["TUTOR_TEST_COURSE"];
const skip = (starterPath === undefined || coursePath === undefined) && "TUTOR_TEST_STARTER and TUTOR_TEST_COURSE are not both set";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Student",
  GIT_AUTHOR_EMAIL: "student@example.com",
  GIT_COMMITTER_NAME: "Student",
  GIT_COMMITTER_EMAIL: "student@example.com",
};

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: GIT_ENV });
}

function text(result: PluginAgentToolResult): string {
  return typeof result === "string" ? result : result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

async function ok(host: TutorHost, name: string, input: unknown, threadId: string): Promise<string> {
  const result = await host.harness.behavior.callAgentTool(name, input, { threadId, projectId: PROJECT_ID });
  assert.ok(typeof result === "string" || result.isError !== true, `${name} failed: ${text(result)}`);
  return text(result);
}

async function coachFor(host: TutorHost, lessonId: string): Promise<string> {
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  const rpc = overview.current?.lessonId === lessonId || lessonId === "000" ? "openCoach" : "startNextLesson";
  return ((await host.harness.behavior.callRpc(rpc, { lessonId })) as { threadId: string }).threadId;
}

/** Every file under `dir` but .git, with a symlink's target or a file's contents; PROGRESS.yaml is Tutor's alone, and ITERATION is compared by lesson only. */
async function tree(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (path === ".git" || entry.name === "PROGRESS.yaml") continue;
    if (entry.isSymbolicLink()) out.push(`${path} -> ${await readlink(join(dir, path))}`);
    else if (entry.isDirectory()) out.push(`${path}/`, ...(await tree(dir, path)));
    else if (entry.name === "ITERATION") out.push(`${path}: ${(await readFile(join(dir, path), "utf8")).split(" ")[0]}`);
    else out.push(`${path}: ${(await readFile(join(dir, path))).toString("base64")}`);
  }
  return out;
}

function staged(repo: string): string[] {
  return git(repo, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter((line) => line !== "" && !line.includes("PROGRESS.yaml"))
    .sort();
}

describe("Tutor in a capstone-project-starter clone", { skip }, () => {
  test("adopting 001 to 004 through the tools leaves the clone as the starter's fetch.sh does", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tutor-starter-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const tutorRepo = join(root, "tutor/capstone-project-starter");
    const fetchRepo = join(root, "fetch/capstone-project-starter");
    const courseRoot = join(root, "course/tutorial");
    for (const [from, to] of [
      [starterPath ?? "", tutorRepo],
      [starterPath ?? "", fetchRepo],
      [coursePath ?? "", courseRoot],
    ] as const) {
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to, { recursive: true, verbatimSymlinks: true });
    }
    const course: Course = await createCourseSource().loadCourse(courseRoot);

    // Tutor: the BB project is the clone's top folder; each lesson is adopted, passed, completed and committed.
    const host = await makeTutorHost(course, tutorRepo, undefined, { projectName: "capstone-project-starter" });
    t.after(() => host.harness.lifecycle.dispose());
    for (const id of ["000", "001", "002", "003"]) {
      const coach = await coachFor(host, id);
      await ok(host, "tutor_adopt_iteration", { iteration: id }, coach);
      const lesson = findLesson(course, id) ?? assert.fail(`no lesson ${id}`);
      for (const example of lessonExamples(lesson)) {
        await ok(host, "tutor_mark_example", { example: example.key, status: "passing", evidence: "$ ./factory\nok" }, coach);
      }
      await ok(host, "tutor_complete_iteration", { iteration: id, summary: `Done ${id}.` }, coach);
      git(tutorRepo, "add", "-A");
      git(tutorRepo, "commit", "-q", "-m", `Iteration ${id}`);
    }
    const coach4 = await coachFor(host, "004");
    const adopted = await ok(host, "tutor_adopt_iteration", { iteration: "004" }, coach4);
    assert.match(adopted, /the factory now lives in factory\//);

    // The coaching method is the starter's coach-me skill, at the clone's top folder.
    const [spawn] = host.harness.inspection.sdk.callsTo("threads.spawn")[0] as [{ prompt: string }];
    assert.match(spawn.prompt, /\.agents\/skills\/coach-me\/SKILL\.md/);

    // fetch.sh: run from the factory's folder, then the student marks the iteration done and commits.
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "curl"),
      `#!/usr/bin/env bash\nexec tar -cz -C "${dirname(courseRoot)}" --exclude=.git "tutorial"\n`,
    );
    await chmod(join(bin, "curl"), 0o755);
    const fetchSh = join(fetchRepo, ".agents/skills/fetch-iteration/fetch.sh");
    const env = { ...GIT_ENV, PATH: `${bin}:${process.env["PATH"] ?? ""}` };
    for (const id of ["001", "002", "003"]) {
      execFileSync("bash", [fetchSh], { cwd: join(fetchRepo, "tetris/.factory"), env, stdio: "pipe" });
      await writeFile(join(fetchRepo, "tetris/.factory/ITERATION"), `${id} Done\n`);
      git(fetchRepo, "add", "-A");
      git(fetchRepo, "commit", "-q", "-m", `Iteration ${id}`);
    }
    const moved = execFileSync("bash", [fetchSh], { cwd: join(fetchRepo, "tetris/.factory"), env, encoding: "utf8" });
    assert.match(moved, /moved the factory to factory\//);

    assert.deepEqual(staged(tutorRepo), staged(fetchRepo));
    assert.ok(staged(tutorRepo).some((line) => /^R. tetris\/\.factory\/AGENTS\.md -> factory\/AGENTS\.md$/.test(line)));
    assert.equal(await readlink(join(tutorRepo, "factory/.claude/skills")), "../../.agents/skills");
    assert.equal(await readlink(join(tutorRepo, "factory/.claude/skills")), await readlink(join(fetchRepo, "factory/.claude/skills")));
    assert.deepEqual(await tree(tutorRepo), await tree(fetchRepo));
    assert.equal(await readFile(join(tutorRepo, "factory/ITERATION"), "utf8"), "004 WIP\n");
  });
});
