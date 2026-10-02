import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDiskAccess } from "../test/helpers/disk-access.ts";
import { NOT_READY, notReadyText, resolveCourseLayout } from "./state.ts";

test("a course without a layout is ready at once and keeps progress under .tutor/courses/<id>", async () => {
  const root = await mkdtemp(join(tmpdir(), "ws-"));
  const state = await resolveCourseLayout(null, root, ".tutor/courses/intro", createDiskAccess());
  assert.equal(state.ready, true);
  assert.deepEqual(state.progress, { dir: join(root, ".tutor/courses/intro"), progressFile: "progress.yaml", iterationFiles: ["ITERATION"] });
});

test("capstone-factory is not ready in an empty workspace, and is in a starter clone", async () => {
  const root = await mkdtemp(join(tmpdir(), "ws-"));
  await mkdir(join(root, ".git"));
  const empty = await resolveCourseLayout("capstone-factory", root, ".tutor/courses/x", createDiskAccess());
  assert.equal(empty.ready, false);
  await mkdir(join(root, "tetris/.factory"), { recursive: true });
  const starter = await resolveCourseLayout("capstone-factory", root, ".tutor/courses/x", createDiskAccess());
  assert.equal(starter.ready, true);
  assert.equal(starter.progress.progressFile, "spec/PROGRESS.yaml");
});

test("a not-ready capstone says why in its own words; anything else not ready says to add the course", async () => {
  const root = await mkdtemp(join(tmpdir(), "ws-"));
  await mkdir(join(root, ".git"));
  const empty = await resolveCourseLayout("capstone-factory", root, ".tutor/courses/x", createDiskAccess());
  assert.match(notReadyText(empty), /This repo has no factory folder/);
  const layoutless = await resolveCourseLayout(null, root, ".tutor/courses/x", createDiskAccess());
  assert.equal(notReadyText(layoutless), NOT_READY);
});
