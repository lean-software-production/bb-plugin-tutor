import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { makeSandbox } from "../../test/helpers/disk.ts";
import { copyLessonSpec, seedFileName } from "./spec-copy.ts";

test("names the seed after its title, as coach-me names tetris.md", () => {
  assert.equal(seedFileName("# Tetris\n\nA game.", "001"), "tetris.md");
  assert.equal(seedFileName("no title here", "004"), "homework-004.md");
});

test("spec/ holds exactly the lesson, keeping Tutor's own files", async () => {
  const sandbox = await makeSandbox();
  try {
    const spec = join(sandbox.factoryRoot, "spec");
    await mkdir(join(spec, "features"), { recursive: true });
    await writeFile(join(spec, "ITERATION"), "001 Done\n");
    await writeFile(join(spec, "PROGRESS.yaml"), 'iteration: "001"\nexamples: {}\n');
    await writeFile(join(spec, "features/old.feature"), "Feature: old\n");
    await writeFile(join(spec, "NOTES.md"), "left over\n");

    const lesson = sandbox.course.lessons[2];
    assert.ok(lesson !== undefined);
    const result = await copyLessonSpec(sandbox.factoryRoot, lesson);

    assert.deepEqual((await readdir(spec)).sort(), ["FACTORY.md", "ITERATION", "PROGRESS.yaml", "README.md", "features"]);
    assert.deepEqual((await readdir(join(spec, "features"))).sort(), ["planning.feature", "validation.feature"]);
    assert.equal(await readFile(join(spec, "README.md"), "utf8"), lesson.readme);
    assert.equal(result.seed, null);
  } finally {
    await sandbox.cleanup();
  }
});

test("copies the sample seed into seeds/ unless it is already there", async () => {
  const sandbox = await makeSandbox();
  try {
    const lesson = sandbox.course.lessons[1];
    assert.ok(lesson !== undefined && lesson.seedSpec !== null);
    const first = await copyLessonSpec(sandbox.factoryRoot, lesson);
    assert.equal(first.seed, "seeds/tetris.md");
    assert.equal(await readFile(join(sandbox.factoryRoot, "seeds/tetris.md"), "utf8"), lesson.seedSpec);

    await writeFile(join(sandbox.factoryRoot, "seeds/tetris.md"), "my own tetris\n");
    const second = await copyLessonSpec(sandbox.factoryRoot, lesson);
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
    const lesson = sandbox.course.lessons[2];
    assert.ok(lesson !== undefined);

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson), /spec\/ .*symbolic link/);
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
    const lesson = sandbox.course.lessons[1];
    assert.ok(lesson !== undefined && lesson.seedSpec !== null);

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson), /seeds\/ .*symbolic link/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(await readdir(join(sandbox.factoryRoot, "spec")).catch(() => null), null, "spec/ is untouched");

    await rm(join(sandbox.factoryRoot, "seeds"));
    await mkdir(join(sandbox.factoryRoot, "seeds"));
    await symlink(join(outside, "tetris.md"), join(sandbox.factoryRoot, "seeds/tetris.md"));
    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson), /seeds\/tetris\.md is a symbolic link/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(await readdir(join(sandbox.factoryRoot, "spec")).catch(() => null), null, "spec/ is still untouched");
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a lesson with no feature files, keeping the previous spec snapshot", async () => {
  const sandbox = await makeSandbox();
  try {
    const first = sandbox.course.lessons[1];
    const second = sandbox.course.lessons[2];
    assert.ok(first !== undefined && second !== undefined);
    await copyLessonSpec(sandbox.factoryRoot, first);
    await rm(join(second.dir, "features"), { recursive: true });

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, second), /no feature files/);
    assert.deepEqual(await readdir(join(sandbox.factoryRoot, "spec/features")), ["planning.feature"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a lesson whose README.md went missing after the course loaded, keeping the previous spec snapshot", async () => {
  const sandbox = await makeSandbox();
  try {
    const first = sandbox.course.lessons[1];
    const second = sandbox.course.lessons[2];
    assert.ok(first !== undefined && second !== undefined);
    await copyLessonSpec(sandbox.factoryRoot, first);
    const spec = join(sandbox.factoryRoot, "spec");
    const before = (await readdir(spec)).sort();
    await rm(join(second.dir, "README.md"));

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, second), /Lesson 002 has no README\.md/);
    assert.deepEqual((await readdir(spec)).sort(), before, "nothing added to or left behind in spec/");
    assert.equal(await readFile(join(spec, "README.md"), "utf8"), first.readme);
    assert.deepEqual(await readdir(join(spec, "features")), ["planning.feature"]);
  } finally {
    await sandbox.cleanup();
  }
});

