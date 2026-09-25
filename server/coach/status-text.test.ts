import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureStudent } from "../../shared/fixtures.ts";
import { makeWorld } from "../../test/helpers/world.ts";
import { coachStateOf } from "./actions.ts";
import { statusText } from "./status-text.ts";

test("lists the lesson, the focus and every Example key with its status", () => {
  const state = coachStateOf(makeWorld());
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
  const state = coachStateOf(makeWorld(noisy));
  assert.ok(!("error" in state));
  const text = statusText(state);
  assert.ok(text.length <= 6000);
  assert.match(text, /\(and 197 more\)/);
});
