import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProgressCard } from "../../shared/directives.ts";
import { findLesson, lessonExamples } from "../../shared/derive.ts";
import { fixtureCourse, fixtureFreshStudent, fixtureStudent } from "../../shared/fixtures.ts";
import type { StudentState } from "../../shared/model.ts";
import { makeWorld } from "../../test/helpers/world.ts";
import {
  adoptAction,
  adoptionTargets,
  coachStateOf,
  completeAction,
  focusAction,
  markAction,
  otherLessonError,
  type CoachState,
  type Outcome,
} from "./actions.ts";

const NOW = "2026-09-25T11:00:00Z";

function stateOf(student: StudentState = fixtureStudent): CoachState {
  const state = coachStateOf(makeWorld(student));
  assert.ok(!("error" in state));
  return state;
}

function cardIn(outcome: Outcome) {
  assert.ok("text" in outcome, "error" in outcome ? outcome.error : "");
  const line = outcome.text.split("\n").find((text) => text.startsWith("::tutor-progress"));
  assert.ok(line !== undefined, "no card line");
  const attributes = Object.fromEntries([...line.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  return parseProgressCard(attributes as Record<string, string>);
}

const lesson2 = findLesson(fixtureCourse, "002");
assert.ok(lesson2 !== undefined);
const [planFromSeed, keptPlan, rightFirstTime, wrongFirstTime, neverSatisfied] = lessonExamples(lesson2);
assert.ok(planFromSeed && keptPlan && rightFirstTime && wrongFirstTime && neverSatisfied);
const validationRule = lesson2.features[1]?.rules[0];
assert.ok(validationRule !== undefined);

test("coachStateOf refuses without a course or a factory project", () => {
  assert.match((coachStateOf({ ...makeWorld(), course: null, courseError: "no ledger" }) as { error: string }).error, /no ledger/);
  assert.match((coachStateOf(makeWorld(fixtureStudent, { status: "unset" })) as { error: string }).error, /No factory/);
});

test("marking the last Example of a Rule passing gives a rule-passing card naming the next Rule", () => {
  const outcome = markAction(stateOf(), { example: wrongFirstTime.key, status: "passing", evidence: "$ ./factory\nok" }, NOW);
  const card = cardIn(outcome);
  assert.equal(card?.kind, "rule-passing");
  assert.equal(card?.title, validationRule.name);
  assert.equal(card?.passed, 3);
  assert.equal(card?.total, 5);
  assert.ok(card?.next !== null);
  assert.ok("progress" in outcome && outcome.progress !== undefined);
  assert.deepEqual(outcome.progress.examples[wrongFirstTime.key], {
    status: "passing",
    hash: wrongFirstTime.hash,
    evidence: "$ ./factory\nok",
    at: NOW,
  });
  assert.match(outcome.text, /tutor_focus_rule/);
});

test("not-yet and single passes give their own cards", () => {
  const notYet = cardIn(markAction(stateOf(), { example: keptPlan.key, status: "not-yet", note: "Plan was rewritten." }, NOW));
  assert.equal(notYet?.kind, "not-yet");
  assert.equal(notYet?.note, "Plan was rewritten.");
  assert.equal(notYet?.exampleKey, keptPlan.key);
  // Its sibling is still not yet, so the Rule does not hold.
  const passing = cardIn(markAction(stateOf(), { example: rightFirstTime.key, status: "passing", evidence: "ok" }, NOW));
  assert.equal(passing?.kind, "example-passing");
});

test("marking refuses unknown keys and lessons not under way", () => {
  const unknown = markAction(stateOf(), { example: "nope/nope/nope", status: "skipped" }, NOW);
  assert.ok("error" in unknown && /tutor_status/.test(unknown.error));
  const fresh = markAction(stateOf(fixtureFreshStudent), { example: keptPlan.key, status: "skipped" }, NOW);
  assert.ok("error" in fresh && /tutor_adopt_iteration/.test(fresh.error));
});

test("only the coach thread moves the focus, and the Rule card leads its next message", () => {
  const rule = lesson2.features[0]?.rules[0];
  assert.ok(rule !== undefined);
  const side = focusAction(stateOf(), { rule: rule.key }, false);
  assert.ok("error" in side);
  const onCoach = focusAction(stateOf(), { rule: rule.key }, true);
  assert.equal(cardIn(onCoach)?.kind, "focus");
  assert.ok("progress" in onCoach && onCoach.progress?.focus === rule.key);
  assert.ok("text" in onCoach && onCoach.reached === rule.key);
  assert.match(onCoach.text, /start your next message with this line, exactly as written and on a line of its own/);
  assert.match(onCoach.text, /\n::tutor-progress\{kind="focus"[^\n]*\}$/);
});

test("adoption: Lesson 0 or the first lesson to begin with, then the one after a Done one", () => {
  assert.deepEqual(adoptionTargets(fixtureCourse, { lessonId: "000", iterationStatus: "not-started" }), ["000", "001"]);
  assert.deepEqual(adoptionTargets(fixtureCourse, { lessonId: "000", iterationStatus: "WIP" }), ["001"]);
  assert.deepEqual(adoptionTargets(fixtureCourse, { lessonId: "002", iterationStatus: "WIP" }), []);
  assert.deepEqual(adoptionTargets(fixtureCourse, { lessonId: "002", iterationStatus: "Done" }), ["003"]);
  assert.deepEqual(adoptionTargets(fixtureCourse, { lessonId: "003", iterationStatus: "Done" }), []);
});

test("adopting a real lesson copies the spec and writes WIP; Lesson 0 writes progress only", () => {
  const done: StudentState = { ...fixtureStudent, iteration: { iteration: "002", status: "Done" } };
  const outcome = adoptAction(stateOf(done), { iteration: "003" }, NOW);
  assert.ok("adopt" in outcome);
  assert.equal(outcome.adopt?.id, "003");
  assert.deepEqual(outcome.iteration, { iteration: "003", status: "WIP" });
  assert.equal(outcome.progress?.adopted, NOW);
  assert.match(outcome.text, /spec\/ now holds its README\.md, FACTORY\.md and features\/, and \.\.\/seeds\/ its sample seed unless one was there already\./);
  assert.match(outcome.text, /stand-ins\/ is refreshed from the course, and ITERATION reads "003 WIP"\./);
  assert.match(outcome.text, /Commit spec\/, \.\.\/seeds\/ and ITERATION with the message "Adopt spec for iteration 003"/);

  const builtin = adoptAction(stateOf(fixtureFreshStudent), { iteration: "000" }, NOW);
  assert.ok("progress" in builtin);
  assert.equal(builtin.iteration, undefined);
  assert.equal(builtin.adopt, undefined);
  assert.equal(builtin.progress?.iteration, "000");

  const refused = adoptAction(stateOf(), { iteration: "003" }, NOW);
  assert.ok("error" in refused && /002 \(WIP\)/.test(refused.error));
});

test("completing writes Done and the summary; Lesson 0 needs every Example to hold", () => {
  const outcome = completeAction(stateOf(), { iteration: "002", summary: "It checks its work." });
  assert.ok("text" in outcome);
  assert.deepEqual(outcome.iteration, { iteration: "002", status: "Done" });
  assert.equal(outcome.progress?.summary, "It checks its work.");
  assert.match(outcome.text, /3 examples are not marked/);
  assert.equal(cardIn(outcome)?.kind, "lesson-complete");
  assert.match(outcome.text, /Commit the implementation, ITERATION and spec\/PROGRESS\.yaml with the message "Implement homework 002"\./);

  const wrong = completeAction(stateOf(), { iteration: "003", summary: "x" });
  assert.ok("error" in wrong);

  const onZero: StudentState = { iteration: null, progress: { iteration: "000", examples: {} }, problems: [] };
  const zero = completeAction(stateOf(onZero), { iteration: "000", summary: "x" });
  assert.ok("error" in zero && /Lesson 0/.test(zero.error));
});

test("a lesson set to WIP outside Tutor, with no progress for it, is adopted again by its own coach", () => {
  // fetch-iteration ran outside BB: ITERATION reads 003 WIP, spec/PROGRESS.yaml is still Lesson 002's.
  const fetched: StudentState = { ...fixtureStudent, iteration: { iteration: "003", status: "WIP" } };
  const state = stateOf(fetched);
  assert.equal(state.progress, null);
  assert.deepEqual(adoptionTargets(fixtureCourse, state.pointer, true), ["003"]);
  assert.equal(otherLessonError(state, { courseId: fixtureCourse.id, lessonId: "003" }), null);
  const outcome = adoptAction(state, { iteration: "003" }, NOW);
  assert.ok("adopt" in outcome, "error" in outcome ? outcome.error : "");
  assert.equal(outcome.adopt?.id, "003");
  assert.deepEqual(outcome.iteration, { iteration: "003", status: "WIP" });
  assert.equal(outcome.progress?.iteration, "003");
  // With progress for it, a WIP lesson is under way and is not adopted again.
  const underWay = adoptAction(stateOf(), { iteration: "002" }, NOW);
  assert.ok("error" in underWay && /Nothing can be adopted now/.test(underWay.error));
});

test("a WIP lesson whose spec/PROGRESS.yaml is damaged is never adopted again: that would erase its marks", () => {
  // ITERATION reads 002 WIP; spec/PROGRESS.yaml is there but doesn't parse (a conflict marker, a bad hand edit).
  const damaged: StudentState = {
    iteration: { iteration: "002", status: "WIP" },
    progress: null,
    progressUnreadable: true,
    problems: ["spec/PROGRESS.yaml is not valid YAML (bad indentation)."],
  };
  const state = stateOf(damaged);
  assert.equal(state.progress, null);
  const refused = adoptAction(state, { iteration: "002" }, NOW);
  assert.ok("error" in refused, "adopted over a damaged spec/PROGRESS.yaml");
  assert.match(refused.error, /spec\/PROGRESS\.yaml could not be read/);
  const marked = markAction(state, { example: planFromSeed.key, status: "passing", evidence: "$ ./factory" }, NOW);
  assert.ok("error" in marked);
  assert.doesNotMatch(marked.error, /tutor_adopt_iteration/, "the coach is not sent to adopt");
  assert.match(marked.error, /spec\/PROGRESS\.yaml could not be read/);
});
