import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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
    assert.equal(await readFile(join(sandbox.factoryRoot, "ITERATION"), "utf8"), "002 WIP\n");
    assert.deepEqual((await readdir(sandbox.factoryRoot)).sort(), ["ITERATION", "spec"]);
    assert.deepEqual(await readdir(join(sandbox.factoryRoot, "spec")), ["PROGRESS.yaml"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("malformed files become problems, never exceptions", async () => {
  const sandbox = await makeSandbox();
  try {
    await mkdir(join(sandbox.factoryRoot, "spec"));
    await writeFile(join(sandbox.factoryRoot, "ITERATION"), "three\n");
    await writeFile(join(sandbox.factoryRoot, "spec/PROGRESS.yaml"), "iteration: [\n");
    const state = await store.read(sandbox.factoryRoot);
    assert.equal(state.iteration, null);
    assert.equal(state.progress, null);
    assert.equal(state.problems.length, 2);
    assert.equal(state.progressUnreadable, true, "a damaged spec/PROGRESS.yaml is not the same as none");
  } finally {
    await sandbox.cleanup();
  }
});

test("a spec/PROGRESS.yaml that can't be read or has no lesson is unreadable; a missing one is not", async () => {
  const sandbox = await makeSandbox();
  try {
    assert.equal((await store.read(sandbox.factoryRoot)).progressUnreadable, undefined);
    await mkdir(join(sandbox.factoryRoot, "spec/PROGRESS.yaml"), { recursive: true });
    assert.equal((await store.read(sandbox.factoryRoot)).progressUnreadable, true, "a folder in its place");
    await rm(join(sandbox.factoryRoot, "spec/PROGRESS.yaml"), { recursive: true });
    await writeFile(join(sandbox.factoryRoot, "spec/PROGRESS.yaml"), "examples: {}\n");
    assert.equal((await store.read(sandbox.factoryRoot)).progressUnreadable, true, "no iteration");
    await writeFile(join(sandbox.factoryRoot, "spec/PROGRESS.yaml"), 'iteration: "001"\nexamples: {}\n');
    assert.equal((await store.read(sandbox.factoryRoot)).progressUnreadable, undefined);
  } finally {
    await sandbox.cleanup();
  }
});

test("reads ITERATION at the factory root", async () => {
  const sandbox = await makeSandbox();
  try {
    await writeFile(join(sandbox.factoryRoot, "ITERATION"), "003 WIP\n");
    assert.deepEqual((await store.read(sandbox.factoryRoot)).iteration, { iteration: "003", status: "WIP" });
  } finally {
    await sandbox.cleanup();
  }
});

test("falls back to a factory's older spec/ITERATION", async () => {
  const sandbox = await makeSandbox();
  try {
    await mkdir(join(sandbox.factoryRoot, "spec"));
    await writeFile(join(sandbox.factoryRoot, "spec/ITERATION"), "002 Done\n");
    assert.deepEqual((await store.read(sandbox.factoryRoot)).iteration, { iteration: "002", status: "Done" });
  } finally {
    await sandbox.cleanup();
  }
});

test("the root ITERATION wins over spec/ITERATION", async () => {
  const sandbox = await makeSandbox();
  try {
    await mkdir(join(sandbox.factoryRoot, "spec"));
    await writeFile(join(sandbox.factoryRoot, "spec/ITERATION"), "002 Done\n");
    await writeFile(join(sandbox.factoryRoot, "ITERATION"), "003 WIP\n");
    assert.deepEqual(await store.read(sandbox.factoryRoot), {
      iteration: { iteration: "003", status: "WIP" },
      progress: null,
      problems: [],
    });
  } finally {
    await sandbox.cleanup();
  }
});

test("a problem names the ITERATION file it came from", async () => {
  const sandbox = await makeSandbox();
  try {
    await writeFile(join(sandbox.factoryRoot, "ITERATION"), "three\n");
    assert.match((await store.read(sandbox.factoryRoot)).problems[0] ?? "", /^ITERATION should read like "003 WIP"/);
    await mkdir(join(sandbox.factoryRoot, "spec"));
    await writeFile(join(sandbox.factoryRoot, "spec/ITERATION"), "four\n");
    await rm(join(sandbox.factoryRoot, "ITERATION"));
    assert.match((await store.read(sandbox.factoryRoot)).problems[0] ?? "", /^spec\/ITERATION should read like "003 WIP"/);
  } finally {
    await sandbox.cleanup();
  }
});

test("writing ITERATION writes the root file and removes spec/ITERATION", async () => {
  const sandbox = await makeSandbox();
  try {
    await mkdir(join(sandbox.factoryRoot, "spec"));
    await writeFile(join(sandbox.factoryRoot, "spec/ITERATION"), "001 Done\n");
    await writeFile(join(sandbox.factoryRoot, "spec/README.md"), "# Lesson 1\n");
    await store.writeIteration(sandbox.factoryRoot, { iteration: "002", status: "WIP" });
    assert.equal(await readFile(join(sandbox.factoryRoot, "ITERATION"), "utf8"), "002 WIP\n");
    assert.deepEqual(await readdir(join(sandbox.factoryRoot, "spec")), ["README.md"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("writing ITERATION with no spec/ creates no spec/", async () => {
  const sandbox = await makeSandbox();
  try {
    await store.writeIteration(sandbox.factoryRoot, { iteration: "001", status: "WIP" });
    assert.deepEqual(await readdir(sandbox.factoryRoot), ["ITERATION"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses to write ITERATION for Lesson 0", async () => {
  await assert.rejects(store.writeIteration("/nonexistent", { iteration: "000", status: "WIP" }), /Lesson 0/);
});

test("refuses to write PROGRESS.yaml through a spec/ that is a symbolic link, and never removes an ITERATION through it", async () => {
  const sandbox = await makeSandbox();
  try {
    await mkdir(join(sandbox.factoryRoot, "src"));
    await writeFile(join(sandbox.factoryRoot, "src/ITERATION"), "001 Done\n");
    await symlink("src", join(sandbox.factoryRoot, "spec"));
    const progress = fixtureStudent.progress;
    assert.ok(progress !== null);
    await assert.rejects(store.writeProgress(sandbox.factoryRoot, progress), /symbolic link/);
    await store.writeIteration(sandbox.factoryRoot, { iteration: "002", status: "WIP" });
    assert.equal(await readFile(join(sandbox.factoryRoot, "ITERATION"), "utf8"), "002 WIP\n");
    assert.deepEqual(await readdir(join(sandbox.factoryRoot, "src")), ["ITERATION"]);
  } finally {
    await sandbox.cleanup();
  }
});
