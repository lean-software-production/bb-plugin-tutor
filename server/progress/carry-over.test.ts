import assert from "node:assert/strict";
import { test } from "node:test";
import { findLesson } from "../../shared/derive.ts";
import { fixtureCourse, fixtureStudent } from "../../shared/fixtures.ts";
import type { ProgressFile } from "../../shared/model.ts";
import { carryOver } from "./carry-over.ts";

const lesson2 = findLesson(fixtureCourse, "002");
const lesson1 = findLesson(fixtureCourse, "001");
const ADOPTED = "2026-09-26T09:00:00Z";

test("passing Examples with the same text carry over; the rest start pending", () => {
  assert.ok(lesson1 !== undefined && lesson2 !== undefined);
  const [seedBecomesPlan, existingPlanKept] = lesson1.features[0]?.rules[0]?.examples ?? [];
  assert.ok(seedBecomesPlan !== undefined && existingPlanKept !== undefined);
  const previous: ProgressFile = {
    iteration: "001",
    examples: {
      [seedBecomesPlan.key]: { status: "passing", hash: seedBecomesPlan.hash, evidence: "$ ./factory", at: "2026-09-22T15:00:00Z" },
      // Reworded in 002, so its hash no longer matches.
      [existingPlanKept.key]: { status: "passing", hash: existingPlanKept.hash, evidence: "$ ./factory", at: "2026-09-22T15:05:00Z" },
    },
  };
  const next = carryOver(previous, lesson2, ADOPTED);
  assert.deepEqual(next, {
    iteration: "002",
    focus: lesson2.suggestedRuleOrder[0],
    adopted: ADOPTED,
    examples: {
      [seedBecomesPlan.key]: {
        status: "passing",
        hash: seedBecomesPlan.hash,
        evidence: "$ ./factory",
        at: "2026-09-22T15:00:00Z",
        carriedFrom: "001",
      },
    },
    history: {
      "001": {
        examples: {
          [seedBecomesPlan.key]: { status: "passing", hash: seedBecomesPlan.hash, at: "2026-09-22T15:00:00Z" },
          [existingPlanKept.key]: { status: "passing", hash: existingPlanKept.hash, at: "2026-09-22T15:05:00Z" },
        },
      },
    },
  });
});

test("the history keeps every earlier lesson with its summary", () => {
  assert.ok(lesson2 !== undefined);
  const previous: ProgressFile = {
    iteration: "001",
    adopted: "2026-09-21T09:00:00Z",
    summary: "It plans.",
    examples: {},
    history: { "000": { examples: {} } },
  };
  const next = carryOver(previous, lesson2, ADOPTED);
  assert.deepEqual(next.history, {
    "000": { examples: {} },
    "001": { adopted: "2026-09-21T09:00:00Z", summary: "It plans.", examples: {} },
  });
});

test("matches by hash under any key, keeps the original lesson, ignores not-yet", () => {
  assert.ok(lesson2 !== undefined);
  const progress = fixtureStudent.progress;
  assert.ok(progress !== null);
  const moved: ProgressFile = {
    iteration: "002",
    examples: Object.fromEntries(Object.entries(progress.examples).map(([key, entry]) => [`renamed/${key.split("/").slice(1).join("/")}`, entry])),
  };
  const next = carryOver(moved, lesson2, ADOPTED);
  const statuses = Object.values(next.examples).map((entry) => [entry.status, entry.carriedFrom]);
  assert.deepEqual(statuses.sort(), [
    ["passing", "001"],
    ["passing", "002"],
  ]);
});

test("with no previous progress every Example is pending and there is no history", () => {
  assert.ok(lesson1 !== undefined);
  const next = carryOver(null, lesson1, ADOPTED);
  assert.deepEqual(next.examples, {});
  assert.equal(next.history, undefined);
});
