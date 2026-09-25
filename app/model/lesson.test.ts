import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureCourse, fixtureLesson, fixtureOverview, FIXTURE_NOW } from "../../shared/fixtures.ts";
import type { Example, Homework, Step } from "../../shared/model.ts";
import type { Lesson } from "../../shared/rpc.ts";
import { exampleLines, stepLines, stepTextTokens } from "./gherkin.ts";
import { buildLesson, marginNote } from "./lesson.ts";

const NOW = Date.parse(FIXTURE_NOW);
const homeworks = fixtureOverview.homeworks;

function homework(id: string): Homework {
  const found = fixtureCourse.homeworks.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no fixture homework ${id}`);
  return found;
}

function exampleOf(lesson: Lesson, name: string): Example {
  const found = lesson.homework.features
    .flatMap((feature) => feature.rules.flatMap((rule) => rule.examples))
    .find((example) => example.name === name);
  if (found === undefined) throw new Error(`no example ${name}`);
  return found;
}

test("quoted strings are picked out of step text", () => {
  assert.deepEqual(stepTextTokens('Given "validator" is misspelt "validater"'), [
    { kind: "text", text: "Given " },
    { kind: "string", text: '"validator"' },
    { kind: "text", text: " is misspelt " },
    { kind: "string", text: '"validater"' },
  ]);
});

test("docstrings and tables print verbatim, one row per line", () => {
  const step: Step = {
    keyword: "And",
    text: "this assembly line:",
    docString: { mediaType: "dot", content: "digraph {\n  start -> finish\n}" },
    dataTable: [
      ["machine", "agent"],
      ["doer", "claude"],
    ],
    line: 3,
  };
  const lines = stepLines(step, 1);
  assert.deepEqual(lines[0]?.tokens[0], { kind: "keyword", text: "And" });
  assert.deepEqual(
    lines.slice(1).map((line) => [line.indent, line.verbatim, line.tokens[0]?.text]),
    [
      [2, true, '"""dot'],
      [2, true, "digraph {"],
      [2, true, "  start -> finish"],
      [2, true, "}"],
      [2, true, '"""'],
      [2, true, "| machine | agent  |"],
      [2, true, "| doer    | claude |"],
    ],
  );
});

test("an Example prints its tags above the header line", () => {
  const tagged = exampleOf({ ...fixtureLesson }, "A stand-in that is never satisfied");
  const { lines, headerIndex } = exampleLines(tagged);
  assert.equal(headerIndex, 1);
  assert.deepEqual(lines[0]?.tokens, [{ kind: "tag", text: "@real-agent" }]);
  assert.deepEqual(lines[1]?.tokens, [
    { kind: "keyword", text: "Example:" },
    { kind: "text", text: " A stand-in that is never satisfied" },
  ]);
  assert.equal(lines.length, 2 + tagged.steps.length);
});

test("the current lesson ends at the Rule in focus, other features collapsed ahead of it", () => {
  const view = buildLesson(fixtureLesson, homeworks, NOW);
  assert.equal(view.eyebrow, "Homework 2 · Set after day 2");
  assert.equal(view.barTitle, "Homework 2 · Checking the work");
  assert.deepEqual(view.focus, {
    ruleKey: "validation/a-task-is-finished-when-validation-is-satisfied",
    label: "in focus",
  });
  assert.equal(view.crumb, "Validation › A task is finished when validation is satisfied");
  assert.equal(view.focusFeature?.name, "Validation");
  assert.deepEqual(view.otherFeatures.map((feature) => feature.name), ["Planning"]);
  assert.deepEqual(
    view.focusFeature?.rules.map((rule) => [rule.status, rule.isFocus, rule.isUpNext, rule.summary]),
    [
      ["not-yet", true, false, "1/2 · not yet"],
      ["pending", false, false, "0/1"],
    ],
  );
  const planning = view.otherFeatures[0]?.rules[0];
  assert.deepEqual([planning?.isUpNext, planning?.summary], [true, "up next"], "suggested order puts reworded Rules first");
  assert.deepEqual(view.chips, [
    { text: "2 of 5 examples hold", tone: "plain" },
    { text: "4 new or reworded", tone: "amber" },
  ]);
  assert.equal(view.percent, 40);
  assert.equal(view.readyToComplete, false);
});

test("the compass names what is new since the previous real homework", () => {
  const view = buildLesson(fixtureLesson, homeworks, NOW);
  assert.deepEqual(view.compass, {
    title: "New since homework 1",
    items: [
      { file: "planning.feature", text: "1 reworded: “The planner writes a plan”." },
      { file: "validation.feature", text: "A validator decides whether a task is finished." },
    ],
  });
  const first = buildLesson({ ...fixtureLesson, homework: homework("001"), status: "done", progress: {} }, homeworks, NOW);
  assert.equal(first.compass, null, "everything is new in the first homework");
  const builtin = buildLesson({ ...fixtureLesson, homework: homework("000"), status: "done", progress: {} }, homeworks, NOW);
  assert.equal(builtin.compass, null);
});

test("margin notes carry the coach's words and the evidence", () => {
  const progress = fixtureLesson.progress;
  const carried = marginNote(exampleOf(fixtureLesson, "A seed becomes a plan"), progress, NOW);
  assert.equal(carried?.tone, "green");
  assert.equal(carried?.label, "Carried over");
  assert.equal(carried?.text, "Passing since homework 1.");
  assert.match(carried?.evidence ?? "", /plan written/);

  const marked = marginNote(exampleOf(fixtureLesson, "The work is right first time"), progress, NOW);
  assert.deepEqual([marked?.tone, marked?.label, marked?.text], ["green", "Coach · 14m ago", null]);

  const notYet = marginNote(exampleOf(fixtureLesson, "The work is wrong first time"), progress, NOW);
  assert.deepEqual(
    [notYet?.tone, notYet?.label, notYet?.text],
    ["amber", "Coach · not yet · just now", "Crashed in the doer loop instead of retrying when the validator said no."],
  );

  const realAgent = marginNote(exampleOf(fixtureLesson, "A stand-in that is never satisfied"), progress, NOW);
  assert.equal(realAgent?.tone, "purple");

  const reworded = exampleOf(fixtureLesson, "An existing plan is kept");
  assert.equal(marginNote(reworded, progress, NOW)?.label, "Reworded");
  const stale = { [reworded.key]: { status: "passing" as const, hash: `sha256:${"0".repeat(64)}`, at: FIXTURE_NOW, evidence: "x" } };
  assert.deepEqual(marginNote(reworded, stale, NOW)?.tone, "muted", "a hash mismatch reads as pending again");

  const skipped = { [reworded.key]: { status: "skipped" as const, hash: reworded.hash, at: FIXTURE_NOW, note: "Out of scope." } };
  assert.deepEqual(marginNote(reworded, skipped, NOW), { tone: "muted", label: "Skipped", text: "Out of scope.", evidence: null });

  const unchanged = { ...reworded, novelty: "unchanged" as const, tags: [] };
  assert.equal(marginNote(unchanged, {}, NOW), null);
});

test("without a stored focus the lesson ends at the first open Rule in suggested order", () => {
  const view = buildLesson({ ...fixtureLesson, focus: null }, homeworks, NOW);
  assert.deepEqual(view.focus, { ruleKey: "planning/the-planner-writes-a-plan", label: "up next" });
  assert.equal(view.focusFeature?.name, "Planning");

  const unknown = buildLesson({ ...fixtureLesson, focus: "planning/gone" }, homeworks, NOW);
  assert.equal(unknown.focus?.label, "up next", "a focus naming a missing Rule is ignored");
});

test("previews and finished homeworks have no focus and open every feature", () => {
  const preview = buildLesson(
    { ...fixtureLesson, homework: homework("003"), status: "ahead", iterationStatus: null, focus: null, progress: {} },
    homeworks,
    NOW,
  );
  assert.equal(preview.focus, null);
  assert.equal(preview.focusFeature, null);
  assert.equal(preview.otherFeatures.length, 1);
  assert.deepEqual(preview.chips, [
    { text: "1 rule · 1 example", tone: "plain" },
    { text: "Preview", tone: "plain" },
  ]);
  assert.equal(preview.compass, null, "fixture homework 3 is all new");

  const finished = buildLesson({ ...fixtureLesson, status: "done", iterationStatus: "Done" }, homeworks, NOW);
  assert.equal(finished.focus, null);
  assert.equal(finished.readyToComplete, true);
  assert.deepEqual(finished.chips.map((chip) => chip.tone), ["green", "green"]);
});
