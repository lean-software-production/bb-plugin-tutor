import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makeSandbox } from "../../test/helpers/disk.ts";
import { bundleBytes, MAX_BUNDLE_BYTES } from "../../shared/bundle.ts";
import { bundleFolder, lessonSpecBundle, standInsBundle } from "./make-bundle.ts";

test("bundleFolder reads files, modes and links; the fixture course's largest lesson is far under the limit", async () => {
  const sandbox = await makeSandbox();
  try {
    const lesson = sandbox.course.lessons.find((entry) => entry.id === "002");
    assert.ok(lesson !== undefined);
    const bundle = await bundleFolder(lesson.dir);
    assert.ok(bundle.entries.some((entry) => entry.path === "README.md"));
    assert.ok(bundleBytes(bundle) < MAX_BUNDLE_BYTES / 100);

    const standIns = await bundleFolder(join(sandbox.course.root, "stand-ins"));
    const planAlphaBeta = standIns.entries.find((entry) => entry.path === "plan-alpha-beta");
    assert.ok(planAlphaBeta !== undefined && planAlphaBeta.kind === "file");
    assert.equal(planAlphaBeta.kind === "file" && planAlphaBeta.executable, true);
  } finally {
    await sandbox.cleanup();
  }
});

test("bundleFolder nests sub-folders into relative paths and reads a symbolic link's target", async () => {
  const root = await mkdtemp(join(tmpdir(), "bundle-test-"));
  try {
    await mkdir(join(root, "features"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Hello\n");
    await writeFile(join(root, "features/one.feature"), "Feature: one\n");
    await symlink("one.feature", join(root, "features/alias.feature"));

    const bundle = await bundleFolder(root);
    const paths = bundle.entries.map((entry) => entry.path).sort();
    assert.deepEqual(paths, ["README.md", "features/alias.feature", "features/one.feature"]);
    const alias = bundle.entries.find((entry) => entry.path === "features/alias.feature");
    assert.ok(alias !== undefined && alias.kind === "symlink" && alias.target === "one.feature");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundleFolder skips named top-level entries and applies a prefix", async () => {
  const root = await mkdtemp(join(tmpdir(), "bundle-test-"));
  try {
    await writeFile(join(root, "README.md"), "kept\n");
    await writeFile(join(root, "SECRET.md"), "left out\n");

    const bundle = await bundleFolder(root, { skip: ["SECRET.md"], prefix: "factory" });
    assert.deepEqual(bundle.entries.map((entry) => entry.path), ["factory/README.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundleFolder's executable flag reflects any x bit, and a non-executable file is false", async () => {
  const root = await mkdtemp(join(tmpdir(), "bundle-test-"));
  try {
    await writeFile(join(root, "plain.txt"), "no bits\n");
    await writeFile(join(root, "run.sh"), "#!/bin/sh\necho hi\n");
    await chmod(join(root, "run.sh"), 0o755);

    const bundle = await bundleFolder(root);
    const plain = bundle.entries.find((entry) => entry.path === "plain.txt");
    const run = bundle.entries.find((entry) => entry.path === "run.sh");
    assert.ok(plain !== undefined && plain.kind === "file" && plain.executable === false);
    assert.ok(run !== undefined && run.kind === "file" && run.executable === true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundleFolder throws a clear error naming the folder when the encoded bundle exceeds the limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "bundle-test-"));
  try {
    // base64 inflates by 4/3: a ~19 MiB file alone encodes past the 24 MiB ceiling.
    await writeFile(join(root, "big.bin"), Buffer.alloc(19 * 1024 * 1024));
    await assert.rejects(bundleFolder(root), (error: Error) => {
      assert.match(error.message, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a lesson's spec bundle holds README.md, FACTORY.md and features/ only; stand-ins/ is null unless a real folder", async () => {
  const sandbox = await makeSandbox();
  try {
    const lesson = sandbox.course.lessons.find((entry) => entry.id === "001");
    assert.ok(lesson !== undefined && lesson.seedSpec !== null);
    await writeFile(join(lesson.dir, "coach-notes.md"), "for the coach\n");
    const spec = await lessonSpecBundle(lesson.dir);
    assert.deepEqual(spec.entries.map((entry) => entry.path).sort(), ["FACTORY.md", "README.md", "features/planning.feature"]);

    assert.ok((await standInsBundle(sandbox.course.root)) !== null);
    await rm(join(sandbox.course.root, "stand-ins"), { recursive: true });
    assert.equal(await standInsBundle(sandbox.course.root), null);
    await symlink(join(sandbox.root, "elsewhere"), join(sandbox.course.root, "stand-ins"));
    assert.equal(await standInsBundle(sandbox.course.root), null);
  } finally {
    await sandbox.cleanup();
  }
});
