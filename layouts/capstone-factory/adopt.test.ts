import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fixtureCourseTo004 } from "../../shared/fixtures.ts";
import { adoptInput } from "../../test/helpers/adopt.ts";
import { git, makeRepoSandbox, type Sandbox } from "../../test/helpers/disk.ts";
import { createDiskAccess } from "../../test/helpers/disk-access.ts";
import { parseProgress } from "../progress/progress-yaml.ts";
import { adoptIntoWorkspace, ProgressConflictError } from "./adopt.ts";

const disk = createDiskAccess();

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

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

async function sandboxFor(t: TestContext, options: Parameters<typeof makeRepoSandbox>[0] = {}): Promise<Sandbox> {
  const sandbox = await makeRepoSandbox(options);
  t.after(() => sandbox.cleanup());
  return sandbox;
}

/** A starter clone, committed, at the end of lesson 003: ITERATION says 003 Done, with an untracked job and PROGRESS.yaml beside. */
async function at003(t: TestContext): Promise<Sandbox> {
  const sandbox = await sandboxFor(t, { git: true, course: fixtureCourseTo004 });
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

test("adoption writes spec/, the seed, stand-ins/, then PROGRESS.yaml and ITERATION, as one operation", async (t) => {
  const sandbox = await sandboxFor(t);
  const factory = sandbox.factoryRoot;

  // Lesson 001 into a fresh clone: its seed lands in tetris/seeds.
  const first = await adoptIntoWorkspace(await adoptInput(sandbox, "001"), disk);
  assert.equal(first.moved, false);
  assert.equal(first.factoryShown, "tetris/.factory");
  assert.equal(first.note, null);
  assert.deepEqual(first.written, [
    "tetris/.factory/spec/README.md",
    "tetris/.factory/spec/FACTORY.md",
    "tetris/.factory/spec/features/",
    "tetris/seeds/tetris.md",
    "tetris/.factory/stand-ins/",
  ]);
  assert.equal(await readFile(join(sandbox.codebaseRoot, "seeds/tetris.md"), "utf8"), sandbox.course.lessons[0]?.seedSpec);
  assert.equal(await readFile(join(factory, "ITERATION"), "utf8"), "001 WIP\n");

  // At 001 Done, lesson 002.
  await writeFile(join(factory, "ITERATION"), "001 Done\n");
  const second = await adoptIntoWorkspace(await adoptInput(sandbox, "002"), disk);
  assert.deepEqual(second.written, ["tetris/.factory/spec/README.md", "tetris/.factory/spec/FACTORY.md", "tetris/.factory/spec/features/", "tetris/.factory/stand-ins/"]);
  assert.equal(await readFile(join(factory, "spec/README.md"), "utf8"), sandbox.course.lessons[1]?.readme);
  assert.deepEqual((await readdir(join(factory, "spec/features"))).sort(), ["planning.feature", "validation.feature"]);
  assert.deepEqual((await readdir(join(factory, "stand-ins"))).sort(), ["README.md", "plan-alpha-beta"]);
  assert.equal((await lstat(join(factory, "stand-ins/plan-alpha-beta"))).mode & 0o777, 0o755);
  assert.equal(await readFile(join(factory, "ITERATION"), "utf8"), "002 WIP\n");
  assert.equal(parseProgress(await readFile(join(factory, "spec/PROGRESS.yaml"), "utf8")).progress?.iteration, "002");
});

test("PROGRESS.yaml keeps what this version doesn't read, and an older factory's spec/ITERATION goes once ITERATION is written", async (t) => {
  const sandbox = await sandboxFor(t);
  const factory = sandbox.factoryRoot;
  await mkdir(join(factory, "spec"), { recursive: true });
  await writeFile(join(factory, "spec/ITERATION"), "001 Done\n");
  await writeFile(join(factory, "spec/PROGRESS.yaml"), 'iteration: "001"\nexamples: {}\nlater-tutor: kept\n');

  await adoptIntoWorkspace(await adoptInput(sandbox, "002"), disk);
  assert.match(await readFile(join(factory, "spec/PROGRESS.yaml"), "utf8"), /^later-tutor: kept$/m);
  assert.equal(await readFile(join(factory, "ITERATION"), "utf8"), "002 WIP\n");
  assert.equal(await exists(join(factory, "spec/ITERATION")), false);
});

test("a refusal (no feature files in the bundle) writes nothing, ITERATION and PROGRESS.yaml included", async (t) => {
  const sandbox = await sandboxFor(t, { iteration: "001 Done", progress: { iteration: "001" } });
  const input = await adoptInput(sandbox, "002");
  const before = await snapshot(sandbox.repoRoot);

  const noFeatures = { entries: input.spec.entries.filter((entry) => !entry.path.startsWith("features/")) };
  await assert.rejects(adoptIntoWorkspace({ ...input, spec: noFeatures }, disk), /Lesson 002 has no feature files/);
  assert.deepEqual(await snapshot(sandbox.repoRoot), before);

  // A bundle that would write outside its folder is refused as a whole, before anything else.
  const escaping = { entries: [...input.spec.entries, { kind: "symlink" as const, path: "features/x.feature", target: "../../../../x" }] };
  await assert.rejects(adoptIntoWorkspace({ ...input, spec: escaping }, disk), /escapes the bundle/);
  assert.deepEqual(await snapshot(sandbox.repoRoot), before);
});

test("a progress file that changed since the server read it is a conflict, and nothing is written", async (t) => {
  const sandbox = await sandboxFor(t, { iteration: "001 Done", progress: { iteration: "001" } });
  const input = await adoptInput(sandbox, "002");
  await writeFile(join(sandbox.factoryRoot, "spec/PROGRESS.yaml"), 'iteration: "001"\nexamples: {}\nsummary: edited meanwhile\n');
  const before = await snapshot(sandbox.repoRoot);

  await assert.rejects(adoptIntoWorkspace(input, disk), ProgressConflictError);
  assert.deepEqual(await snapshot(sandbox.repoRoot), before);
  // The server read no file (null), but there is one now.
  await assert.rejects(adoptIntoWorkspace({ ...input, progressSha256: null }, disk), ProgressConflictError);
  assert.deepEqual(await snapshot(sandbox.repoRoot), before);

  // Read again, the adoption goes ahead.
  await adoptIntoWorkspace(await adoptInput(sandbox, "002"), disk);
  assert.equal(await readFile(join(sandbox.factoryRoot, "ITERATION"), "utf8"), "002 WIP\n");
});

test("adopting 004 moves tetris/.factory to factory/ with git mv and re-links .claude/skills, then adopts there", async (t) => {
  const sandbox = await at003(t);
  const repo = sandbox.repoRoot;
  const adoption = await adoptIntoWorkspace(await adoptInput(sandbox, "004"), disk);
  assert.equal(adoption.moved, true);
  assert.equal(adoption.factoryShown, "factory");
  assert.deepEqual(adoption.written, ["factory/spec/README.md", "factory/spec/FACTORY.md", "factory/spec/features/", "factory/stand-ins/"]);
  assert.equal(await exists(join(repo, "tetris/.factory")), false);
  assert.match(await readFile(join(repo, "factory/spec/README.md"), "utf8"), /Homework 4/);
  assert.equal(await readlink(join(repo, "factory/.claude/skills")), "../../.agents/skills");
  assert.equal(await readFile(join(repo, "factory/jobs/t1/plan.md"), "utf8"), "- a task\n", "the untracked job went with the factory");
  // ITERATION and PROGRESS.yaml are written last, in factory/.
  assert.equal(await readFile(join(repo, "factory/ITERATION"), "utf8"), "004 WIP\n");
  assert.match(await readFile(join(repo, "factory/spec/PROGRESS.yaml"), "utf8"), /^iteration: "004"\n/);
  assert.match(git(repo, "status", "--porcelain"), /^R. tetris\/\.factory\/factory\.py -> factory\/factory\.py$/m);
});

test("a failure after the move leaves factory/ at 003 Done, and a second call adopts without moving again", async (t) => {
  const sandbox = await at003(t);
  const repo = sandbox.repoRoot;
  const failing = { afterMovedAside: () => Promise.reject(new Error("disk full")) };
  await assert.rejects(adoptIntoWorkspace(await adoptInput(sandbox, "004"), disk, { hooks: failing }), /disk full/);
  assert.equal(await exists(join(repo, "tetris/.factory")), false);
  assert.equal(await readFile(join(repo, "factory/ITERATION"), "utf8"), "003 Done\n");
  assert.equal(await readFile(join(repo, "factory/spec/PROGRESS.yaml"), "utf8"), "iteration: '003'\n");
  assert.match(await readFile(join(repo, "factory/spec/README.md"), "utf8"), /Homework 3/);

  const retry = await adoptIntoWorkspace(await adoptInput(sandbox, "004"), disk);
  assert.equal(retry.moved, false);
  assert.equal(retry.factoryShown, "factory");
  assert.match(await readFile(join(repo, "factory/spec/README.md"), "utf8"), /Homework 4/);
  assert.equal(await readlink(join(repo, "factory/.claude/skills")), "../../.agents/skills");
  assert.equal(await readFile(join(repo, "factory/ITERATION"), "utf8"), "004 WIP\n");
});

test("a factory Tutor must not write into is refused with why, writing nothing", async (t) => {
  const sandbox = await sandboxFor(t);
  const elsewhere = join(sandbox.root, "elsewhere");
  await mkdir(elsewhere);
  await rm(sandbox.factoryRoot, { recursive: true });
  await symlink(elsewhere, sandbox.factoryRoot);
  const before = await snapshot(sandbox.root);
  await assert.rejects(adoptIntoWorkspace(await adoptInput(sandbox, "001"), disk), /symbolic link/);
  assert.deepEqual(await snapshot(sandbox.root), before);
});
