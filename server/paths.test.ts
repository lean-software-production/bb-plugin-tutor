import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isInside, overlaps, realPath } from "./paths.ts";

test("isInside compares whole path segments", () => {
  assert.equal(isInside("/w/tutorial", "/w/tutorial"), true);
  assert.equal(isInside("/w/tutorial", "/w/tutorial/docs/x"), true);
  assert.equal(isInside("/w/tutorial/", "/w/tutorial/../tutorial/docs"), true);
  assert.equal(isInside("/w/tutorial", "/w/tutorial-factory"), false);
  assert.equal(isInside("/w/tutorial", "/w/..tutorial"), false);
  assert.equal(isInside("/w/tutorial", "/w"), false);
});

test("overlaps is either way round", () => {
  assert.equal(overlaps("/w", "/w/tutorial"), true);
  assert.equal(overlaps("/w/tutorial/docs", "/w/tutorial"), true);
  assert.equal(overlaps("/w/a", "/w/b"), false);
});

test("realPath follows symbolic links, and resolves paths that do not exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "tutor-paths-"));
  try {
    await symlink(root, join(root, "link"));
    assert.equal(await realPath(join(root, "link")), await realPath(root));
    assert.equal(await realPath("/nonexistent/a/../b"), "/nonexistent/b");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
