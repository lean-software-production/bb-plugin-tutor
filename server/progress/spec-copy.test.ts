import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { makeSandbox } from "../../test/helpers/disk.ts";
import { copyLessonSpec, seedFileName } from "./spec-copy.ts";

test("names the seed after the codebase folder, as fetch-iteration names tetris.md", () => {
  assert.equal(seedFileName("/workspaces/capstone-project-starter/tetris"), "tetris.md");
});

test("replaces only spec/'s README.md, FACTORY.md and features/, leaving everything else in spec/ alone", async () => {
  const sandbox = await makeSandbox();
  try {
    const spec = join(sandbox.factoryRoot, "spec");
    await mkdir(join(spec, "features"), { recursive: true });
    await writeFile(join(spec, "ITERATION"), "001 Done\n");
    await writeFile(join(spec, "PROGRESS.yaml"), 'iteration: "001"\nexamples: {}\n');
    await writeFile(join(spec, "README.md"), "old README\n");
    await writeFile(join(spec, "FACTORY.md"), "old FACTORY\n");
    await writeFile(join(spec, "features/old.feature"), "Feature: old\n");
    await writeFile(join(spec, "NOTES.md"), "the student's notes\n");

    const lesson = sandbox.course.lessons[2];
    assert.ok(lesson !== undefined);
    const result = await copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root });

    assert.deepEqual((await readdir(spec)).sort(), ["FACTORY.md", "ITERATION", "NOTES.md", "PROGRESS.yaml", "README.md", "features"]);
    assert.deepEqual((await readdir(join(spec, "features"))).sort(), ["planning.feature", "validation.feature"]);
    assert.equal(await readFile(join(spec, "README.md"), "utf8"), lesson.readme);
    assert.equal(await readFile(join(spec, "FACTORY.md"), "utf8"), lesson.factoryMd);
    assert.equal(await readFile(join(spec, "NOTES.md"), "utf8"), "the student's notes\n");
    assert.equal(result.seed, null);
    assert.deepEqual(result.written, ["spec/README.md", "spec/FACTORY.md", "spec/features/", "stand-ins/"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("a lesson without FACTORY.md removes the previous spec/FACTORY.md", async () => {
  const sandbox = await makeSandbox();
  try {
    const first = sandbox.course.lessons[1];
    const second = sandbox.course.lessons[2];
    assert.ok(first !== undefined && second !== undefined);
    await copyLessonSpec(sandbox.factoryRoot, first, { courseRoot: sandbox.course.root });
    await rm(join(second.dir, "FACTORY.md"));

    await copyLessonSpec(sandbox.factoryRoot, second, { courseRoot: sandbox.course.root });
    assert.deepEqual((await readdir(join(sandbox.factoryRoot, "spec"))).sort(), ["README.md", "features"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("copies the sample seed to ../seeds/tetris.md unless it is already there, never into the factory", async () => {
  const sandbox = await makeSandbox();
  try {
    const lesson = sandbox.course.lessons[1];
    assert.ok(lesson !== undefined && lesson.seedSpec !== null);
    const seed = join(sandbox.codebaseRoot, "seeds/tetris.md");
    const first = await copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root });
    assert.equal(first.seed, "../seeds/tetris.md");
    assert.equal(first.seedAlreadyThere, false);
    assert.ok(first.written.includes("../seeds/tetris.md"));
    assert.equal(await readFile(seed, "utf8"), lesson.seedSpec);
    assert.equal(await readdir(join(sandbox.factoryRoot, "seeds")).catch(() => null), null, "no seeds/ in the factory");

    await writeFile(seed, "my own tetris\n");
    const second = await copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root });
    assert.equal(second.seedAlreadyThere, true);
    assert.ok(!second.written.includes("../seeds/tetris.md"));
    assert.equal(await readFile(seed, "utf8"), "my own tetris\n");
  } finally {
    await sandbox.cleanup();
  }
});

test("a lesson without a seed creates no ../seeds/", async () => {
  const sandbox = await makeSandbox();
  try {
    const lesson = sandbox.course.lessons[2];
    assert.ok(lesson !== undefined && lesson.seedSpec === null);
    await copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root });
    assert.equal(await readdir(join(sandbox.codebaseRoot, "seeds")).catch(() => null), null);
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

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root }), /spec\/ .*symbolic link/);
    assert.deepEqual(await readdir(src), ["main.ts"]);
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a ../seeds/ that is a symbolic link, and a seed that is one, writing nothing outside", async () => {
  const sandbox = await makeSandbox();
  try {
    const outside = join(sandbox.root, "outside");
    await mkdir(outside, { recursive: true });
    const seeds = join(sandbox.codebaseRoot, "seeds");
    await symlink(outside, seeds);
    const lesson = sandbox.course.lessons[1];
    assert.ok(lesson !== undefined && lesson.seedSpec !== null);

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root }), /seeds\/ .*symbolic link/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(await readdir(join(sandbox.factoryRoot, "spec")).catch(() => null), null, "spec/ is untouched");
    assert.equal(await readdir(join(sandbox.factoryRoot, "stand-ins")).catch(() => null), null, "stand-ins/ is untouched");

    await rm(seeds);
    await mkdir(seeds);
    await symlink(join(outside, "tetris.md"), join(seeds, "tetris.md"));
    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root }), /seeds\/tetris\.md is a symbolic link/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(await readdir(join(sandbox.factoryRoot, "spec")).catch(() => null), null, "spec/ is still untouched");
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a factory that is its repo's top folder, since ../seeds would be outside the repo, leaving spec/ unchanged", async () => {
  const sandbox = await makeSandbox();
  try {
    const first = sandbox.course.lessons[1];
    const second = sandbox.course.lessons[2];
    assert.ok(first !== undefined && second !== undefined);
    await copyLessonSpec(sandbox.factoryRoot, first, { courseRoot: sandbox.course.root });
    const spec = join(sandbox.factoryRoot, "spec");
    const before = await filesUnder(spec);
    await mkdir(join(sandbox.factoryRoot, ".git"));
    await rm(join(sandbox.factoryRoot, "stand-ins"), { recursive: true, force: true });

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, second, { courseRoot: sandbox.course.root }), /\.git/);
    assert.deepEqual(await filesUnder(spec), before);
    assert.equal(await readFile(join(spec, "README.md"), "utf8"), first.readme);
    assert.equal(await readdir(join(sandbox.factoryRoot, "stand-ins")).catch(() => null), null, "stand-ins/ is untouched");
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a ../seeds/ that is inside the course, or holds it", async () => {
  const sandbox = await makeSandbox();
  try {
    const lesson = sandbox.course.lessons[1];
    assert.ok(lesson !== undefined && lesson.seedSpec !== null);

    // A factory inside the course: ../seeds is course/tetris/seeds.
    const inCourse = join(sandbox.course.root, "tetris/.factory");
    await mkdir(inCourse, { recursive: true });
    await assert.rejects(copyLessonSpec(inCourse, lesson, { courseRoot: sandbox.course.root }), /course/);
    assert.deepEqual(await readdir(join(sandbox.course.root, "tetris")), [".factory"]);
    assert.deepEqual(await readdir(inCourse), []);

    // A course cloned into ../seeds.
    const courseInSeeds = join(sandbox.codebaseRoot, "seeds/tutorial");
    await mkdir(join(courseInSeeds, "stand-ins"), { recursive: true });
    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: courseInSeeds }), /course/);
    assert.deepEqual(await readdir(join(sandbox.codebaseRoot, "seeds")), ["tutorial"]);
    assert.deepEqual(await readdir(sandbox.factoryRoot), []);
  } finally {
    await sandbox.cleanup();
  }
});

