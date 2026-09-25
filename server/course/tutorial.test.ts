// Integration test against a checkout of the real course. Run it with
// TUTOR_TEST_COURSE=/path/to/tutorial npm test; it is skipped otherwise.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { findLesson, lessonExamples } from "../../shared/derive.ts";
import { courseSchema } from "../../shared/model.ts";
import type { Course, Lesson } from "../../shared/model.ts";
import { createCourseSource } from "./index.ts";

const coursePath = process.env["TUTOR_TEST_COURSE"];

describe("the tutorial course", { skip: coursePath === undefined && "TUTOR_TEST_COURSE is not set" }, () => {
  let course: Course;
  before(async () => {
    course = await createCourseSource().loadCourse(coursePath ?? "");
  });

  const lesson = (id: string): Lesson => {
    const found = findLesson(course, id);
    assert.ok(found, `lesson ${id}`);
    return found;
  };

  test("every lesson in the ledger parses, after Lesson 0", () => {
    courseSchema.parse(course);
    // The ledger until tutorial ships course.yaml (lean-software-production/tutorial#2); either must load the same course.
    assert.ok(course.source === "ledger" || course.source === "course.yaml", course.source);
    assert.deepEqual(
      course.lessons.map((hw) => hw.id),
      ["000", "001", "002", "003", "004", "005", "006", "007"],
    );
    assert.equal(lesson("003").title, "The assembly line");
    assert.equal(lesson("003").set, "Day 3");
    assert.ok(course.coachPath?.endsWith(".agents/coach-me.md"));
    assert.ok(course.lexicon.some((entry) => entry.id === "assembly-line"));
  });

  test("feature, Rule and Example counts match the course", () => {
    const counts = Object.fromEntries(
      course.lessons
        .filter((hw) => !hw.builtin)
        .map((hw) => {
          const rules = hw.features.flatMap((feature) => feature.rules);
          return [hw.id, [hw.features.length, rules.length, lessonExamples(hw).length]];
        }),
    );
    assert.deepEqual(counts["001"], [3, 18, 24]);
    assert.deepEqual(counts["007"], [10, 69, 83]);
  });

  test("assembly-line.feature is new in lesson 003", () => {
    const assemblyLine = lesson("003").features.find((feature) => feature.slug === "assembly-line");
    assert.equal(assemblyLine?.change, "new");
    assert.ok(assemblyLine?.rules.every((rule) => rule.change === "new"));
    const rules = lesson("003").features.flatMap((feature) => feature.rules);
    const order = lesson("003").suggestedRuleOrder;
    const firstUnchanged = order.findIndex((key) => rules.find((rule) => rule.key === key)?.change === "unchanged");
    for (const rule of assemblyLine?.rules ?? []) assert.ok(order.indexOf(rule.key) < firstUnchanged, rule.key);
  });

  test("Examples that did not change keep their hash, so passing ones carry over", () => {
    for (const [previous, current] of [
      ["001", "002"],
      ["006", "007"],
    ] as const) {
      const earlier = new Set(lessonExamples(lesson(previous)).map((example) => example.hash));
      const unchanged = lessonExamples(lesson(current)).filter((example) => example.change === "unchanged");
      assert.ok(unchanged.length > 0, `${current} has unchanged Examples`);
      for (const example of unchanged) assert.ok(earlier.has(example.hash), example.key);
    }
    const planning = (id: string) =>
      lessonExamples(lesson(id))
        .filter((example) => example.key.startsWith("planning/"))
        .map((example) => [example.key, example.hash]);
    assert.deepEqual(planning("002"), planning("001"));
  });

  test("the dek skips the instructions every README repeats", () => {
    assert.match(lesson("003").dek, /^The factory does the same work it did for lesson 2\./);
    assert.match(lesson("001").dek, /^Build a \*\*Ralph loop\*\*/);
  });
});
