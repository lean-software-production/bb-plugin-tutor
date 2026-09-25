import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countExamples,
  exampleStatus,
  findExample,
  findRule,
  homeworkExamples,
  homeworkStatus,
  nextHomework,
  resolveCurrent,
  ruleStatus,
} from "./derive.ts";
import { fixtureCourse, fixtureFreshStudent, fixtureStudent } from "./fixtures.ts";
import type { ExampleProgress, Homework } from "./model.ts";

function homework(id: string): Homework {
  const found = fixtureCourse.homeworks.find((h) => h.id === id);
  assert.ok(found);
  return found;
}
const progress = fixtureStudent.progress?.examples ?? {};

test("counts and rule glyphs follow the progress map", () => {
  const hw = homework("002");
  assert.deepEqual(countExamples(homeworkExamples(hw), progress), {
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
  const example = homeworkExamples(homework("002"))[0]!;
  const stale: Record<string, ExampleProgress> = {
    [example.key]: { status: "passing", hash: `sha256:${"0".repeat(64)}`, evidence: "x", at: "2026-09-25T00:00:00Z" },
  };
  assert.equal(exampleStatus(example, stale), "pending");
});

test("a rule is passing when every example is passing or skipped", () => {
  const rule = homework("002").features[1]!.rules[0]!;
  const all = Object.fromEntries(
    rule.examples.map((e, i) => [e.key, { status: i === 0 ? "passing" : "skipped", hash: e.hash, at: "2026-09-25T00:00:00Z" } as const]),
  );
  assert.equal(ruleStatus(rule, all), "passing");
});

test("resolveCurrent trusts spec/ITERATION", () => {
  const pointer = resolveCurrent(fixtureCourse, fixtureStudent);
  assert.deepEqual(pointer, { homeworkId: "002", iterationStatus: "WIP" });
  assert.equal(homeworkStatus(fixtureCourse, pointer, "000"), "done");
  assert.equal(homeworkStatus(fixtureCourse, pointer, "002"), "current");
  assert.equal(homeworkStatus(fixtureCourse, pointer, "003"), "ahead");
  assert.equal(homeworkStatus(fixtureCourse, pointer, "999"), "ahead");
  const done = resolveCurrent(fixtureCourse, { ...fixtureStudent, iteration: { iteration: "002", status: "Done" } });
  assert.equal(homeworkStatus(fixtureCourse, done, "002"), "done");
});

test("with no spec/ITERATION the student starts on Homework 0", () => {
  assert.deepEqual(resolveCurrent(fixtureCourse, fixtureFreshStudent), { homeworkId: "000", iterationStatus: "not-started" });
  const builtin = homeworkExamples(homework("000"));
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

test("an ITERATION naming an unknown homework is ignored", () => {
  const pointer = resolveCurrent(fixtureCourse, { ...fixtureFreshStudent, iteration: { iteration: "042", status: "WIP" } });
  assert.equal(pointer.homeworkId, "000");
});

test("lookups", () => {
  assert.equal(nextHomework(fixtureCourse, "002")?.id, "003");
  assert.equal(nextHomework(fixtureCourse, "003"), undefined);
  const hw = homework("002");
  const rule = hw.features[1]!.rules[0]!;
  assert.equal(findRule(hw, rule.key)?.name, rule.name);
  assert.equal(findExample(hw, rule.examples[0]!.key)?.name, rule.examples[0]!.name);
  assert.equal(findRule(hw, "nope/nope"), undefined);
});
