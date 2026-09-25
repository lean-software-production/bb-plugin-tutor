// Integration test against a checkout of the real course. Run it with
// TUTOR_TEST_COURSE=/path/to/tutorial npm test; it is skipped otherwise.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { findHomework, homeworkExamples } from "../../shared/derive.ts";
import { courseSchema } from "../../shared/model.ts";
import type { Course, Homework } from "../../shared/model.ts";
import { createCourseSource } from "./index.ts";

const coursePath = process.env["TUTOR_TEST_COURSE"];

describe("the tutorial course", { skip: coursePath === undefined && "TUTOR_TEST_COURSE is not set" }, () => {
  let course: Course;
  before(async () => {
    course = await createCourseSource().loadCourse(coursePath ?? "");
  });

  const homework = (id: string): Homework => {
    const found = findHomework(course, id);
    assert.ok(found, `homework ${id}`);
    return found;
  };

  test("every homework in the ledger parses, after Homework 0", () => {
    courseSchema.parse(course);
    // The ledger until tutorial ships course.yaml (lean-software-production/tutorial#2); either must load the same course.
    assert.ok(course.source === "ledger" || course.source === "course.yaml", course.source);
    assert.deepEqual(
      course.homeworks.map((hw) => hw.id),
      ["000", "001", "002", "003", "004", "005", "006", "007"],
    );
    assert.equal(homework("003").title, "The assembly line");
    assert.equal(homework("003").set, "Day 3");
    assert.ok(course.coachPath?.endsWith(".agents/coach-me.md"));
    assert.ok(course.lexicon.some((entry) => entry.id === "assembly-line"));
  });

  test("feature, Rule and Example counts match the course", () => {
    const counts = Object.fromEntries(
      course.homeworks
        .filter((hw) => !hw.builtin)
        .map((hw) => {
          const rules = hw.features.flatMap((feature) => feature.rules);
          return [hw.id, [hw.features.length, rules.length, homeworkExamples(hw).length]];
        }),
    );
    assert.deepEqual(counts["001"], [3, 18, 24]);
    assert.deepEqual(counts["007"], [10, 69, 83]);
  });

  test("assembly-line.feature is new in homework 003", () => {
    const assemblyLine = homework("003").features.find((feature) => feature.slug === "assembly-line");
    assert.equal(assemblyLine?.novelty, "new");
    assert.ok(assemblyLine?.rules.every((rule) => rule.novelty === "new"));
    const rules = homework("003").features.flatMap((feature) => feature.rules);
    const order = homework("003").suggestedRuleOrder;
    const firstUnchanged = order.findIndex((key) => rules.find((rule) => rule.key === key)?.novelty === "unchanged");
    for (const rule of assemblyLine?.rules ?? []) assert.ok(order.indexOf(rule.key) < firstUnchanged, rule.key);
  });

  test("Examples that did not change keep their hash, so passing ones carry over", () => {
    for (const [previous, current] of [
      ["001", "002"],
      ["006", "007"],
    ] as const) {
      const earlier = new Set(homeworkExamples(homework(previous)).map((example) => example.hash));
      const unchanged = homeworkExamples(homework(current)).filter((example) => example.novelty === "unchanged");
      assert.ok(unchanged.length > 0, `${current} has unchanged Examples`);
      for (const example of unchanged) assert.ok(earlier.has(example.hash), example.key);
    }
    const planning = (id: string) =>
      homeworkExamples(homework(id))
        .filter((example) => example.key.startsWith("planning/"))
        .map((example) => [example.key, example.hash]);
    assert.deepEqual(planning("002"), planning("001"));
  });

  test("the dek skips the instructions every README repeats", () => {
    assert.match(homework("003").dek, /^The factory does the same work it did for homework 2\./);
    assert.match(homework("001").dek, /^Build a \*\*Ralph loop\*\*/);
  });
});
