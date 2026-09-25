import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureOverview, fixtureOverviewUnbound } from "../../shared/fixtures.ts";
import type { Overview } from "../../shared/rpc.ts";
import { buildRail, viewedHomework } from "./rail.ts";
import type { RailInput } from "./rail.ts";
import { indicatorTone, indicatorView } from "./threads.ts";
import type { SidebarThreadLike } from "./threads.ts";

function thread(id: string, fields: Partial<SidebarThreadLike> = {}): SidebarThreadLike {
  return {
    id,
    projectId: "prj_factory",
    href: `/projects/prj_factory/threads/${id}`,
    displayTitle: id,
    parentThreadId: null,
    indicator: "none",
    indicatorLabel: null,
    isHidden: false,
    isArchived: false,
    isPinned: false,
    createdAt: 1,
    updatedAt: 1,
    ...fields,
  };
}

const liveThreads: SidebarThreadLike[] = [
  thread("thr_coach002", { displayTitle: "Coach · Homework 002", indicator: "runtime", indicatorLabel: "Working", createdAt: 10 }),
  thread("thr_side002", {
    displayTitle: "Why does the validator see the diff?",
    parentThreadId: "thr_coach002",
    indicator: "unread-success",
    indicatorLabel: "Unread",
    createdAt: 20,
  }),
  thread("thr_coach001", { displayTitle: "Coach · Homework 001", createdAt: 5 }),
  thread("thr_readme", { displayTitle: "Add a README for the factory", updatedAt: 50 }),
  thread("thr_child", { displayTitle: "Child of README", parentThreadId: "thr_readme", updatedAt: 60 }),
  thread("thr_pi", { displayTitle: "Set up pi auth", projectId: "prj_personal", updatedAt: 90 }),
  thread("thr_hidden", { isHidden: true }),
  thread("thr_archived", { isArchived: true }),
];

const projects = [
  { id: "prj_factory", name: "my-factory" },
  { id: "prj_personal", name: "Personal" },
];

function input(fields: Partial<RailInput> = {}): RailInput {
  return {
    overview: fixtureOverview,
    overviewError: null,
    threads: liveThreads,
    projects,
    activeThreadId: null,
    route: null,
    ...fields,
  };
}

test("a bound student sees days, progress, the outline and every conversation", () => {
  const rail = buildRail(input());
  assert.equal(rail.brand, "Build a software factory");
  assert.deepEqual(rail.status, { kind: "ready" });
  assert.deepEqual(
    rail.days.map((day) => [day.id, day.status, day.subPath]),
    [
      ["000", "done", "lesson/000"],
      ["001", "done", "lesson/001"],
      ["002", "current", "lesson/002"],
      ["003", "ahead", "lesson/003"],
    ],
  );
  assert.deepEqual(rail.progress, {
    eyebrow: "Homework 2 · Day 2",
    title: "Checking the work",
    passing: 2,
    total: 5,
    fresh: 4,
    percent: 40,
    complete: false,
    route: { kind: "lesson", homeworkId: "002" },
  });
  assert.deepEqual(
    rail.features.map((feature) => [feature.name, feature.count, feature.expandedByDefault, feature.dim]),
    [
      ["Planning", "1/2", false, false],
      ["Validation", "1/3", true, false],
    ],
  );
  assert.deepEqual(
    rail.features[1]?.rules.map((rule) => [rule.glyph, rule.isFocus, rule.novelty]),
    [
      ["focus", true, "new"],
      ["pending", false, "new"],
    ],
  );
  assert.equal(
    rail.features[1]?.rules[0]?.subPath,
    "lesson/002/validation/a-task-is-finished-when-validation-is-satisfied",
    "a Rule link names the Rule, so a new tab opens it too",
  );
  assert.deepEqual(
    rail.conversations.map((row) => [row.id, row.kind, row.indicator.tone, row.nested]),
    [
      ["thr_coach002", "coach", "working", false],
      ["thr_side002", "side", "unread", false],
    ],
  );
  assert.equal(rail.canStartCoach, false);
  assert.deepEqual(rail.earlier.map((row) => [row.id, row.kind, row.muted]), [["thr_coach001", "coach", true]]);
});

test("other threads keep BB usable: grouped by project, newest first, children nested, hidden ones left out", () => {
  const rail = buildRail(input());
  assert.deepEqual(
    rail.others.map((group) => [group.name, group.rows.map((row) => [row.title, row.nested])]),
    [
      ["Personal", [["Set up pi auth", false]]],
      ["my-factory", [["Add a README for the factory", false], ["Child of README", true]]],
    ],
  );
});

