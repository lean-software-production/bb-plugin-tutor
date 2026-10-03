import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fixtureBuiltinCourse, fixtureCourseTo004 } from "../../shared/fixtures.ts";
import type { Lesson } from "../../shared/model.ts";
import { adoptInput } from "../../test/helpers/adopt.ts";
import { git, makeRepoSandbox, type Sandbox } from "../../test/helpers/disk.ts";
import { createDiskAccess } from "../../test/helpers/disk-access.ts";
import { adoptIntoWorkspace } from "./adopt.ts";
import { resolveLayout } from "./detect.ts";
import { checkFactoryMove, moveFactory, needsFactoryMove } from "./factory-move.ts";

const disk = createDiskAccess();

// The starter's fetch.sh (.agents/skills/fetch-iteration/fetch.sh), its last
// step verbatim: run from the repo's top folder once it has adopted 004 in
// tetris/.factory. test/starter.test.ts runs the whole real script.
const FETCH_SH_MOVE_STEP = `
  git mv tetris/.factory factory
  ln -sfn ../../.agents/skills factory/.claude/skills
  git add factory/.claude/skills
`;

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function lessonOf(sandbox: Sandbox, id: string): Lesson {
  const found = sandbox.course.lessons.find((lesson) => lesson.id === id);
  if (found === undefined) throw new Error(`no lesson ${id}`);
  return found;
}

/** A starter clone, committed, at the end of lesson 003: ITERATION says 003 Done, with an untracked job and PROGRESS.yaml beside. */
async function at003(t: TestContext): Promise<Sandbox> {
  const sandbox = await makeRepoSandbox({ git: true, course: fixtureCourseTo004 });
  t.after(() => sandbox.cleanup());
  const factory = sandbox.factoryRoot;
  await mkdir(join(factory, "spec/features"), { recursive: true });
  await writeFile(join(factory, "spec/README.md"), "# Homework 3\n");
  await writeFile(join(factory, "spec/features/assembly-line.feature"), "Feature: Assembly line\n");
  await writeFile(join(factory, "ITERATION"), "003 Done\n");
  await writeFile(join(factory, "factory.py"), "print('factory')\n");
  git(sandbox.repoRoot, "add", "-A");
  git(sandbox.repoRoot, "commit", "-q", "-m", "Finish 003");
  await writeFile(join(factory, "spec/PROGRESS.yaml"), "iteration: '003'\n");
  await mkdir(join(factory, "jobs/t1"), { recursive: true });
  await writeFile(join(factory, "jobs/t1/plan.md"), "- a task\n");
  return sandbox;
}

