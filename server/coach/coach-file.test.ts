import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { resolveCoachFile } from "./coach-file.ts";

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

test("without a course coach file, the starter's coach-me skill beside the factory is the method", async (t) => {
  const { factory, skill } = await starter(t, true);
  assert.equal(await resolveCoachFile(null, factory), skill);
});

test("the skill is found beside the factory's real folder, not beside a link to it", async (t) => {
  const { factory, skill, top } = await starter(t, true);
  const link = join(top, "my-factory");
  await symlink(factory, link);
  assert.equal(await resolveCoachFile(null, link), skill);
});

test("the course's coach file wins over the starter's skill", async (t) => {
  const { factory } = await starter(t, true);
  assert.equal(await resolveCoachFile("/workspaces/tutorial/.agents/coach-me.md", factory), "/workspaces/tutorial/.agents/coach-me.md");
});

test("with neither, or no factory yet, there is no coaching method file", async (t) => {
  const { factory, skill } = await starter(t, false);
  assert.equal(await resolveCoachFile(null, factory), null);
  assert.equal(await resolveCoachFile(null, null), null);
  // A folder where the skill file should be is not a coach file.
  await mkdir(skill, { recursive: true });
  assert.equal(await resolveCoachFile(null, factory), null);
});
