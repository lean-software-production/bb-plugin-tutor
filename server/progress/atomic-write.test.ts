import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeFileAtomic } from "./atomic-write.ts";

test("creates parent folders, replaces content and keeps the old file's mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tutor-atomic-"));
  try {
    const path = join(dir, "spec/PROGRESS.yaml");
    await writeFileAtomic(path, "one\n");
    assert.equal(await readFile(path, "utf8"), "one\n");
    await chmod(path, 0o640);
    await writeFileAtomic(path, "two\n");
    assert.equal(await readFile(path, "utf8"), "two\n");
    assert.equal((await stat(path)).mode & 0o777, 0o640);
    assert.deepEqual(await readdir(join(dir, "spec")), ["PROGRESS.yaml"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
