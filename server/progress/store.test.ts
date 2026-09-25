import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fixtureStudent } from "../../shared/fixtures.ts";
import { makeSandbox } from "../../test/helpers/disk.ts";
import { createProgressStore } from "./store.ts";

const store = createProgressStore();

test("a repo nobody has coached reads as empty state", async () => {
  const sandbox = await makeSandbox();
  try {
    assert.deepEqual(await store.read(sandbox.factoryRoot), { iteration: null, progress: null, problems: [] });
  } finally {
    await sandbox.cleanup();
  }
});

test("progress and iteration round-trip, and writes leave no temp files", async () => {
  const sandbox = await makeSandbox();
  try {
    const progress = fixtureStudent.progress;
    assert.ok(progress !== null);
    await store.writeIteration(sandbox.factoryRoot, { iteration: "002", status: "WIP" });
    await store.writeProgress(sandbox.factoryRoot, progress);
    assert.deepEqual(await store.read(sandbox.factoryRoot), fixtureStudent);
    assert.equal(await readFile(join(sandbox.factoryRoot, "spec/ITERATION"), "utf8"), "002 WIP\n");
    assert.deepEqual((await readdir(join(sandbox.factoryRoot, "spec"))).sort(), ["ITERATION", "PROGRESS.yaml"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("malformed files become problems, never exceptions", async () => {
  const sandbox = await makeSandbox();
  try {
    await mkdir(join(sandbox.factoryRoot, "spec"));
    await writeFile(join(sandbox.factoryRoot, "spec/ITERATION"), "three\n");
    await writeFile(join(sandbox.factoryRoot, "spec/PROGRESS.yaml"), "iteration: [\n");
    const state = await store.read(sandbox.factoryRoot);
    assert.equal(state.iteration, null);
    assert.equal(state.progress, null);
    assert.equal(state.problems.length, 2);
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses to write spec/ITERATION for Homework 0", async () => {
  await assert.rejects(store.writeIteration("/nonexistent", { iteration: "000", status: "WIP" }), /Homework 0/);
});
