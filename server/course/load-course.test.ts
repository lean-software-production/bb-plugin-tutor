import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findHomework, homeworkExamples } from "../../shared/derive.ts";
import { courseSchema } from "../../shared/model.ts";
import type { Course, Homework } from "../../shared/model.ts";
import { CourseLoadError } from "../../shared/ports.ts";
import { createCourseSource } from "./index.ts";

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const load = (path: string): Promise<Course> => createCourseSource().loadCourse(path);

function homework(course: Course, id: string): Homework {
  const found = findHomework(course, id);
  assert.ok(found, `homework ${id}`);
  return found;
}

function noveltyByKey(hw: Homework): Record<string, string> {
  return Object.fromEntries(homeworkExamples(hw).map((example) => [example.key, example.novelty]));
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

test("a course.yaml course loads with Homework 0 in front", async () => {
  const course = await load(fixture("synthetic"));
  courseSchema.parse(course);
  assert.equal(course.source, "course.yaml");
  assert.equal(course.id, "widget-works");
  assert.equal(course.title, "Build a widget works");
  assert.equal(course.description, "Two homeworks, one widget works.");
  assert.equal(course.root, fixture("synthetic"));
  assert.equal(course.coachPath, join(fixture("synthetic"), ".agents/coach.md"));
  assert.deepEqual(
    course.homeworks.map((hw) => [hw.id, hw.title, hw.set, hw.builtin]),
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

test("a homework's files are read verbatim, and its dek skips what every README repeats", async () => {
  const course = await load(fixture("synthetic"));
  const one = homework(course, "010");
  assert.equal(one.dir, join(fixture("synthetic"), "homeworks/one"));
  assert.match(one.readme, /^# Homework 1 — First widgets\n/);
  assert.equal(one.dek, "Make the works turn out a **widget**.");
  assert.equal(one.factoryMd, "# The works\n\nIt makes widgets.\n");
  assert.equal(one.seedSpec, "# A widget\n\nRound.\n");
  const two = homework(course, "020");
  assert.equal(two.dek, "Now the works makes gadgets too.");
  assert.equal(two.seedSpec, null);
});

test("features are sorted by path and Examples keep file order under their Rules", async () => {
  const two = homework(await load(fixture("synthetic")), "020");
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

test("novelty compares each homework with the one before it", async () => {
  const course = await load(fixture("synthetic"));
  assert.ok(homeworkExamples(homework(course, "010")).every((example) => example.novelty === "new"));
  const two = homework(course, "020");
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

test("the FACTORY.md diff is against the previous homework, and null for the first", async () => {
  const course = await load(fixture("synthetic"));
  assert.equal(homework(course, "000").factoryDiff, null);
  assert.equal(homework(course, "010").factoryDiff, null);
  assert.deepEqual(homework(course, "020").factoryDiff, [
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
    course.homeworks.map((hw) => [hw.id, hw.title, hw.set, hw.dir]),
    [
      ["000", "Using your tutor", "Start here", homework(course, "000").dir],
      ["001", "First steps", "Day 1", join(root, "docs/iterations/001-first-steps")],
      ["002", "Second steps", null, join(root, "docs/iterations/002-second-steps")],
    ],
  );
  assert.deepEqual(noveltyByKey(homework(course, "002")), {
    "steps/a-step-moves-you/one-step": "unchanged",
    "steps/a-step-moves-you/two-steps": "new",
  });
});

test("Homework 0 ships with the plugin and teaches the interface", async () => {
  const zero = homework(await load(fixture("ledger")), "000");
  assert.equal(zero.builtin, true);
  assert.match(zero.dir, /server\/course\/builtin\/homework-0$/);
  assert.equal(zero.factoryDiff, null);
  assert.match(zero.dek, /^Before you build anything/);
  const rules = zero.features.flatMap((feature) => feature.rules);
  assert.ok(rules.length >= 3 && rules.length <= 5, `${rules.length} rules`);
  assert.equal(zero.suggestedRuleOrder.length, rules.length);
  const examples = homeworkExamples(zero);
  assert.ok(examples.every((example) => example.novelty === "new"));
  assert.ok(examples.some((example) => /side thread/.test(example.name)));
});

test("a missing course, or a folder that is not a course, is a readable error", async () => {
  await rejectsWith(load(join(fixture("synthetic"), "nowhere")), /There is no course folder at .*nowhere/);
  await rejectsWith(load(fixture("synthetic/homeworks")), /is not a course: it has neither a course\.yaml nor a ledger/);
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

test("a homework without a README.md is a readable error", async () => {
  await withCopy("ledger", async (root) => {
    await rm(join(root, "docs/iterations/001-first-steps/README.md"));
    await rejectsWith(load(root), /^Homework 001 has no README\.md in docs\/iterations\/001-first-steps\.$/);
  });
});

test("course.yaml may not reuse Homework 0's id or list an id twice", async () => {
  await withCopy("synthetic", async (root) => {
    const entry = (id: string): string => `  - { id: "${id}", title: T, dir: homeworks/one }\n`;
    await writeFile(join(root, "course.yaml"), `id: x\ntitle: X\nhomeworks:\n${entry("000")}`);
    await rejectsWith(load(root), /^course\.yaml: homework 000 is reserved for the built-in Homework 0\.$/);
    await writeFile(join(root, "course.yaml"), `id: x\ntitle: X\nhomeworks:\n${entry("001")}${entry("001")}`);
    await rejectsWith(load(root), /^course\.yaml: homework 001 is listed twice\.$/);
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
