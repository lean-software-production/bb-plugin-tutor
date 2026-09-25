import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureLessonDetail } from "../../shared/fixtures.ts";
import { lessonCardView, ruleCardView } from "./lesson-cards.ts";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const focus = fixtureLessonDetail.focus ?? assert.fail("the fixture lesson has a focus");

test("the lesson card lists every Rule by Feature, with live status, and links only the reached ones", () => {
  const view = lessonCardView(fixtureLessonDetail);
  assert.equal(view.eyebrow, "Lesson 2 · Set after day 2");
  assert.equal(view.title, "Checking the work");
  assert.match(view.tally, /^\d+ of \d+ examples hold$/);
  const rules = view.features.flatMap((feature) => feature.rules);
  assert.equal(rules.length, fixtureLessonDetail.lesson.features.flatMap((feature) => feature.rules).length);
  assert.deepEqual(rules.filter((rule) => rule.reached).map((rule) => rule.key), [focus]);
  assert.equal(rules.find((rule) => rule.key === focus)?.glyph, "focus");
  const unlinked = lessonCardView({ ...fixtureLessonDetail, coachThreadId: null });
  assert.ok(unlinked.features.flatMap((feature) => feature.rules).every((rule) => !rule.reached), "no coach thread, nothing to jump to");
});

test("a lesson ahead shows no focus", () => {
  const view = lessonCardView({ ...fixtureLessonDetail, status: "ahead", progress: {} });
  assert.ok(view.features.flatMap((feature) => feature.rules).every((rule) => rule.glyph === "pending"));
});

test("the Rule card draws the Rule's Examples from the live lesson", () => {
  const view = ruleCardView(fixtureLessonDetail, focus, NOW);
  assert.ok(view !== null);
  assert.equal(view.rule.key, focus);
  assert.equal(view.rule.name, "A task is finished when validation is satisfied");
  assert.equal(view.rule.examples.length, view.total);
  assert.ok(view.rule.examples.every((example) => example.lines.length > 0));
  assert.equal(view.current, true);
  assert.equal(ruleCardView(fixtureLessonDetail, "no-such/rule", NOW), null);
});
