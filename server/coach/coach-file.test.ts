import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test, type TestContext } from "node:test";
import type { CourseLayoutState } from "../../layouts/state.ts";
import { createDiskAccess } from "../../test/helpers/disk-access.ts";
import { resolveCoachMethod } from "./coach-file.ts";

const disk = createDiskAccess();

/** A CourseLayoutState whose capstone-factory folder is `factoryDir`; nothing else about the layout matters here. */
function layoutAt(factoryDir: string): CourseLayoutState {
  return {
    id: "capstone-factory",
    ready: true,
    layout: {
      mode: "repo",
      projectRoot: factoryDir,
      repoRoot: null,
      factoryDir,
      factoryAt: null,
      factoryShown: factoryDir,
      codebaseDir: factoryDir,
      codebase: "x",
      seedsDir: factoryDir,
      seedsShown: "x",
      skillsDir: null,
      problems: [],
      blocked: null,
    },
    progress: { dir: factoryDir, progressFile: "PROGRESS.yaml", iterationFiles: [] },
    problems: [],
    blocked: null,
  };
}

/** A CourseLayoutState for a course with no layout: resolveCoachMethod never looks in the workspace for one. */
const NO_LAYOUT: CourseLayoutState = { id: null, ready: true, progress: { dir: "/x", progressFile: "progress.yaml", iterationFiles: [] }, problems: [], blocked: null };

/** A capstone-project-starter clone: the codebase tetris/, its factory tetris/.factory, and optionally the coach-me skill. */
async function starter(t: TestContext, withSkill: boolean): Promise<{ factory: string; skill: string; top: string }> {
  const top = await realpath(await mkdtemp(join(tmpdir(), "tutor-coach-file-")));
  t.after(() => rm(top, { recursive: true, force: true }));
  const codebase = join(top, "capstone-project-starter", "tetris");
  const factory = join(codebase, ".factory");
  const skill = join(codebase, ".agents/skills/coach-me/SKILL.md");
  await mkdir(factory, { recursive: true });
  if (withSkill) {
    await mkdir(join(skill, ".."), { recursive: true });
    await writeFile(skill, "---\nname: coach-me\n---\n");
  }
  return { factory, skill, top };
}

test("without a course coach file, the starter's coach-me skill beside the factory is the method, named relative to the workspace", async (t) => {
  const { factory, skill, top } = await starter(t, true);
  assert.deepEqual(await resolveCoachMethod(null, layoutAt(factory), top, disk), { kind: "workspace", relativePath: relative(top, skill) });
});

test("the skill is found beside the factory's real folder, not beside a link to it", async (t) => {
  const { factory, skill, top } = await starter(t, true);
  const link = join(top, "my-factory");
  await symlink(factory, link);
  assert.deepEqual(await resolveCoachMethod(null, layoutAt(link), top, disk), { kind: "workspace", relativePath: relative(top, skill) });
});

test("the course's coach file wins, read and inlined as text", async (t) => {
  const { factory, top } = await starter(t, true);
  const coachPath = join(top, "course-coach.md");
  await writeFile(coachPath, "## Coaching process\nAlways wins.\n");
  assert.deepEqual(await resolveCoachMethod(coachPath, layoutAt(factory), top, disk), { kind: "course", text: "## Coaching process\nAlways wins.\n" });
});

test("with neither, or no factory yet, there is no coaching method", async (t) => {
  const { factory, skill, top } = await starter(t, false);
  assert.equal(await resolveCoachMethod(null, layoutAt(factory), top, disk), null);
  assert.equal(await resolveCoachMethod(null, NO_LAYOUT, top, disk), null);
  // A folder where the skill file should be is not a coach file.
  await mkdir(skill, { recursive: true });
  assert.equal(await resolveCoachMethod(null, layoutAt(factory), top, disk), null);
});

/** The starter as it is now: .git and the skills at the clone's top folder, the factory at tetris/.factory or factory/. */
async function currentStarter(t: TestContext, factoryAt: string): Promise<{ root: string; factory: string; skill: string }> {
  const top = await realpath(await mkdtemp(join(tmpdir(), "tutor-coach-file-")));
  t.after(() => rm(top, { recursive: true, force: true }));
  const root = join(top, "capstone-project-starter");
  const factory = join(root, factoryAt);
  const skill = join(root, ".agents/skills/coach-me/SKILL.md");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(factory, { recursive: true });
  await mkdir(join(skill, ".."), { recursive: true });
  await writeFile(skill, "---\nname: coach-me\n---\n");
  return { root, factory, skill };
}

test("in the current starter, the coach-me skill at the repo's top folder is found from tetris/.factory and from factory/", async (t) => {
  for (const factoryAt of ["tetris/.factory", "factory"]) {
    const { root, factory, skill } = await currentStarter(t, factoryAt);
    assert.deepEqual(await resolveCoachMethod(null, layoutAt(factory), root, disk), { kind: "workspace", relativePath: relative(root, skill) }, factoryAt);
  }
});

test("the search for the skill stops at the repo's top folder", async (t) => {
  const { root, factory } = await currentStarter(t, "tetris/.factory");
  // A nested repo inside the clone: the outer clone's skill is not its coach.
  const inner = join(root, "tetris/inner");
  await mkdir(join(inner, ".git"), { recursive: true });
  await mkdir(join(inner, ".factory"), { recursive: true });
  assert.equal(await resolveCoachMethod(null, layoutAt(join(inner, ".factory")), root, disk), null);
  assert.ok(factory);
});

test("a link to the skill counts only when it leads to a file", async (t) => {
  const { factory, skill, top } = await starter(t, false);
  await mkdir(join(skill, ".."), { recursive: true });
  // A link to a folder, then a dangling link, then a link to a real file.
  await mkdir(join(top, "a-folder"));
  await symlink(join(top, "a-folder"), skill);
  assert.equal(await resolveCoachMethod(null, layoutAt(factory), top, disk), null, "link to a folder");
  await rm(skill);
  await symlink(join(top, "gone.md"), skill);
  assert.equal(await resolveCoachMethod(null, layoutAt(factory), top, disk), null, "dangling link");
  await rm(skill);
  await writeFile(join(top, "real.md"), "---\nname: coach-me\n---\n");
  await symlink(join(top, "real.md"), skill);
  assert.deepEqual(await resolveCoachMethod(null, layoutAt(factory), top, disk), { kind: "workspace", relativePath: relative(top, skill) }, "link to a file");
});