test("refreshes stand-ins/ wholesale from the course's, keeping modes and links as they are", async () => {
  const sandbox = await makeSandbox();
  try {
    const courseStandIns = join(sandbox.course.root, "stand-ins");
    await symlink("plan-alpha-beta", join(courseStandIns, "plan-default"));
    const standIns = join(sandbox.factoryRoot, "stand-ins");
    await mkdir(join(standIns, "old-dir"), { recursive: true });
    await writeFile(join(standIns, "old-dir/stale"), "stale\n");
    await writeFile(join(standIns, "README.md"), "an old README\n");
    const lesson = sandbox.course.lessons[2];
    assert.ok(lesson !== undefined);

    await copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root });
    assert.deepEqual((await readdir(standIns)).sort(), ["README.md", "plan-alpha-beta", "plan-default"]);
    assert.equal(await readFile(join(standIns, "README.md"), "utf8"), "# Stand-ins\n");
    assert.equal((await lstat(join(standIns, "plan-alpha-beta"))).mode & 0o777, 0o755);
    assert.equal(await readlink(join(standIns, "plan-default")), "plan-alpha-beta");
  } finally {
    await sandbox.cleanup();
  }
});

test("refuses a stand-ins/ that is a symbolic link before touching anything", async () => {
  const sandbox = await makeSandbox();
  try {
    const outside = join(sandbox.root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "keep.txt"), "not a stand-in\n");
    await symlink(outside, join(sandbox.factoryRoot, "stand-ins"));
    const lesson = sandbox.course.lessons[1];
    assert.ok(lesson !== undefined);

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root }), /stand-ins\/ .*symbolic link/);
    assert.deepEqual(await readdir(outside), ["keep.txt"]);
    assert.equal(await readdir(join(sandbox.factoryRoot, "spec")).catch(() => null), null, "spec/ is untouched");
    assert.equal(await readdir(join(sandbox.codebaseRoot, "seeds")).catch(() => null), null, "no seed written");
  } finally {
    await sandbox.cleanup();
  }
});

