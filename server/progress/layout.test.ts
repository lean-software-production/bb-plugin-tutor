import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { resolveLayout } from "./layout.ts";

/** A temp folder holding a capstone-project-starter clone: `.git`, `.agents/skills` and `tetris/`. */
async function repo(t: TestContext): Promise<string> {
  const top = await realpath(await mkdtemp(join(tmpdir(), "tutor-layout-")));
  t.after(() => rm(top, { recursive: true, force: true }));
  const root = join(top, "capstone-project-starter");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, ".agents/skills/coach-me"), { recursive: true });
  await mkdir(join(root, "tetris/seeds"), { recursive: true });
  return root;
}

test("a starter clone whose factory is still tetris/.factory", async (t) => {
  const root = await repo(t);
  await mkdir(join(root, "tetris/.factory"));
  const layout = await resolveLayout(root);
  assert.equal(layout.mode, "repo");
  assert.equal(layout.repoRoot, root);
  assert.equal(layout.factoryDir, join(root, "tetris/.factory"));
  assert.equal(layout.factoryAt, "early");
  assert.equal(layout.factoryShown, "tetris/.factory");
  assert.equal(layout.codebaseDir, join(root, "tetris"));
  assert.equal(layout.codebase, "tetris");
  assert.equal(layout.seedsDir, join(root, "tetris/seeds"));
  assert.equal(layout.seedsShown, "tetris/seeds");
  assert.equal(layout.skillsDir, join(root, ".agents/skills"));
  assert.deepEqual(layout.problems, []);
  assert.equal(layout.blocked, null);
});

test("from 004 the factory is factory/, beside tetris/, and the seeds stay in tetris/seeds", async (t) => {
  const root = await repo(t);
  await mkdir(join(root, "factory"));
  const layout = await resolveLayout(root);
  assert.equal(layout.mode, "repo");
  assert.equal(layout.factoryDir, join(root, "factory"));
  assert.equal(layout.factoryAt, "late");
  assert.equal(layout.factoryShown, "factory");
  assert.equal(layout.seedsDir, join(root, "tetris/seeds"));
  assert.equal(layout.codebaseDir, join(root, "tetris"));
  assert.deepEqual(layout.problems, []);
  assert.equal(layout.blocked, null);
});

test("with both, factory/ is used and the leftover tetris/.factory is a problem", async (t) => {
  const root = await repo(t);
  await mkdir(join(root, "factory"));
  await mkdir(join(root, "tetris/.factory"));
  const layout = await resolveLayout(root);
  assert.equal(layout.factoryDir, join(root, "factory"));
  assert.equal(layout.factoryAt, "late");
  assert.equal(layout.problems.length, 1);
  assert.match(layout.problems[0] ?? "", /Both factory\/ and tetris\/\.factory/);
  assert.equal(layout.blocked, null);
});

test("with neither, the factory is where lesson 000 expects it, and nothing is written until it is there", async (t) => {
  const root = await repo(t);
  const layout = await resolveLayout(root);
  assert.equal(layout.mode, "repo");
  assert.equal(layout.factoryDir, join(root, "tetris/.factory"));
  assert.equal(layout.factoryAt, "early");
  assert.match(layout.problems[0] ?? "", /no factory folder/);
  assert.match(layout.blocked ?? "", /tetris\/\.factory/);
});

test("a factory that is a symbolic link or a file is refused", async (t) => {
  for (const kind of ["link", "file"] as const) {
    const root = await repo(t);
    await mkdir(join(root, "tetris/.factory"));
    if (kind === "link") await symlink("tetris/.factory", join(root, "factory"));
    else await writeFile(join(root, "factory"), "not a folder\n");
    const layout = await resolveLayout(root);
    assert.equal(layout.mode, "repo", kind);
    assert.match(layout.problems.join(" "), kind === "link" ? /factory is a symbolic link/ : /factory is a file/, kind);
    assert.match(layout.blocked ?? "", /factory/, kind);
  }
});

test("legacy: a project whose folder is the factory itself (v0.1.0's tetris/.factory)", async (t) => {
  const root = await repo(t);
  const factory = join(root, "tetris/.factory");
  await mkdir(factory);
  const layout = await resolveLayout(factory);
  assert.equal(layout.mode, "legacy");
  assert.equal(layout.factoryDir, factory);
  assert.equal(layout.factoryAt, null);
  assert.equal(layout.repoRoot, root);
  assert.equal(layout.codebaseDir, join(root, "tetris"));
  assert.equal(layout.codebase, "tetris");
  assert.equal(layout.seedsDir, join(root, "tetris/seeds"));
  assert.equal(layout.seedsShown, "../seeds");
  assert.deepEqual(layout.problems, []);
  assert.equal(layout.blocked, null);
});

test("legacy: a factory repo of its own (it holds .git and ITERATION) stays the factory", async (t) => {
  const top = await realpath(await mkdtemp(join(tmpdir(), "tutor-layout-")));
  t.after(() => rm(top, { recursive: true, force: true }));
  const root = join(top, "my-factory");
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, "ITERATION"), "001 Done\n");
  const layout = await resolveLayout(root);
  assert.equal(layout.mode, "legacy");
  assert.equal(layout.factoryDir, root);
  assert.equal(layout.repoRoot, root);
  assert.equal(layout.codebaseDir, top);
  assert.equal(layout.blocked, null);
});
