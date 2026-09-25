import assert from "node:assert/strict";
import { test } from "node:test";
import { findMainThread, toTutorThread, type ThreadRow } from "./threads.ts";

function row(overrides: Partial<ThreadRow>): ThreadRow {
  return {
    id: "thr_1",
    projectId: "prj_factory",
    parentThreadId: null,
    originPluginId: "tutor",
    title: "Coach · Homework 002",
    createdAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

test("the role comes from the thread's parent, not from what the metadata claims", () => {
  const claimsMain = toTutorThread(row({ parentThreadId: "thr_main" }), {
    course: "c",
    iteration: "002",
    role: "main",
    ruleKey: "validation/a-rule",
  });
  assert.equal(claimsMain?.role, "side");
  assert.equal(claimsMain?.ruleKey, "validation/a-rule");
  assert.equal(toTutorThread(row({}), { course: "c", iteration: "002", role: "side", ruleKey: "a/b" })?.ruleKey, null);
  assert.equal(toTutorThread(row({}), { iteration: 2 }), null);
});

test("finds the newest main thread for the course and homework", () => {
  const meta = (iteration: string, course = "c") => ({ course, iteration, role: "main" });
  const threads = [
    toTutorThread(row({ id: "old", createdAt: 1 }), meta("002")),
    toTutorThread(row({ id: "new", createdAt: 5 }), meta("002")),
    toTutorThread(row({ id: "other-course", createdAt: 9 }), meta("002", "d")),
    toTutorThread(row({ id: "side", createdAt: 9, parentThreadId: "new" }), meta("002")),
  ].filter((thread) => thread !== null);
  assert.equal(findMainThread(threads, "c", "002")?.id, "new");
  assert.equal(findMainThread(threads, "c", "003"), undefined);
});
