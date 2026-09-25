import assert from "node:assert/strict";
import { test } from "node:test";
import { findMainThread, reachedRulesOf, threadRole, toTutorThread, type ThreadRow } from "./threads.ts";

function row(overrides: Partial<ThreadRow>): ThreadRow {
  return {
    id: "thr_1",
    projectId: "prj_factory",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: "tutor",
    visibility: "visible",
    title: "Coach · Lesson 002",
    createdAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

test("the role comes from the thread's parent, not from what the metadata claims", () => {
  const claimsMain = toTutorThread(row({ parentThreadId: "thr_main" }), {
    course: "c",
    lesson: "002",
    role: "main",
    ruleKey: "validation/a-rule",
  });
  assert.equal(claimsMain?.role, "side");
  assert.equal(claimsMain?.ruleKey, "validation/a-rule");
  assert.equal(toTutorThread(row({}), { course: "c", lesson: "002", role: "side", ruleKey: "a/b" })?.ruleKey, null);
  assert.equal(toTutorThread(row({}), { lesson: 2 }), null);
});

test("finds the newest main thread for the course and lesson", () => {
  const meta = (lesson: string, course = "c") => ({ course, lesson, role: "main" });
  const threads = [
    toTutorThread(row({ id: "old", createdAt: 1 }), meta("002")),
    toTutorThread(row({ id: "new", createdAt: 5 }), meta("002")),
    toTutorThread(row({ id: "other-course", createdAt: 9 }), meta("002", "d")),
    toTutorThread(row({ id: "side", createdAt: 9, parentThreadId: "new" }), meta("002")),
    toTutorThread(row({ id: "fork", createdAt: 9, sourceThreadId: "new", originKind: "fork", visibility: "hidden" }), meta("002")),
  ].filter((thread) => thread !== null);
  assert.equal(findMainThread(threads, "c", "002")?.id, "new");
  assert.equal(findMainThread(threads, "c", "003"), undefined);
});

test("a fork is a side chat of its source, never a main thread, whatever its metadata says", () => {
  const fork = toTutorThread(row({ id: "fork", sourceThreadId: "thr_main", originKind: "fork", visibility: "hidden" }), {
    course: "c",
    lesson: "002",
    role: "main",
    ruleKey: "validation/a-rule",
  });
  assert.deepEqual([fork?.role, fork?.mainThreadId, fork?.ruleKey], ["side", "thr_main", "validation/a-rule"]);
  assert.equal(threadRole(row({ visibility: "hidden" })), null, "a hidden thread that forks nothing is not listed");
  assert.equal(threadRole(row({ originKind: "fork" })), null, "a fork without a source is not listed");
  assert.equal(threadRole(row({})), "main");
});

test("reached Rules come from the coach thread's metadata, leniently", () => {
  assert.deepEqual(reachedRulesOf({ reachedRules: ["a/b", "a/b", "c/d", 7, "nope", "x/y/z"] }), ["a/b", "c/d"]);
  for (const junk of [null, undefined, "a/b", { reachedRules: "a/b" }, { reachedRules: null }]) {
    assert.deepEqual(reachedRulesOf(junk), [], String(junk));
  }
  const main = toTutorThread(row({}), { course: "c", lesson: "002", role: "main", reachedRules: ["a/b"] });
  assert.deepEqual(main?.reachedRules, ["a/b"]);
  const side = toTutorThread(row({ parentThreadId: "m" }), { course: "c", lesson: "002", role: "side", reachedRules: ["a/b"] });
  assert.deepEqual(side?.reachedRules, []);
});