/** Every file under `dir` (symbolic links not followed), relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

test("a swap whose rollback can't put the old files back keeps them and says where they are", async () => {
  const sandbox = await makeSandbox();
  try {
    const first = sandbox.course.lessons[1];
    const second = sandbox.course.lessons[2];
    assert.ok(first !== undefined && second !== undefined);
    await copyLessonSpec(sandbox.factoryRoot, first);
    const spec = join(sandbox.factoryRoot, "spec");

    // Something makes a folder at spec/README.md once the old README moved aside: neither README can go there.
    const error = await copyLessonSpec(sandbox.factoryRoot, second, {
      afterMovedAside: () => mkdir(join(spec, "README.md", "in-the-way"), { recursive: true }).then(() => undefined),
    }).then(
      () => assert.fail("the adoption succeeded"),
      (cause: Error) => cause,
    );
    const survivors = [];
    for (const path of await filesUnder(spec)) {
      if ((await readFile(join(spec, path), "utf8")) === first.readme) survivors.push(path);
    }
    assert.deepEqual(survivors, [".tutor-previous/README.md"], "the previous README survives, set aside");
    assert.match(error.message, /spec\/\.tutor-previous\/README\.md/);
    // What could be put back was.
    assert.deepEqual(await readdir(join(spec, "features")), ["planning.feature"]);
    assert.ok(!(await readdir(spec)).includes(".tutor-adopting"), "the staged lesson is cleared");
  } finally {
    await sandbox.cleanup();
  }
});

test("an adoption first recovers what a crashed one left in spec/, restoring missing files and clearing the rest", async () => {
  const sandbox = await makeSandbox();
  try {
    const first = sandbox.course.lessons[1];
    const second = sandbox.course.lessons[2];
    assert.ok(first !== undefined && second !== undefined);
    await copyLessonSpec(sandbox.factoryRoot, first);
    const spec = join(sandbox.factoryRoot, "spec");
    // A crash mid-swap: the old README and features moved aside, the new README moved in, the rest staged.
    await mkdir(join(spec, ".tutor-previous"));
    await rename(join(spec, "README.md"), join(spec, ".tutor-previous/README.md"));
    await rename(join(spec, "features"), join(spec, ".tutor-previous/features"));
    await writeFile(join(spec, "README.md"), "half-adopted README\n");
    await mkdir(join(spec, ".tutor-adopting/features"), { recursive: true });
    await writeFile(join(spec, ".tutor-adopting/features/half.feature"), "Feature: half\n");
    // ...and a staging folder from before these had fixed names.
    await mkdir(join(spec, ".tutor-staging-Ab12Cd"));
    await writeFile(join(spec, ".tutor-staging-Ab12Cd/NOTES.md"), "old notes\n");

    // This adoption fails before the swap, so what recovery restored is what stays.
    await rm(join(second.dir, "README.md"));
    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, second), /no README\.md/);
    assert.deepEqual((await readdir(spec)).sort(), ["FACTORY.md", "NOTES.md", "README.md", "features"], "leftovers cleared");
    assert.equal(await readFile(join(spec, "README.md"), "utf8"), "half-adopted README\n", "a file present is never overwritten");
    assert.deepEqual(await readdir(join(spec, "features")), ["planning.feature"], "missing files restored");

    // The next adoption that works leaves exactly the lesson.
    await writeFile(join(second.dir, "README.md"), second.readme);
    await mkdir(join(spec, ".tutor-previous"));
    await copyLessonSpec(sandbox.factoryRoot, second);
    assert.deepEqual((await readdir(spec)).sort(), ["FACTORY.md", "README.md", "features"]);
    assert.deepEqual((await readdir(join(spec, "features"))).sort(), ["planning.feature", "validation.feature"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("recovery never follows a leftover that is a symbolic link", async () => {
  const sandbox = await makeSandbox();
  try {
    const lesson = sandbox.course.lessons[2];
    assert.ok(lesson !== undefined);
    const outside = join(sandbox.root, "outside");
    await mkdir(join(outside, "features"), { recursive: true });
    await writeFile(join(outside, "README.md"), "not the student's spec\n");
    await writeFile(join(outside, "features/x.feature"), "Feature: x\n");
    const spec = join(sandbox.factoryRoot, "spec");
    await mkdir(spec);
    for (const name of [".tutor-previous", ".tutor-adopting", ".tutor-staging-zz"]) await symlink(outside, join(spec, name));

    await rm(join(lesson.dir, "README.md"));
    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson), /no README\.md/);
    assert.deepEqual(await readdir(spec), [], "the links are removed and nothing is restored through them");
    assert.deepEqual((await filesUnder(outside)).sort(), ["README.md", "features/x.feature"]);
  } finally {
    await sandbox.cleanup();
  }
});
