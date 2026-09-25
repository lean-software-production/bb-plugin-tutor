import assert from "node:assert/strict";
import { test } from "node:test";
import { findCoachThread, listAllThreads, reachedRulesOf, THREAD_PAGE_SIZE, threadRole, toTutorThread, type ThreadRow } from "./threads.ts";

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
  const claimsCoach = toTutorThread(row({ parentThreadId: "thr_main" }), {
    course: "c",
    lesson: "002",
    role: "coach",
    ruleKey: "validation/a-rule",
  });
  assert.equal(claimsCoach?.role, "sideChat");
  assert.equal(claimsCoach?.ruleKey, "validation/a-rule");
  assert.equal(toTutorThread(row({}), { course: "c", lesson: "002", role: "sideChat", ruleKey: "a/b" })?.ruleKey, null);
  assert.equal(toTutorThread(row({}), { lesson: 2 }), null);
});

test("finds the newest coach thread for the course and lesson", () => {
  const meta = (lesson: string, course = "c") => ({ course, lesson, role: "coach" });
  const threads = [
    toTutorThread(row({ id: "old", createdAt: 1 }), meta("002")),
    toTutorThread(row({ id: "new", createdAt: 5 }), meta("002")),
    toTutorThread(row({ id: "other-course", createdAt: 9 }), meta("002", "d")),
    toTutorThread(row({ id: "side", createdAt: 9, parentThreadId: "new" }), meta("002")),
    toTutorThread(row({ id: "fork", createdAt: 9, sourceThreadId: "new", originKind: "fork", visibility: "hidden" }), meta("002")),
  ].filter((thread) => thread !== null);
  assert.equal(findCoachThread(threads, "c", "002")?.id, "new");
  assert.equal(findCoachThread(threads, "c", "003"), undefined);
});

test("a fork is a side chat of its source, never a coach thread, whatever its metadata says", () => {
  const fork = toTutorThread(row({ id: "fork", sourceThreadId: "thr_main", originKind: "fork", visibility: "hidden" }), {
    course: "c",
    lesson: "002",
    role: "coach",
    ruleKey: "validation/a-rule",
  });
  assert.deepEqual([fork?.role, fork?.coachThreadId, fork?.ruleKey], ["sideChat", "thr_main", "validation/a-rule"]);
  assert.equal(threadRole(row({ visibility: "hidden" })), null, "a hidden thread that forks nothing is not listed");
  assert.equal(threadRole(row({ originKind: "fork" })), null, "a fork without a source is not listed");
  assert.equal(threadRole(row({})), "coach");
});

test("reached Rules come from the coach thread's metadata, leniently", () => {
  assert.deepEqual(reachedRulesOf({ reachedRules: ["a/b", "a/b", "c/d", 7, "nope", "x/y/z"] }), ["a/b", "c/d"]);
  for (const junk of [null, undefined, "a/b", { reachedRules: "a/b" }, { reachedRules: null }]) {
    assert.deepEqual(reachedRulesOf(junk), [], String(junk));
  }
  const coach = toTutorThread(row({}), { course: "c", lesson: "002", role: "coach", reachedRules: ["a/b"] });
  assert.deepEqual(coach?.reachedRules, ["a/b"]);
  const side = toTutorThread(row({ parentThreadId: "m" }), { course: "c", lesson: "002", role: "sideChat", reachedRules: ["a/b"] });
  assert.deepEqual(side?.reachedRules, []);
});

test("listing reads every page once, even when a new thread shifts the pages meanwhile", async () => {
  // Newest first, like bb-app: thr_449 … thr_0.
  const all = Array.from({ length: 450 }, (_, index) => row({ id: `thr_${449 - index}`, createdAt: 449 - index }));
  const offsets: number[] = [];
  const sdk = {
    threads: {
      list: async ({ limit, offset }: { limit: number; offset: number }) => {
        offsets.push(offset);
        const page = all.slice(offset, offset + limit);
        // A thread created after the first page pushes every older row down one.
        if (offsets.length === 1) all.unshift(row({ id: "thr_new", createdAt: 1000 }));
        return page;
      },
    },
  } as unknown as Parameters<typeof listAllThreads>[0];
  const rows = await listAllThreads(sdk, { originPluginId: "tutor" }, "test threads");
  assert.deepEqual(offsets, [0, THREAD_PAGE_SIZE, 2 * THREAD_PAGE_SIZE]);
  assert.equal(rows.length, 450);
  assert.equal(new Set(rows.map((entry) => entry.id)).size, 450, "no row twice");
});
