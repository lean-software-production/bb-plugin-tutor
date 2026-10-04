import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Bundle } from "../shared/bundle.ts";
import { seedWorkspace } from "./seed.ts";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function fileEntry(path: string, text: string): Bundle["entries"][number] {
  return { kind: "file", path, executable: false, base64: b64(text) };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "seed-workspace-"));
}

function markerPath(root: string, courseId: string): string {
  return join(root, ".tutor", "seeds", `${courseId}.json`);
}

async function readMarker(root: string, courseId: string): Promise<{ ref: string; complete: true; at: string }> {
  return JSON.parse(await readFile(markerPath(root, courseId), "utf8"));
}

async function exists(path: string): Promise<boolean> {
  return (await readFile(path).catch(() => null)) !== null || (await readdir(path).catch(() => null)) !== null;
}

test("seeding writes the starter's files and a marker, and leaves .git alone", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");

  const bundle: Bundle = { entries: [fileEntry("README.md", "# Hello\n"), fileEntry("src/main.py", "print('hi')\n")] };
  const result = await seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle });

  assert.deepEqual(result.written.sort(), ["README.md", "src/main.py"]);
  assert.deepEqual(result.same, []);
  assert.deepEqual(result.kept, []);
  assert.equal(result.complete, true);
  assert.equal(await readFile(join(root, "README.md"), "utf8"), "# Hello\n");
  assert.equal(await readFile(join(root, "src/main.py"), "utf8"), "print('hi')\n");

  const marker = await readMarker(root, "tetris");
  assert.equal(marker.ref, "v1");
  assert.equal(marker.complete, true);
  assert.equal(typeof marker.at, "string");

  // .git is left exactly as it was.
  assert.deepEqual(await readdir(join(root, ".git")), ["HEAD"]);
  assert.equal(await readFile(join(root, ".git", "HEAD"), "utf8"), "ref: refs/heads/main\n");
});

test("an interrupted seed finishes on the next call: files already written are 'same', the rest are written", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const bundle: Bundle = {
    entries: [fileEntry("a.txt", "a\n"), fileEntry("b.txt", "b\n"), fileEntry("c.txt", "c\n")],
  };

  // The second entry's write "finishes", then the hook throws: a and b land on disk, c and the marker do not.
  await assert.rejects(
    seedWorkspace(
      { root, courseId: "tetris", ref: "v1", bundle },
      { hooks: { afterEntry: async (_path, index) => {
        if (index === 1) throw new Error("interrupted");
      } } },
    ),
    /interrupted/,
  );
  assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a\n");
  assert.equal(await readFile(join(root, "b.txt"), "utf8"), "b\n");
  assert.equal(await exists(join(root, "c.txt")), false);
  assert.equal(await exists(markerPath(root, "tetris")), false);

  const result = await seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle });
  assert.deepEqual(result.same.sort(), ["a.txt", "b.txt"]);
  assert.deepEqual(result.written, ["c.txt"]);
  assert.deepEqual(result.kept, []);
  assert.equal(await readFile(join(root, "c.txt"), "utf8"), "c\n");
  assert.equal((await readMarker(root, "tetris")).ref, "v1");
});

test("a file the student already changed is kept, reported, and not overwritten", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "main.py"), "the student's own version\n");

  const bundle: Bundle = { entries: [fileEntry("main.py", "starter version\n"), fileEntry("README.md", "# Hi\n")] };
  const result = await seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle });

  assert.deepEqual(result.kept, ["main.py"]);
  assert.deepEqual(result.written, ["README.md"]);
  assert.equal(await readFile(join(root, "main.py"), "utf8"), "the student's own version\n");
  // The seed still finishes: the marker is written even though a file was kept.
  assert.equal((await readMarker(root, "tetris")).ref, "v1");
});

test("a seed refuses a bundle with an escaping path and writes nothing, marker included", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "keep.txt"), "already here\n");

  const bundle: Bundle = { entries: [fileEntry("ok.txt", "fine\n"), fileEntry("../escape.txt", "bad\n")] };
  await assert.rejects(seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle }));

  assert.deepEqual(await readdir(root), ["keep.txt"]);
  assert.equal(await exists(markerPath(root, "tetris")), false);
});

test("a seed refuses a bundle that writes into .git/, writing nothing, marker included", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");

  const bundle: Bundle = { entries: [fileEntry("ok.txt", "fine\n"), fileEntry(".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n")] };
  await assert.rejects(seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle }), /\.git\/hooks\/pre-commit/);

  assert.deepEqual(await readdir(root), [".git"]);
  assert.deepEqual(await readdir(join(root, ".git")), ["HEAD"]);
  assert.equal(await exists(markerPath(root, "tetris")), false);
});

test("a seed refuses a bundle that writes into .tutor/ (any case), writing nothing, marker included", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const bundle: Bundle = { entries: [fileEntry("ok.txt", "fine\n"), fileEntry(".TUTOR/seeds/x.json", '{"ref":"forged","complete":true,"at":"now"}')] };
  await assert.rejects(seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle }), /\.TUTOR\/seeds\/x\.json/);

  assert.deepEqual(await readdir(root), []);
  assert.equal(await exists(markerPath(root, "tetris")), false);
});

test("a completed marker for the same ref returns at once, without writing anything new", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const bundle: Bundle = { entries: [fileEntry("a.txt", "a\n")] };
  await seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle });
  await writeFile(join(root, "a.txt"), "the student edited this\n");

  const result = await seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle });
  assert.deepEqual(result, { written: [], same: [], kept: [], complete: true });
  assert.equal(await readFile(join(root, "a.txt"), "utf8"), "the student edited this\n");
});

test("a marker for a different ref re-seeds with onlyIfAbsent, never overwriting the student's work", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const first: Bundle = { entries: [fileEntry("a.txt", "a v1\n")] };
  await seedWorkspace({ root, courseId: "tetris", ref: "v1", bundle: first });
  await writeFile(join(root, "a.txt"), "the student's own edit\n");

  const second: Bundle = { entries: [fileEntry("a.txt", "a v2\n"), fileEntry("b.txt", "b v2\n")] };
  const result = await seedWorkspace({ root, courseId: "tetris", ref: "v2", bundle: second });

  assert.deepEqual(result.kept, ["a.txt"]);
  assert.deepEqual(result.written, ["b.txt"]);
  assert.equal(await readFile(join(root, "a.txt"), "utf8"), "the student's own edit\n");
  assert.equal((await readMarker(root, "tetris")).ref, "v2");
});
