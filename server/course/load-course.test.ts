import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findLesson, lessonExamples } from "../../shared/derive.ts";
import { courseSchema } from "../../shared/model.ts";
import type { Course, Lesson } from "../../shared/model.ts";
import { CourseLoadError } from "../../shared/ports.ts";
import { createCourseSource } from "./index.ts";

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const load = (path: string): Promise<Course> => createCourseSource().loadCourse(path);

function lesson(course: Course, id: string): Lesson {
  const found = findLesson(course, id);
  assert.ok(found, `lesson ${id}`);
  return found;
}

function noveltyByKey(hw: Lesson): Record<string, string> {
  return Object.fromEntries(lessonExamples(hw).map((example) => [example.key, example.novelty]));
}

/** A writable copy of a fixture course, removed after `body`. */
async function withCopy(name: string, body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "tutor-course-"));
  try {
    await cp(fixture(name), root, { recursive: true });
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CourseLoadError, `expected a CourseLoadError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}

test("a course.yaml course loads with Lesson 0 in front", async () => {
  const course = await load(fixture("synthetic"));
  courseSchema.parse(course);
  assert.equal(course.source, "course.yaml");
  assert.equal(course.id, "widget-works");
  assert.equal(course.title, "Build a widget works");
  assert.equal(course.description, "Two lessons, one widget works.");
  assert.equal(course.root, fixture("synthetic"));
  assert.equal(course.coachPath, join(fixture("synthetic"), ".agents/coach.md"));
  assert.deepEqual(
    course.lessons.map((hw) => [hw.id, hw.title, hw.set, hw.builtin]),
    [
      ["000", "Using your tutor", "Start here", true],
      ["010", "First widgets", "Day 1", false],
      ["020", "More widgets", "Day 2", false],
    ],
  );
  assert.deepEqual(course.lexicon, [
    { id: "widget", term: "Widget", definition: "A thing the works makes. See *gadget*." },
    { id: "gadget", term: "Gadget", definition: "A widget with a *button*." },
  ]);
});

test("a lesson's files are read verbatim, and its dek skips what every README repeats", async () => {
  const course = await load(fixture("synthetic"));
  const one = lesson(course, "010");
  assert.equal(one.dir, join(fixture("synthetic"), "lessons/one"));
  assert.match(one.readme, /^# Homework 1 — First widgets\n/);
  assert.equal(one.dek, "Make the works turn out a **widget**.");
  assert.equal(one.factoryMd, "# The works\n\nIt makes widgets.\n");
  assert.equal(one.seedSpec, "# A widget\n\nRound.\n");
  const two = lesson(course, "020");
  assert.equal(two.dek, "Now the works makes gadgets too.");
  assert.equal(two.seedSpec, null);
});

test("features are sorted by path and Examples keep file order under their Rules", async () => {
  const two = lesson(await load(fixture("synthetic")), "020");
  assert.deepEqual(
    two.features.map((feature) => feature.path),
    ["features/gadgets.feature", "features/widgets.feature"],
  );
  assert.deepEqual(Object.keys(noveltyByKey(two)), [
    "gadgets/a-gadget-has-a-button/pressing-the-button",
    "widgets/general/a-loose-example",
    "widgets/the-works-makes-a-widget/one-widget",
    "widgets/the-works-makes-a-widget/a-widget-from-a-drawing",
    "widgets/widgets-can-be-counted/widgets-in-a-table",
  ]);
});

test("novelty compares each lesson with the one before it", async () => {
  const course = await load(fixture("synthetic"));
  assert.ok(lessonExamples(lesson(course, "010")).every((example) => example.novelty === "new"));
  const two = lesson(course, "020");
  assert.deepEqual(noveltyByKey(two), {
    "gadgets/a-gadget-has-a-button/pressing-the-button": "new",
    "widgets/general/a-loose-example": "unchanged",
    "widgets/the-works-makes-a-widget/one-widget": "reworded",
    // Re-indented docstring, tags dropped: same text.
    "widgets/the-works-makes-a-widget/a-widget-from-a-drawing": "unchanged",
    // Moved to another Rule: the key changed but the text did not.
    "widgets/widgets-can-be-counted/widgets-in-a-table": "unchanged",
  });
  assert.deepEqual(
    two.features.map((feature) => [feature.slug, feature.novelty]),
    [
      ["gadgets", "new"],
      ["widgets", "reworded"],
    ],
  );
  assert.deepEqual(two.suggestedRuleOrder, [
    "gadgets/a-gadget-has-a-button",
    "widgets/the-works-makes-a-widget",
    "widgets/general",
    "widgets/widgets-can-be-counted",
  ]);
});

test("the FACTORY.md diff is against the previous lesson, and null for the first", async () => {
  const course = await load(fixture("synthetic"));
  assert.equal(lesson(course, "000").factoryDiff, null);
  assert.equal(lesson(course, "010").factoryDiff, null);
  assert.deepEqual(lesson(course, "020").factoryDiff, [
    { kind: "ctx", text: "# The works" },
    { kind: "ctx", text: "" },
    { kind: "ctx", text: "It makes widgets." },
    { kind: "add", text: "It makes gadgets." },
  ]);
});

test("without a course.yaml the ledger table is the course", async () => {
  const root = fixture("ledger");
  const course = await load(root);
  courseSchema.parse(course);
  assert.equal(course.source, "ledger");
  assert.equal(course.id, "ledger");
  assert.equal(course.title, "Steps course");
  assert.equal(course.description, null);
  assert.equal(course.coachPath, null);
  assert.deepEqual(course.lexicon, []);
  assert.deepEqual(
    course.lessons.map((hw) => [hw.id, hw.title, hw.set, hw.dir]),
    [
      ["000", "Using your tutor", "Start here", lesson(course, "000").dir],
      ["001", "First steps", "Day 1", join(root, "docs/iterations/001-first-steps")],
      ["002", "Second steps", null, join(root, "docs/iterations/002-second-steps")],
    ],
  );
  assert.deepEqual(noveltyByKey(lesson(course, "002")), {
    "steps/a-step-moves-you/one-step": "unchanged",
    "steps/a-step-moves-you/two-steps": "new",
  });
});

test("Lesson 0 ships with the plugin and teaches the interface", async () => {
  const zero = lesson(await load(fixture("ledger")), "000");
  assert.equal(zero.builtin, true);
  assert.match(zero.dir, /server\/course\/builtin\/lesson-0$/);
  assert.equal(zero.factoryDiff, null);
  assert.match(zero.dek, /^Before you build anything/);
  const rules = zero.features.flatMap((feature) => feature.rules);
  assert.ok(rules.length >= 3 && rules.length <= 5, `${rules.length} rules`);
  assert.equal(zero.suggestedRuleOrder.length, rules.length);
  const examples = lessonExamples(zero);
  assert.ok(examples.every((example) => example.novelty === "new"));
  assert.ok(examples.some((example) => /side chat/.test(example.name)));
});

test("a missing course, or a folder that is not a course, is a readable error", async () => {
  await rejectsWith(load(join(fixture("synthetic"), "nowhere")), /There is no course folder at .*nowhere/);
  await rejectsWith(load(fixture("synthetic/lessons")), /is not a course: it has neither a course\.yaml nor a ledger/);
});

test("a malformed feature file names the file and line", async () => {
  await withCopy("ledger", async (root) => {
    await writeFile(
      join(root, "docs/iterations/002-second-steps/features/steps.feature"),
      "Feature: Steps\n\n  Rule: A step\n    Example: One\n      When you step\n  Nonsense here\n",
    );
    await rejectsWith(
      load(root),
      /^Could not read docs\/iterations\/002-second-steps\/features\/steps\.feature, line 6: expected: .* got 'Nonsense here'$/,
    );
  });
});

test("a lesson without a README.md is a readable error", async () => {
  await withCopy("ledger", async (root) => {
    await rm(join(root, "docs/iterations/001-first-steps/README.md"));
    await rejectsWith(load(root), /^Lesson 001 has no README\.md in docs\/iterations\/001-first-steps\.$/);
  });
});

test("course.yaml may not reuse Lesson 0's id or list an id twice", async () => {
  await withCopy("synthetic", async (root) => {
    const entry = (id: string): string => `  - { id: "${id}", title: T, dir: lessons/one }\n`;
    await writeFile(join(root, "course.yaml"), `id: x\ntitle: X\nlessons:\n${entry("000")}`);
    await rejectsWith(load(root), /^course\.yaml: lesson 000 is reserved for the built-in Lesson 0\.$/);
    await writeFile(join(root, "course.yaml"), `id: x\ntitle: X\nlessons:\n${entry("001")}${entry("001")}`);
    await rejectsWith(load(root), /^course\.yaml: lesson 001 is listed twice\.$/);
  });
});

test("a coach or lexicon that course.yaml names must exist", async () => {
  await withCopy("synthetic", async (root) => {
    await rm(join(root, "lexicon.yaml"));
    await rejectsWith(load(root), /^The course names lexicon\.yaml as its lexicon, but there is no such file\.$/);
    await rm(join(root, ".agents/coach.md"));
    await rejectsWith(load(root), /^The course names \.agents\/coach\.md as its coach/);
  });
});

test("a symbolic link may not lead a lesson, the coach or the lexicon out of the course folder", async () => {
  const outside = await mkdtemp(join(tmpdir(), "tutor-outside-"));
  try {
    await withCopy("synthetic", async (root) => {
      await rename(join(root, "lessons/one"), join(outside, "one"));
      await symlink(join(outside, "one"), join(root, "lessons/one"));
      await rejectsWith(load(root), /^course\.yaml: lessons\/one leads outside the course folder\.$/);
    });
    await withCopy("synthetic", async (root) => {
      await writeFile(join(outside, "coach.md"), "secret\n");
      await rm(join(root, ".agents/coach.md"));
      await symlink(join(outside, "coach.md"), join(root, ".agents/coach.md"));
      await rejectsWith(load(root), /^course\.yaml: \.agents\/coach\.md leads outside the course folder\.$/);
    });
    await withCopy("synthetic", async (root) => {
      await writeFile(join(outside, "lexicon.yaml"), "x: y\n");
      await rm(join(root, "lexicon.yaml"));
      await symlink(join(outside, "lexicon.yaml"), join(root, "lexicon.yaml"));
      await rejectsWith(load(root), /^course\.yaml: lexicon\.yaml leads outside the course folder\.$/);
    });
    await withCopy("synthetic", async (root) => {
      await rename(join(root, "course.yaml"), join(outside, "course.yaml"));
      await symlink(join(outside, "course.yaml"), join(root, "course.yaml"));
      await rejectsWith(load(root), /^course\.yaml leads outside the course folder\.$/);
    });
    await withCopy("synthetic", async (root) => {
      await writeFile(join(outside, "README.md"), "# Not the course\n");
      await rm(join(root, "lessons/two/README.md"));
      await symlink(join(outside, "README.md"), join(root, "lessons/two/README.md"));
      await rejectsWith(load(root), /^lessons\/two\/README\.md leads outside the course folder\.$/);
    });
    await withCopy("ledger", async (root) => {
      const dir = join(root, "docs/iterations/002-second-steps");
      await mkdir(join(outside, "ledger"), { recursive: true });
      await rename(dir, join(outside, "ledger/002"));
      await symlink(join(outside, "ledger/002"), dir);
      await rejectsWith(load(root), /^docs\/iterations\/README\.md: docs\/iterations\/002-second-steps leads outside the course folder\.$/);
    });
    await withCopy("ledger", async (root) => {
      await writeFile(join(outside, "course-readme.md"), "# Not the course\n");
      await rm(join(root, "README.md"), { force: true });
      await symlink(join(outside, "course-readme.md"), join(root, "README.md"));
      await rejectsWith(load(root), /^README\.md leads outside the course folder\.$/);
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("a symbolic link that stays inside the course folder is fine", async () => {
  await withCopy("synthetic", async (root) => {
    await rename(join(root, "lessons/one"), join(root, "lessons/one-real"));
    await symlink("one-real", join(root, "lessons/one"));
    const course = await load(root);
    assert.equal(lesson(course, "010").title, "First widgets");
  });
});

test("a lesson without feature files is a readable error; FACTORY.md is optional", async () => {
  await withCopy("ledger", async (root) => {
    const features = join(root, "docs/iterations/002-second-steps/features");
    await rm(join(features, "steps.feature"));
    await writeFile(join(features, "notes.md"), "not a feature\n");
    await rejectsWith(load(root), /^Lesson 002 has no feature files in docs\/iterations\/002-second-steps\/features\.$/);
    await rm(features, { recursive: true });
    await rejectsWith(load(root), /^Lesson 002 has no feature files in docs\/iterations\/002-second-steps\/features\.$/);
  });
  const course = await load(fixture("ledger"));
  assert.equal(lesson(course, "001").factoryMd, "");
});