test("the lesson page counts as its coach thread being open, since activeThreadId is null there", () => {
  const onLesson = buildRail(input({ route: { kind: "lesson", homeworkId: "002" } }));
  assert.equal(onLesson.conversations.find((row) => row.id === "thr_coach002")?.isActive, true);
  assert.equal(onLesson.days.find((day) => day.isViewed)?.id, "002");

  const onSide = buildRail(input({ activeThreadId: "thr_side002" }));
  assert.deepEqual(
    onSide.conversations.map((row) => [row.id, row.isActive]),
    [
      ["thr_coach002", false],
      ["thr_side002", true],
    ],
  );
  assert.equal(onSide.days.find((day) => day.isViewed)?.id, "002");
});

test("viewedHomework prefers the route, then the open Tutor thread", () => {
  assert.equal(viewedHomework({ kind: "complete", homeworkId: "001" }, "thr_coach002", fixtureOverview.threads), "001");
  assert.equal(viewedHomework({ kind: "home" }, "thr_coach001", fixtureOverview.threads), "001");
  assert.equal(viewedHomework(null, "thr_readme", fixtureOverview.threads), null);
  assert.equal(viewedHomework(null, null, fixtureOverview.threads), null);
});

test("no coach thread yet offers to start one", () => {
  const overview: Overview = {
    ...fixtureOverview,
    current: fixtureOverview.current === null ? null : { ...fixtureOverview.current, coachThreadId: null },
    threads: [],
  };
  const rail = buildRail(input({ overview }));
  assert.deepEqual(rail.conversations, []);
  assert.equal(rail.canStartCoach, true);
  assert.equal(rail.others.flatMap((group) => group.rows).length, 6, "former Tutor threads fall back to Other threads");
});

test("a finished current homework links its progress card to the completion page", () => {
  const overview: Overview = {
    ...fixtureOverview,
    current: fixtureOverview.current === null ? null : { ...fixtureOverview.current, iterationStatus: "Done" },
  };
  const rail = buildRail(input({ overview }));
  assert.equal(rail.progress?.complete, true);
  assert.deepEqual(rail.progress?.route, { kind: "complete", homeworkId: "002" });
});

test("unbound, loading and failed states still list other threads", () => {
  const unbound = buildRail(input({ overview: fixtureOverviewUnbound }));
  assert.deepEqual(unbound.status, { kind: "unbound", missing: false });
  assert.equal(unbound.days.length, 4);
  assert.equal(unbound.progress, null);
  assert.deepEqual(unbound.features, []);
  assert.equal(unbound.canStartCoach, false);
  assert.ok(unbound.others.length > 0);

  const missing = buildRail(input({ overview: { ...fixtureOverviewUnbound, binding: { status: "missing", projectId: "prj_gone" } } }));
  assert.deepEqual(missing.status, { kind: "unbound", missing: true });

  const loading = buildRail(input({ overview: null }));
  assert.deepEqual(loading.status, { kind: "loading" });
  assert.equal(loading.brand, "Tutor");
  assert.equal(loading.others.flatMap((group) => group.rows).length, 8 - 2);

  const failed = buildRail(input({ overview: null, overviewError: "Tutor's backend is not running." }));
  assert.deepEqual(failed.status, { kind: "error", message: "Tutor's backend is not running." });

  const noCourse = buildRail(
    input({ overview: { ...fixtureOverviewUnbound, course: null, courseError: "No course at /workspaces/tutorial." } }),
  );
  assert.deepEqual(noCourse.status, { kind: "error", message: "No course at /workspaces/tutorial." });
  assert.deepEqual(noCourse.days, []);
});

test("indicators map to a small set of tones; unknown kinds draw nothing", () => {
  assert.equal(indicatorTone("runtime"), "working");
  assert.equal(indicatorTone("plan-mode"), "working");
  assert.equal(indicatorTone("waiting-for-input"), "attention");
  assert.equal(indicatorTone("unread-error"), "error");
  assert.equal(indicatorTone("queued-failed"), "error");
  assert.equal(indicatorTone("unread-success"), "unread");
  assert.equal(indicatorTone("queued-waiting"), "queued");
  assert.equal(indicatorTone("draft"), "none");
  assert.equal(indicatorTone("something-new"), "none");
  assert.deepEqual(indicatorView({ indicator: "none", indicatorLabel: "ignored" }), { tone: "none", label: null });
});
