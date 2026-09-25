import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
