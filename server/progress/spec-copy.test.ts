import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { makeSandbox } from "../../test/helpers/disk.ts";
import { copyHomeworkSpec, seedFileName } from "./spec-copy.ts";

test("names the seed after its title, as coach-me names tetris.md", () => {
  assert.equal(seedFileName("# Tetris\n\nA game.", "001"), "tetris.md");
  assert.equal(seedFileName("no title here", "004"), "homework-004.md");
});

test("spec/ holds exactly the homework, keeping Tutor's own files", async () => {
  const sandbox = await makeSandbox();
  try {
    const spec = join(sandbox.factoryRoot, "spec");
    await mkdir(join(spec, "features"), { recursive: true });
    await writeFile(join(spec, "ITERATION"), "001 Done\n");
    await writeFile(join(spec, "PROGRESS.yaml"), 'iteration: "001"\nexamples: {}\n');
    await writeFile(join(spec, "features/old.feature"), "Feature: old\n");
    await writeFile(join(spec, "NOTES.md"), "left over\n");

    const homework = sandbox.course.homeworks[2];
    assert.ok(homework !== undefined);
    const result = await copyHomeworkSpec(sandbox.factoryRoot, homework);

    assert.deepEqual((await readdir(spec)).sort(), ["FACTORY.md", "ITERATION", "PROGRESS.yaml", "README.md", "features"]);
    assert.deepEqual((await readdir(join(spec, "features"))).sort(), ["planning.feature", "validation.feature"]);
    assert.equal(await readFile(join(spec, "README.md"), "utf8"), homework.readme);
    assert.equal(result.seed, null);
  } finally {
    await sandbox.cleanup();
  }
});

test("copies the sample seed into seeds/ unless it is already there", async () => {
  const sandbox = await makeSandbox();
  try {
    const homework = sandbox.course.homeworks[1];
    assert.ok(homework !== undefined && homework.seedSpec !== null);
    const first = await copyHomeworkSpec(sandbox.factoryRoot, homework);
    assert.equal(first.seed, "seeds/tetris.md");
    assert.equal(await readFile(join(sandbox.factoryRoot, "seeds/tetris.md"), "utf8"), homework.seedSpec);

    await writeFile(join(sandbox.factoryRoot, "seeds/tetris.md"), "my own tetris\n");
    const second = await copyHomeworkSpec(sandbox.factoryRoot, homework);
    assert.equal(second.seedAlreadyThere, true);
    assert.equal(await readFile(join(sandbox.factoryRoot, "seeds/tetris.md"), "utf8"), "my own tetris\n");
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a spec/ that is a symbolic link, and deletes nothing through it", async () => {
  const sandbox = await makeSandbox();
  try {
    const src = join(sandbox.factoryRoot, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "main.ts"), "the student's code\n");
    await symlink("src", join(sandbox.factoryRoot, "spec"));
    const homework = sandbox.course.homeworks[2];
    assert.ok(homework !== undefined);

    await assert.rejects(copyHomeworkSpec(sandbox.factoryRoot, homework), /spec\/ .*symbolic link/);
    assert.deepEqual(await readdir(src), ["main.ts"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a seeds/ that is a symbolic link, and a seed that is one, writing nothing outside the factory", async () => {
  const sandbox = await makeSandbox();
  try {
    const outside = join(sandbox.root, "outside");
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(sandbox.factoryRoot, "seeds"));
    const homework = sandbox.course.homeworks[1];
    assert.ok(homework !== undefined && homework.seedSpec !== null);

    await assert.rejects(copyHomeworkSpec(sandbox.factoryRoot, homework), /seeds\/ .*symbolic link/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(await readdir(join(sandbox.factoryRoot, "spec")).catch(() => null), null, "spec/ is untouched");

    await rm(join(sandbox.factoryRoot, "seeds"));
    await mkdir(join(sandbox.factoryRoot, "seeds"));
    await symlink(join(outside, "tetris.md"), join(sandbox.factoryRoot, "seeds/tetris.md"));
    const result = await copyHomeworkSpec(sandbox.factoryRoot, homework);
    assert.equal(result.seedAlreadyThere, true);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a homework with no feature files, keeping the previous spec snapshot", async () => {
  const sandbox = await makeSandbox();
  try {
    const first = sandbox.course.homeworks[1];
    const second = sandbox.course.homeworks[2];
    assert.ok(first !== undefined && second !== undefined);
    await copyHomeworkSpec(sandbox.factoryRoot, first);
    await rm(join(second.dir, "features"), { recursive: true });

    await assert.rejects(copyHomeworkSpec(sandbox.factoryRoot, second), /no feature files/);
    assert.deepEqual(await readdir(join(sandbox.factoryRoot, "spec/features")), ["planning.feature"]);
  } finally {
    await sandbox.cleanup();
  }
});