async function tree(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (path === ".git") continue;
    if (entry.isDirectory()) out.push(`${path}/`, ...(await tree(dir, path)));
    else out.push(entry.isSymbolicLink() ? `${path} -> ${await readlink(join(dir, path))}` : path);
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

test("the move at 004 is due only in a starter clone whose factory is still tetris/.factory, from lesson 4 on", async (t) => {
  const sandbox = await at003(t);
  const early = await resolveLayout(sandbox.repoRoot, disk);
  assert.equal(needsFactoryMove(early, lessonOf(sandbox, "003")), false);
  assert.equal(needsFactoryMove(early, lessonOf(sandbox, "004")), true);
  assert.equal(needsFactoryMove(early, fixtureBuiltinCourse.lessons[0] ?? assert.fail("no Lesson 0")), false);
  // A factory that is its own project (v0.1.0) is never moved.
  assert.equal(needsFactoryMove(await resolveLayout(sandbox.factoryRoot, disk), lessonOf(sandbox, "004")), false);
  git(sandbox.repoRoot, "mv", "tetris/.factory", "factory");
  assert.equal(needsFactoryMove(await resolveLayout(sandbox.repoRoot, disk), lessonOf(sandbox, "004")), false);
});

test("Tutor's move leaves the repo as fetch.sh's does: the same staged changes and the same skills link", async (t) => {
  const tutor = await at003(t);
  const fetch = await at003(t);

  const layout = await resolveLayout(tutor.repoRoot, disk);
  await moveFactory(layout, await checkFactoryMove(layout));
  execFileSync("bash", ["-euo", "pipefail", "-c", FETCH_SH_MOVE_STEP], { cwd: fetch.repoRoot, env: GIT_ENV });

  const porcelain = (sandbox: Sandbox) => git(sandbox.repoRoot, "status", "--porcelain");
  assert.equal(porcelain(tutor), porcelain(fetch));
  assert.match(porcelain(tutor), /^R {2}tetris\/\.factory\/factory\.py -> factory\/factory\.py$/m);
  assert.equal(await readlink(join(tutor.repoRoot, "factory/.claude/skills")), "../../.agents/skills");
  assert.equal(await readlink(join(tutor.repoRoot, "factory/.claude/skills")), await readlink(join(fetch.repoRoot, "factory/.claude/skills")));
  assert.deepEqual(await tree(tutor.repoRoot), await tree(fetch.repoRoot));
  // The untracked job and PROGRESS.yaml went with the factory.
  assert.equal(await readFile(join(tutor.repoRoot, "factory/jobs/t1/plan.md"), "utf8"), "- a task\n");
  assert.equal(await exists(join(tutor.repoRoot, "tetris/.factory")), false);
  // The link resolves to the skills from factory/.claude.
  assert.equal(await exists(join(tutor.repoRoot, "factory/.claude/skills/coach-me/SKILL.md")), true);
});

test("adopting 003, or 004 once the factory is factory/, does not move anything", async (t) => {
  const sandbox = await at003(t);
  const at3 = await adoptIntoWorkspace(await adoptInput(sandbox, "003"), disk);
  assert.equal(at3.moved, false);
  assert.equal(at3.factoryShown, "tetris/.factory");
  assert.deepEqual(at3.written.slice(0, 1), ["tetris/.factory/spec/README.md"]);
  git(sandbox.repoRoot, "mv", "tetris/.factory", "factory");
  const at4 = await adoptIntoWorkspace(await adoptInput(sandbox, "004"), disk);
  assert.equal(at4.moved, false);
  assert.equal(at4.factoryShown, "factory");
  assert.equal(await exists(join(sandbox.repoRoot, "tetris/.factory")), false);
});

test("a refused move writes nothing: not a git repo, factory/ already there, or a spec that can't be adopted", async (t) => {
  // An empty .git folder: git mv -n fails.
  const bare = await makeRepoSandbox({ course: fixtureCourseTo004 });
  t.after(() => bare.cleanup());
  const before = await tree(bare.repoRoot);
  await assert.rejects(adoptIntoWorkspace(await adoptInput(bare, "004"), disk), /could not move tetris\/\.factory to factory\//);
  assert.deepEqual(await tree(bare.repoRoot), before);

  // factory/ turns up after the layout was read.
  const raced = await at003(t);
  const layout = await resolveLayout(raced.repoRoot, disk);
  await mkdir(join(raced.repoRoot, "factory"));
  const racedBefore = await tree(raced.repoRoot);
  await assert.rejects(checkFactoryMove(layout), /factory\/ already exists/);
  assert.deepEqual(await tree(raced.repoRoot), racedBefore);

  // spec/ is a file: the spec check refuses before the move.
  const badSpec = await at003(t);
  await rm(join(badSpec.factoryRoot, "spec"), { recursive: true });
  await writeFile(join(badSpec.factoryRoot, "spec"), "not a folder\n");
  const badBefore = await tree(badSpec.repoRoot);
  await assert.rejects(adoptIntoWorkspace(await adoptInput(badSpec, "004"), disk), /spec\/ in the factory is a file/);
  assert.deepEqual(await tree(badSpec.repoRoot), badBefore);
});

test("a real .claude/skills folder is left alone, with a note", async (t) => {
  const sandbox = await at003(t);
  const skills = join(sandbox.factoryRoot, ".claude/skills");
  await rm(skills);
  await mkdir(join(skills, "mine"), { recursive: true });
  await writeFile(join(skills, "mine/SKILL.md"), "mine\n");
  git(sandbox.repoRoot, "add", "-A", "tetris/.factory/.claude");
  git(sandbox.repoRoot, "commit", "-q", "-m", "My own skills");
  const adoption = await adoptIntoWorkspace(await adoptInput(sandbox, "004"), disk);
  assert.equal(adoption.moved, true);
  assert.match(adoption.note ?? "", /\.claude\/skills is a folder/);
  assert.equal((await lstat(join(sandbox.repoRoot, "factory/.claude/skills"))).isDirectory(), true);
  assert.equal(await readFile(join(sandbox.repoRoot, "factory/.claude/skills/mine/SKILL.md"), "utf8"), "mine\n");
});
