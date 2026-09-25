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
    sourceThreadId: null,
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
  // Tutor's side chat (in the overview's threads) and one BB's "Reply in side chat" made: hidden forks.
  thread("thr_chat002", {
    displayTitle: "Side question · validation",
    parentThreadId: "thr_coach002",
    sourceThreadId: "thr_coach002",
    isHidden: true,
    createdAt: 30,
  }),
  thread("thr_bbchat002", {
    displayTitle: "Replying to this earlier message…",
    parentThreadId: "thr_coach002",
    sourceThreadId: "thr_coach002",
    isHidden: true,
    createdAt: 25,
  }),
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

const overviewWithChat: Overview = {
  ...fixtureOverview,
  threads: [
    ...fixtureOverview.threads,
    {
      id: "thr_chat002",
      homeworkId: "002",
      role: "side",
      ruleKey: "validation/a-task-is-finished-when-validation-is-satisfied",
      title: "Side question · validation",
      mainThreadId: "thr_coach002",
    },
  ],
};

function input(fields: Partial<RailInput> = {}): RailInput {
  return {
    overview: overviewWithChat,
    overviewError: null,
    threads: liveThreads,
    projects,
    activeThreadId: null,
    route: null,
    ...fields,
  };
}

test("one tree: every lesson, the current one open, with its coach thread, Rules and side chats", () => {
  const rail = buildRail(input());
  assert.equal(rail.brand, "Build a software factory");
  assert.deepEqual(rail.status, { kind: "ready" });
  assert.deepEqual(
    rail.lessons.map((lesson) => [lesson.id, lesson.status, lesson.count, lesson.expandedByDefault, lesson.coach?.id ?? null]),
    [
      ["000", "done", "0/2", false, null],
      ["001", "done", "0/2", false, "thr_coach001"],
      ["002", "current", "2/5", true, "thr_coach002"],
      ["003", "ahead", "0/1", false, null],
    ],
  );
  const current = rail.lessons.find((lesson) => lesson.id === "002");
  assert.ok(current !== undefined);
  assert.equal(current.percent, 40);
  assert.deepEqual([current.coach?.kind, current.coach?.indicator.tone, current.canStartCoach], ["coach", "working", false]);
  assert.deepEqual(
    current.features.map((feature) => [feature.name, feature.rules.map((rule) => [rule.glyph, rule.reached])]),
    [
      ["Planning", [["pending", false]]],
      [
        "Validation",
        [
          ["focus", true],
          ["pending", false],
        ],
      ],
    ],
    "only the Rule the coach has reached can be jumped to",
  );
  assert.deepEqual(
    current.sideRows.map((row) => [row.id, row.kind, row.caption, row.href]),
    [
      ["thr_side002", "side-thread", "from: A task is finished when validation is satisfied", "/projects/prj_factory/threads/thr_side002"],
      ["thr_bbchat002", "side-chat", null, "/threads/thr_coach002"],
      ["thr_chat002", "side-chat", "from: A task is finished when validation is satisfied", "/threads/thr_coach002"],
    ],
  );
  const ahead = rail.lessons.find((lesson) => lesson.id === "003");
  assert.deepEqual([ahead?.features, ahead?.sideRows, ahead?.canStartCoach, ahead?.startPath], [[], [], false, "lesson/003"]);
});

test("other threads keep BB usable: grouped by project, newest first, children nested, hidden ones and course threads left out", () => {
  const rail = buildRail(input());
  assert.deepEqual(
    rail.others.map((group) => [group.name, group.rows.map((row) => [row.title, row.nested])]),
    [
      ["Personal", [["Set up pi auth", false]]],
      ["my-factory", [["Add a README for the factory", false], ["Child of README", true]]],
    ],
  );
});

