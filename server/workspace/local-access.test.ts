import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WriteConflictError } from "./access.ts";
import { createLocalAccess } from "./local-access.ts";

const local = createLocalAccess();

async function sandbox(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tutor-local-access-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("a write creates parent folders, replaces content, keeps the old file's mode and leaves no temp file", async (t) => {
  const dir = await sandbox(t);
  const path = join(dir, "spec/PROGRESS.yaml");
  await local.write(path, "one\n", null);
  await chmod(path, 0o640);
  await local.write(path, "two\n", (await local.read(path))?.sha256);
  assert.equal(await readFile(path, "utf8"), "two\n");
  assert.equal((await stat(path)).mode & 0o777, 0o640);
  assert.deepEqual(await readdir(join(dir, "spec")), ["PROGRESS.yaml"]);
});

test("a write that fails leaves no temp file behind", async (t) => {
  const dir = await sandbox(t);
  // A non-empty folder where the file goes: the rename onto it fails.
  const path = join(dir, "ITERATION");
  await mkdir(path);
  await writeFile(join(path, "keep"), "x");
  await assert.rejects(local.write(path, "001 WIP\n"));
  assert.deepEqual(await readdir(dir), ["ITERATION"]);
});

test("a write expecting another sha256, or no file, is refused and changes nothing", async (t) => {
  const dir = await sandbox(t);
  const path = join(dir, "ITERATION");
  await writeFile(path, "001 WIP\n");
  await assert.rejects(local.write(path, "002 WIP\n", "0".repeat(64)), WriteConflictError);
  await assert.rejects(local.write(path, "002 WIP\n", null), WriteConflictError);
  assert.equal(await readFile(path, "utf8"), "001 WIP\n");
});

test("kinds tell folders, links, files and nothing apart; remove ignores a file already gone", async (t) => {
  const dir = await sandbox(t);
  await writeFile(join(dir, "file"), "x");
  const kinds = await local.kinds([dir, join(dir, "file"), join(dir, "none")]);
  assert.deepEqual(Object.values(kinds), ["folder", "file", "none"]);
  await local.remove(join(dir, "file"));
  await local.remove(join(dir, "file"));
  assert.deepEqual(await readdir(dir), []);
});