test("a course without stand-ins/ leaves the factory's stand-ins/ alone", async () => {
  const sandbox = await makeSandbox();
  try {
    await rm(join(sandbox.course.root, "stand-ins"), { recursive: true });
    const standIns = join(sandbox.factoryRoot, "stand-ins");
    await mkdir(standIns);
    await writeFile(join(standIns, "mine"), "the student's stand-in\n");
    const lesson = sandbox.course.lessons[2];
    assert.ok(lesson !== undefined);

    const result = await copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root });
    assert.deepEqual(await readdir(standIns), ["mine"]);
    assert.ok(!result.written.includes("stand-ins/"));
  } finally {
    await sandbox.cleanup();
  }
});

test("a stand-ins/ refresh first recovers what a crashed one left, never following a link", async () => {
  const sandbox = await makeSandbox();
  try {
    const outside = join(sandbox.root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "keep.txt"), "not a stand-in\n");
    const standIns = join(sandbox.factoryRoot, "stand-ins");
    // A crash mid-swap: an old stand-in set aside, the new ones half staged, and a leftover link.
    await mkdir(join(standIns, ".tutor-previous"), { recursive: true });
    await writeFile(join(standIns, ".tutor-previous/old-stand-in"), "old\n");
    await mkdir(join(standIns, ".tutor-adopting"));
    await writeFile(join(standIns, ".tutor-adopting/half"), "half\n");
    await symlink(outside, join(standIns, ".tutor-staging-zz"));
    const lesson = sandbox.course.lessons[2];
    assert.ok(lesson !== undefined);

    await copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root });
    assert.deepEqual((await readdir(standIns)).sort(), ["README.md", "plan-alpha-beta"], "leftovers cleared");
    assert.deepEqual(await readdir(outside), ["keep.txt"]);
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
    await copyLessonSpec(sandbox.factoryRoot, first, { courseRoot: sandbox.course.root });
    await rm(join(second.dir, "features"), { recursive: true });

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, second, { courseRoot: sandbox.course.root }), /no feature files/);
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
    await copyLessonSpec(sandbox.factoryRoot, first, { courseRoot: sandbox.course.root });
    const spec = join(sandbox.factoryRoot, "spec");
    const before = (await readdir(spec)).sort();
    await rm(join(second.dir, "README.md"));

    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, second, { courseRoot: sandbox.course.root }), /Lesson 002 has no README\.md/);
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
    await copyLessonSpec(sandbox.factoryRoot, first, { courseRoot: sandbox.course.root });
    const spec = join(sandbox.factoryRoot, "spec");

    // Something makes a folder at spec/README.md once the old README moved aside: neither README can go there.
    const error = await copyLessonSpec(sandbox.factoryRoot, second, {
      courseRoot: sandbox.course.root,
      hooks: { afterMovedAside: () => mkdir(join(spec, "README.md", "in-the-way"), { recursive: true }).then(() => undefined) },
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

test("a swap's rollback never overwrites a file written in spec/ during the swap", async () => {
  const sandbox = await makeSandbox();
  try {
    const first = sandbox.course.lessons[1];
    const second = sandbox.course.lessons[2];
    assert.ok(first !== undefined && second !== undefined);
    await copyLessonSpec(sandbox.factoryRoot, first, { courseRoot: sandbox.course.root });
    const spec = join(sandbox.factoryRoot, "spec");
    // The next lesson brings no FACTORY.md, so the old one moves aside and nothing replaces it.
    await rm(join(second.dir, "FACTORY.md"));

    // Once the old files are aside, the student saves FACTORY.md, and a folder in the way fails the swap.
    const error = await copyLessonSpec(sandbox.factoryRoot, second, {
      courseRoot: sandbox.course.root,
      hooks: {
        afterMovedAside: async () => {
          await writeFile(join(spec, "FACTORY.md"), "written during the swap\n");
          await mkdir(join(spec, "features", "in-the-way"), { recursive: true });
        },
      },
    }).then(
      () => assert.fail("the adoption succeeded"),
      (cause: Error) => cause,
    );
    assert.equal(await readFile(join(spec, "FACTORY.md"), "utf8"), "written during the swap\n");
    assert.equal(await readFile(join(spec, ".tutor-previous", "FACTORY.md"), "utf8"), first.factoryMd, "the old copy is kept aside");
    assert.match(error.message, /spec\/\.tutor-previous\/FACTORY\.md/);
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
    await copyLessonSpec(sandbox.factoryRoot, first, { courseRoot: sandbox.course.root });
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
    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, second, { courseRoot: sandbox.course.root }), /no README\.md/);
    assert.deepEqual((await readdir(spec)).sort(), ["FACTORY.md", "NOTES.md", "README.md", "features"], "leftovers cleared");
    assert.equal(await readFile(join(spec, "README.md"), "utf8"), "half-adopted README\n", "a file present is never overwritten");
    assert.deepEqual(await readdir(join(spec, "features")), ["planning.feature"], "missing files restored");

    // The next adoption that works replaces the lesson files and keeps the rest.
    await writeFile(join(second.dir, "README.md"), second.readme);
    await mkdir(join(spec, ".tutor-previous"));
    await copyLessonSpec(sandbox.factoryRoot, second, { courseRoot: sandbox.course.root });
    assert.deepEqual((await readdir(spec)).sort(), ["FACTORY.md", "NOTES.md", "README.md", "features"], "the recovered notes stay");
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
    await assert.rejects(copyLessonSpec(sandbox.factoryRoot, lesson, { courseRoot: sandbox.course.root }), /no README\.md/);
    assert.deepEqual(await readdir(spec), [], "the links are removed and nothing is restored through them");
    assert.deepEqual((await filesUnder(outside)).sort(), ["README.md", "features/x.feature"]);
  } finally {
    await sandbox.cleanup();
  }
});
