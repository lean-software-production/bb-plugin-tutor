import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureBuiltinCourse, fixtureCourse, fixtureStudent } from "../../shared/fixtures.ts";
import { makeWorld, withCourse } from "../../test/helpers/world.ts";
import { coachStateOf } from "./actions.ts";
import { statusText } from "./status-text.ts";

test("lists the lesson, the focus and every Example key with its status", () => {
  const state = coachStateOf(makeWorld(), fixtureCourse.id);
  assert.ok(!("error" in state));
  const text = statusText(state);
  assert.match(text, /Lesson 002 "Checking the work": WIP\. 2\/5 passing, 1 not yet, 0 skipped, 2 pending\./);
  assert.match(text, /Focus: validation\/a-task-is-finished-when-validation-is-satisfied\./);
  assert.match(text, /^● validation\/a-task-is-finished-when-validation-is-satisfied — /m);
  assert.match(text, /! validation\/.*\/the-work-is-wrong-first-time — The work is wrong first time \(Crashed/);
  assert.match(text, /Lexicon ids for ::term: doer, assembly-line\./);
  assert.match(text, /Coaching method: \/workspaces\/tutorial\/\.agents\/coach-me\.md/);
});

test("stays bounded however long the notes are", () => {
  const progress = fixtureStudent.progress;
  assert.ok(progress !== null);
  const note = "x".repeat(1000);
  const examples = Object.fromEntries(
    Object.entries(progress.examples).map(([key, entry]) => [key, { ...entry, status: "not-yet" as const, note }]),
  );
  const noisy = {
    ...fixtureStudent,
    progress: { ...progress, examples },
    problems: Array.from({ length: 200 }, () => "spec/PROGRESS.yaml: something odd happened here and was ignored."),
  };
  const state = coachStateOf(makeWorld(noisy), fixtureCourse.id);
  assert.ok(!("error" in state));
  const text = statusText(state);
  assert.ok(text.length <= 6000);
  assert.match(text, /\(and 197 more\)/);
});

test("names the coaching method the world found, the starter's skill included", () => {
  const skill = "/workspaces/capstone-project-starter/tetris/.agents/skills/coach-me/SKILL.md";
  const withSkill = coachStateOf(withCourse(makeWorld(), fixtureCourse.id, { coachPath: skill }), fixtureCourse.id);
  assert.ok(!("error" in withSkill));
  assert.match(statusText(withSkill), /Coaching method: \/workspaces\/capstone-project-starter\/tetris\/\.agents\/skills\/coach-me\/SKILL\.md\./);
  const without = coachStateOf(withCourse(makeWorld(), fixtureCourse.id, { coachPath: null }), fixtureCourse.id);
  assert.ok(!("error" in without));
  assert.match(statusText(without), /Coaching method: \(no coach file\)\./);
});

test("a WIP lesson with no progress says it needs adopting; with a damaged spec/PROGRESS.yaml, repairing", () => {
  // fetch-iteration ran outside BB: ITERATION reads 003 WIP, spec/PROGRESS.yaml is still Lesson 002's.
  const fetched = coachStateOf(makeWorld({ ...fixtureStudent, iteration: { iteration: "003", status: "WIP" } }), fixtureCourse.id);
  assert.ok(!("error" in fetched));
  assert.match(statusText(fetched), /^Not adopted in Tutor yet: call tutor_adopt_iteration for Lesson 003\.$/m);
  const damaged = coachStateOf(makeWorld({
    iteration: { iteration: "002", status: "WIP" },
    progress: null,
    progressUnreadable: true,
    problems: ["spec/PROGRESS.yaml is not valid YAML (bad indentation)."],
  }), fixtureCourse.id);
  assert.ok(!("error" in damaged));
  const text = statusText(damaged);
  assert.doesNotMatch(text, /Not adopted/);
  assert.match(text, /spec\/PROGRESS\.yaml could not be read, so Lesson 002's marks are unknown/);
  // Adopted and under way: neither line.
  const adopted = coachStateOf(makeWorld(), fixtureCourse.id);
  assert.ok(!("error" in adopted));
  assert.doesNotMatch(statusText(adopted), /Not adopted|could not be read/);
});

test("Lesson 0 reports on the built-in course, kept in .tutor/ in the workspace", () => {
  const state = coachStateOf(makeWorld(), fixtureBuiltinCourse.id);
  assert.ok(!("error" in state));
  const text = statusText(state);
  assert.match(text, /^Course: Using your tutor\./m);
  assert.match(text, /Tutor keeps this course's progress in \.tutor\//);
  assert.match(text, /Lesson 000 "Using your tutor": Done\. 2\/2 passing/);
});
