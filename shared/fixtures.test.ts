import { test } from "node:test";
import assert from "node:assert/strict";
import { courseSchema, progressFileSchema } from "./model.ts";
import {
  candidateProjectSchema,
  completionSchema,
  lessonDetailSchema,
  overviewSchema,
} from "./rpc.ts";
import {
  fixtureCandidates,
  fixtureCompletion,
  fixtureCourse,
  fixtureLessonDetail,
  fixtureOverview,
  fixtureOverviewNoFactory,
  fixtureStudent,
} from "./fixtures.ts";

test("fixtures satisfy their schemas", () => {
  courseSchema.parse(fixtureCourse);
  progressFileSchema.parse(fixtureStudent.progress);
  overviewSchema.parse(fixtureOverview);
  overviewSchema.parse(fixtureOverviewNoFactory);
  lessonDetailSchema.parse(fixtureLessonDetail);
  completionSchema.parse(fixtureCompletion);
  for (const candidate of fixtureCandidates) candidateProjectSchema.parse(candidate);
});

test("fixture keys are unique within each lesson", () => {
  for (const lesson of fixtureCourse.lessons) {
    const keys = lesson.features.flatMap((f) => f.rules.flatMap((r) => r.examples.map((e) => e.key)));
    assert.equal(new Set(keys).size, keys.length, lesson.id);
    assert.equal(new Set(lesson.suggestedRuleOrder).size, lesson.suggestedRuleOrder.length);
  }
});

test("an unchanged example keeps its hash across lessons", () => {
  const [, one, two] = fixtureCourse.lessons;
  const inOne = one?.features[0]?.rules[0]?.examples[0];
  const inTwo = two?.features[0]?.rules[0]?.examples[0];
  assert.equal(inTwo?.novelty, "unchanged");
  assert.equal(inOne?.hash, inTwo?.hash);
});