test("the lesson on screen opens too: its start page, its coach thread or a side thread", () => {
  const onPage = buildRail(input({ route: { kind: "lesson", homeworkId: "003" } }));
  assert.deepEqual(
    onPage.lessons.filter((lesson) => lesson.expandedByDefault).map((lesson) => lesson.id),
    ["002", "003"],
  );
  const onCoach1 = buildRail(input({ activeThreadId: "thr_coach001" }));
  assert.equal(onCoach1.lessons.find((lesson) => lesson.isViewed)?.id, "001");
  assert.equal(onCoach1.lessons.find((lesson) => lesson.id === "001")?.coach?.isActive, true);
  const onSide = buildRail(input({ activeThreadId: "thr_side002" }));
  assert.equal(onSide.lessons.find((lesson) => lesson.isViewed)?.id, "002");
  assert.equal(onSide.lessons.find((lesson) => lesson.id === "002")?.sideRows[0]?.isActive, true);
});

test("viewedHomework prefers the route, then the coach thread of the open thread", () => {
  const lessons = fixtureOverview.homeworks;
  assert.equal(viewedHomework({ kind: "complete", homeworkId: "001" }, "thr_coach002", lessons, liveThreads), "001");
  assert.equal(viewedHomework({ kind: "home" }, "thr_coach001", lessons, liveThreads), "001");
  assert.equal(viewedHomework(null, "thr_chat002", lessons, liveThreads), "002");
  assert.equal(viewedHomework(null, "thr_readme", lessons, liveThreads), null);
  assert.equal(viewedHomework(null, null, lessons, liveThreads), null);
});

test("no coach thread yet: the current lesson offers to start one, others link to their start page", () => {
  const overview: Overview = {
    ...fixtureOverview,
    homeworks: fixtureOverview.homeworks.map((lesson) => ({ ...lesson, coachThreadId: null })),
    threads: [],
  };
  const rail = buildRail(input({ overview }));
  const current = rail.lessons.find((lesson) => lesson.id === "002");
  assert.deepEqual([current?.coach, current?.canStartCoach, current?.features, current?.sideRows], [null, true, [], []]);
  assert.equal(rail.lessons.find((lesson) => lesson.id === "001")?.canStartCoach, false);
  assert.equal(rail.others.flatMap((group) => group.rows).length, 6, "former Tutor threads fall back to Other threads");
});

test("a coach thread the sidebar has not listed yet still gets a row", () => {
  const rail = buildRail(input({ threads: [] }));
  const coach = rail.lessons.find((lesson) => lesson.id === "002")?.coach;
  assert.deepEqual([coach?.href, coach?.indicator.tone], ["/threads/thr_coach002", "none"]);
});

test("unbound, loading and failed states still list other threads", () => {
  const unbound = buildRail(input({ overview: fixtureOverviewUnbound }));
  assert.deepEqual(unbound.status, { kind: "unbound", missing: false });
  assert.equal(unbound.lessons.length, 4);
  assert.ok(unbound.lessons.every((lesson) => lesson.coach === null && !lesson.canStartCoach && !lesson.expandedByDefault));
  assert.ok(unbound.others.length > 0);

  const missing = buildRail(input({ overview: { ...fixtureOverviewUnbound, binding: { status: "missing", projectId: "prj_gone" } } }));
  assert.deepEqual(missing.status, { kind: "unbound", missing: true });

  const loading = buildRail(input({ overview: null }));
  assert.deepEqual(loading.status, { kind: "loading" });
  assert.equal(loading.brand, "Tutor");
  assert.equal(loading.others.flatMap((group) => group.rows).length, 6);

  const failed = buildRail(input({ overview: null, overviewError: "Tutor's backend is not running." }));
  assert.deepEqual(failed.status, { kind: "error", message: "Tutor's backend is not running." });

  const noCourse = buildRail(
    input({ overview: { ...fixtureOverviewUnbound, course: null, courseError: "No course at /workspaces/tutorial." } }),
  );
  assert.deepEqual(noCourse.status, { kind: "error", message: "No course at /workspaces/tutorial." });
  assert.deepEqual(noCourse.lessons, []);
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
