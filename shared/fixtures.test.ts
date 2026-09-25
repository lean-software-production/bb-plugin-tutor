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
  fixtureOverviewUnbound,
  fixtureStudent,
} from "./fixtures.ts";

test("fixtures satisfy their schemas", () => {
  courseSchema.parse(fixtureCourse);
  progressFileSchema.parse(fixtureStudent.progress);
  overviewSchema.parse(fixtureOverview);
  overviewSchema.parse(fixtureOverviewUnbound);
  lessonDetailSchema.parse(fixtureLessonDetail);
  completionSchema.parse(fixtureCompletion);
  for (const candidate of fixtureCandidates) candidateProjectSchema.parse(candidate);
});

test("fixture keys are unique within each homework", () => {
  for (const homework of fixtureCourse.homeworks) {
    const keys = homework.features.flatMap((f) => f.rules.flatMap((r) => r.examples.map((e) => e.key)));
    assert.equal(new Set(keys).size, keys.length, homework.id);
    assert.equal(new Set(homework.suggestedRuleOrder).size, homework.suggestedRuleOrder.length);
  }
});

test("an unchanged example keeps its hash across homeworks", () => {
  const [, one, two] = fixtureCourse.homeworks;
  const inOne = one?.features[0]?.rules[0]?.examples[0];
  const inTwo = two?.features[0]?.rules[0]?.examples[0];
  assert.equal(inTwo?.novelty, "unchanged");
  assert.equal(inOne?.hash, inTwo?.hash);
});
