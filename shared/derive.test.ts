import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countExamples,
  exampleStatus,
  findExample,
  findRule,
  lessonExamples,
  lessonStatus,
  nextLesson,
  resolveCurrent,
  ruleStatus,
} from "./derive.ts";
import { fixtureCourse, fixtureFreshStudent, fixtureStudent } from "./fixtures.ts";
import type { ExampleProgress, Lesson } from "./model.ts";

function lesson(id: string): Lesson {
  const found = fixtureCourse.lessons.find((h) => h.id === id);
  assert.ok(found);
  return found;
}
const progress = fixtureStudent.progress?.examples ?? {};

test("counts and rule glyphs follow the progress map", () => {
  const hw = lesson("002");
  assert.deepEqual(countExamples(lessonExamples(hw), progress), {
    total: 5,
    passing: 2,
    notYet: 1,
    skipped: 0,
    pending: 2,
    fresh: 4,
  });
  const [planning, validation] = hw.features;
  assert.equal(ruleStatus(planning!.rules[0]!, progress), "pending");
  assert.equal(ruleStatus(validation!.rules[0]!, progress), "not-yet");
  assert.equal(ruleStatus(validation!.rules[1]!, progress), "pending");
});

test("an entry recorded against other text counts as pending", () => {
  const example = lessonExamples(lesson("002"))[0]!;
  const stale: Record<string, ExampleProgress> = {
    [example.key]: { status: "passing", hash: `sha256:${"0".repeat(64)}`, evidence: "x", at: "2026-09-25T00:00:00Z" },
  };
  assert.equal(exampleStatus(example, stale), "pending");
});

test("a rule is passing when every example is passing or skipped", () => {
  const rule = lesson("002").features[1]!.rules[0]!;
  const all = Object.fromEntries(
    rule.examples.map((e, i) => [e.key, { status: i === 0 ? "passing" : "skipped", hash: e.hash, at: "2026-09-25T00:00:00Z" } as const]),
  );
  assert.equal(ruleStatus(rule, all), "passing");
});

test("resolveCurrent trusts ITERATION", () => {
  const pointer = resolveCurrent(fixtureCourse, fixtureStudent);
  assert.deepEqual(pointer, { lessonId: "002", iterationStatus: "WIP" });
  assert.equal(lessonStatus(fixtureCourse, pointer, "000"), "done");
  assert.equal(lessonStatus(fixtureCourse, pointer, "002"), "current");
  assert.equal(lessonStatus(fixtureCourse, pointer, "003"), "ahead");
  assert.equal(lessonStatus(fixtureCourse, pointer, "999"), "ahead");
  const done = resolveCurrent(fixtureCourse, { ...fixtureStudent, iteration: { iteration: "002", status: "Done" } });
  assert.equal(lessonStatus(fixtureCourse, done, "002"), "done");
});

test("with no ITERATION the student starts on Lesson 0", () => {
  assert.deepEqual(resolveCurrent(fixtureCourse, fixtureFreshStudent), { lessonId: "000", iterationStatus: "not-started" });
  const builtin = lessonExamples(lesson("000"));
  const onZero = (statuses: ExampleProgress["status"][]) =>
    resolveCurrent(fixtureCourse, {
      iteration: null,
      problems: [],
      progress: {
        iteration: "000",
        examples: Object.fromEntries(
          builtin.map((e, i) => [e.key, { status: statuses[i] ?? "pending", hash: e.hash, at: "2026-09-25T00:00:00Z", evidence: "x" }]),
        ),
      },
    });
  assert.equal(onZero(["passing", "pending"]).iterationStatus, "WIP");
  assert.equal(onZero(["passing", "skipped"]).iterationStatus, "Done");
});

test("an ITERATION naming an unknown lesson is ignored", () => {
  const pointer = resolveCurrent(fixtureCourse, { ...fixtureFreshStudent, iteration: { iteration: "042", status: "WIP" } });
  assert.equal(pointer.lessonId, "000");
});

test("lookups", () => {
  assert.equal(nextLesson(fixtureCourse, "002")?.id, "003");
  assert.equal(nextLesson(fixtureCourse, "003"), undefined);
  const hw = lesson("002");
  const rule = hw.features[1]!.rules[0]!;
  assert.equal(findRule(hw, rule.key)?.name, rule.name);
  assert.equal(findExample(hw, rule.examples[0]!.key)?.name, rule.examples[0]!.name);
  assert.equal(findRule(hw, "nope/nope"), undefined);
});
