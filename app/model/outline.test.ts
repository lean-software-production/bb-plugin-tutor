import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureBuiltinCourseOverview, fixtureCourseOverview, fixtureOverview, fixtureOverviewNoFactory } from "../../shared/fixtures.ts";
import type { Overview } from "../../shared/rpc.ts";
import { awaitingAgentSignIn, buildOutline, coachGate, viewedLesson } from "./outline.ts";
import type { LessonNode, OutlineInput, OutlineView } from "./outline.ts";
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
  thread("thr_coach002", { displayTitle: "Coach · Lesson 002", indicator: "runtime", indicatorLabel: "Working", createdAt: 10 }),
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
  thread("thr_coach001", { displayTitle: "Coach · Lesson 001", createdAt: 5 }),
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
      courseId: "software-factory",
      lessonId: "002",
      role: "sideChat",
      ruleKey: "validation/a-task-is-finished-when-validation-is-satisfied",
      title: "Side question · validation",
      coachThreadId: "thr_coach002",
      fork: true,
    },
    // BB's side chat as the backend lists it; the sidebar list may not carry hidden threads at all.
    { id: "thr_bbchat002", courseId: "software-factory", lessonId: "002", role: "sideChat", ruleKey: null, title: "the outline is…", coachThreadId: "thr_coach002", fork: true },
  ],
};

/** Every lesson of the outline, course after course. */
function lessonsOf(outline: OutlineView): LessonNode[] {
  return outline.groups.flatMap((group) => group.lessons);
}

function input(fields: Partial<OutlineInput> = {}): OutlineInput {
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
  const outline = buildOutline(input());
  assert.equal(outline.brand, "Build a software factory");
  assert.deepEqual(outline.status, { kind: "ready" });
  assert.deepEqual(
    lessonsOf(outline).map((lesson) => [lesson.id, lesson.status, lesson.count, lesson.expandedByDefault, lesson.coach?.id ?? null]),
    [
      ["000", "done", "2/2", false, null],
      ["001", "done", "0/2", false, "thr_coach001"],
      ["002", "current", "2/5", true, "thr_coach002"],
      ["003", "ahead", "0/1", false, null],
    ],
  );
  const current = lessonsOf(outline).find((lesson) => lesson.id === "002");
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
  const ahead = lessonsOf(outline).find((lesson) => lesson.id === "003");
  assert.deepEqual([ahead?.features, ahead?.sideRows, ahead?.canStartCoach, ahead?.startPath], [[], [], false, "start/software-factory/003"]);
});

test("the outline shows the built-in course first, then each course with its lessons", () => {
  const view = buildOutline(input({ overview: { ...overviewWithChat, courses: [fixtureBuiltinCourseOverview, fixtureCourseOverview] } }));
  assert.deepEqual(view.groups.map((group) => group.courseId), ["tutor", "software-factory"]);
  assert.deepEqual(view.groups.map((group) => group.lessons.map((lesson) => lesson.id)), [["000"], ["001", "002", "003"]]);
});

test("other threads keep BB usable: grouped by project, newest first, children nested, hidden ones and course threads left out", () => {
  const outline = buildOutline(input());
  assert.deepEqual(
    outline.others.map((group) => [group.name, group.rows.map((row) => [row.title, row.nested])]),
    [
      ["Personal", [["Set up pi auth", false]]],
      ["my-factory", [["Add a README for the factory", false], ["Child of README", true]]],
    ],
  );
});

test("the lesson on screen opens too: its start page, its coach thread or a side chat", () => {
  const onPage = buildOutline(input({ route: { kind: "start", courseId: "software-factory", lessonId: "003" } }));
  assert.deepEqual(
    lessonsOf(onPage).filter((lesson) => lesson.expandedByDefault).map((lesson) => lesson.id),
    ["002", "003"],
  );
  const onCoach1 = buildOutline(input({ activeThreadId: "thr_coach001" }));
  assert.equal(lessonsOf(onCoach1).find((lesson) => lesson.isViewed)?.id, "001");
  assert.equal(lessonsOf(onCoach1).find((lesson) => lesson.id === "001")?.coach?.isActive, true);
  const onSide = buildOutline(input({ activeThreadId: "thr_side002" }));
  assert.equal(lessonsOf(onSide).find((lesson) => lesson.isViewed)?.id, "002");
  assert.equal(lessonsOf(onSide).find((lesson) => lesson.id === "002")?.sideRows[0]?.isActive, true);
});

test("viewedLesson prefers the route, then the coach thread of the open thread", () => {
  const courses = fixtureOverview.courses;
  const lessons = courses.flatMap((entry) => entry.lessons.map((lesson) => ({ ...lesson, courseId: entry.course.id })));
  const one = { courseId: "software-factory", lessonId: "001" };
  assert.deepEqual(viewedLesson({ kind: "complete", courseId: "software-factory", lessonId: "001" }, "thr_coach002", lessons, liveThreads, courses), one);
  assert.deepEqual(viewedLesson({ kind: "complete", courseId: null, lessonId: "001" }, "thr_coach002", lessons, liveThreads, courses), one, "a link from before courses");
  assert.deepEqual(viewedLesson({ kind: "start", courseId: null, lessonId: "000" }, null, lessons, liveThreads, courses), { courseId: "tutor", lessonId: "000" });
  assert.deepEqual(viewedLesson({ kind: "home" }, "thr_coach001", lessons, liveThreads), one);
  assert.deepEqual(viewedLesson(null, "thr_chat002", lessons, liveThreads), { courseId: "software-factory", lessonId: "002" });
  assert.equal(viewedLesson(null, "thr_readme", lessons, liveThreads), null);
  assert.equal(viewedLesson(null, null, lessons, liveThreads), null);
});

test("no coach thread yet: the current lesson offers to start one, others link to their start page", () => {
  const overview: Overview = {
    ...fixtureOverview,
    courses: fixtureOverview.courses.map((entry) => ({ ...entry, lessons: entry.lessons.map((lesson) => ({ ...lesson, coachThreadId: null })) })),
    threads: [],
  };
  const outline = buildOutline(input({ overview }));
  const current = lessonsOf(outline).find((lesson) => lesson.id === "002");
  assert.deepEqual([current?.coach, current?.canStartCoach, current?.features, current?.sideRows], [null, true, [], []]);
  assert.equal(lessonsOf(outline).find((lesson) => lesson.id === "001")?.canStartCoach, false);
  assert.equal(outline.others.flatMap((group) => group.rows).length, 6, "former Tutor threads fall back to Other threads");
});

test("with no agent signed in, the outline says how to sign in, and the coach button waits", () => {
  const overview: Overview = {
    ...fixtureOverview,
    coachAgent: { ready: null, signIn: [{ providerId: "claude-code", name: "Claude Code", command: "claude" }] },
  };
  const outline = buildOutline(input({ overview }));
  assert.deepEqual(outline.agentNotice, { text: "Sign in to a coding agent in your Codespace's terminal, then come back: Claude Code: run `claude`." });
  assert.equal(outline.canStartCoach, false);
});

test("a coach-starting button waits, with the sign-in notice beside it, only while no agent is ready", () => {
  const signIn = [{ providerId: "claude-code", name: "Claude Code", command: "claude" }];
  assert.deepEqual(coachGate({ ready: null, signIn }), {
    canStart: false,
    notice: "Sign in to a coding agent in your Codespace's terminal, then come back: Claude Code: run `claude`.",
  });
  assert.deepEqual(coachGate({ ready: null, signIn: [{ providerId: "pi", name: "pi", command: null }] }), {
    canStart: false,
    notice: "Install and sign in to Claude Code, Codex or pi in your Codespace.",
  });
  assert.deepEqual(coachGate({ ready: "claude-code", signIn: [] }), { canStart: true, notice: null });
  assert.deepEqual(coachGate(null), { canStart: true, notice: null });
});

test("the page keeps checking for a signed-in agent only while there is a workspace and none is ready", () => {
  assert.equal(awaitingAgentSignIn({ ready: null, signIn: [] }), true);
  assert.equal(awaitingAgentSignIn({ ready: "codex", signIn: [] }), false);
  assert.equal(awaitingAgentSignIn(null), false);
});

test("a coach thread the sidebar has not listed yet still gets a row", () => {
  const outline = buildOutline(input({ threads: [] }));
  const coach = lessonsOf(outline).find((lesson) => lesson.id === "002")?.coach;
  assert.deepEqual([coach?.href, coach?.indicator.tone], ["/threads/thr_coach002", "none"]);
});

test("no workspace, loading and failed states still list other threads", () => {
  const noFactory = buildOutline(input({ overview: fixtureOverviewNoFactory }));
  assert.deepEqual(noFactory.status, { kind: "unset", missing: false });
  assert.equal(lessonsOf(noFactory).length, 4);
  assert.ok(lessonsOf(noFactory).every((lesson) => lesson.coach === null && !lesson.canStartCoach && !lesson.expandedByDefault));
  assert.ok(noFactory.others.length > 0);

  const missing = buildOutline(input({ overview: { ...fixtureOverviewNoFactory, workspace: { status: "missing", projectId: "prj_gone" } } }));
  assert.deepEqual(missing.status, { kind: "unset", missing: true });

  const unreachable = buildOutline(
    input({ overview: { ...fixtureOverviewNoFactory, workspace: { status: "unreachable", projectId: "prj_1", projectName: "repo" } } }),
  );
  assert.deepEqual(unreachable.status, { kind: "unreachable", message: "Your Codespace is asleep or stopped. Open it and Tutor reconnects by itself." });
  assert.equal(lessonsOf(unreachable).length, 4, "the lessons are still there to read");

  const loading = buildOutline(input({ overview: null }));
  assert.deepEqual(loading.status, { kind: "loading" });
  assert.equal(loading.brand, "Tutor");
  assert.equal(loading.others.flatMap((group) => group.rows).length, 6);

  const failed = buildOutline(input({ overview: null, overviewError: "Tutor's backend is not running." }));
  assert.deepEqual(failed.status, { kind: "error", message: "Tutor's backend is not running." });

  const noCourse = buildOutline(
    input({ overview: { ...fixtureOverviewNoFactory, courses: [], courseErrors: [{ source: "/workspaces/tutorial", error: "No course at /workspaces/tutorial." }] } }),
  );
  assert.deepEqual(noCourse.status, { kind: "error", message: "No course at /workspaces/tutorial." });
  assert.deepEqual(lessonsOf(noCourse), []);

  // The built-in course loads while the configured one does not: its lessons show, and the error is said beside them.
  const builtinOnly = buildOutline(
    input({ overview: { ...fixtureOverview, courses: [fixtureBuiltinCourseOverview], courseErrors: [{ source: "/workspaces/tutorial", error: "No course at /workspaces/tutorial." }] } }),
  );
  assert.deepEqual(builtinOnly.status, { kind: "ready" });
  assert.deepEqual(lessonsOf(builtinOnly).map((lesson) => lesson.id), ["000"]);
  assert.deepEqual(builtinOnly.errors, ["No course at /workspaces/tutorial."]);
  assert.equal(builtinOnly.brand, "Tutor");
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

test("only the course the student is on opens its current lesson: Lesson 0 until it is done", () => {
  const onZero: Overview = {
    ...fixtureOverview,
    courses: fixtureOverview.courses.map((entry) =>
      entry.builtin
        ? { ...entry, lessons: entry.lessons.map((lesson) => ({ ...lesson, status: "current" as const })), current: entry.current === null ? null : { ...entry.current, iterationStatus: "WIP" as const } }
        : {
            ...entry,
            lessons: entry.lessons.map((lesson) => ({ ...lesson, status: "ahead" as const, coachThreadId: null })),
            current: entry.current === null ? null : { ...entry.current, lessonId: "001", iterationStatus: "not-started" as const },
          },
    ),
    threads: [],
  };
  const outline = buildOutline(input({ overview: onZero }));
  assert.deepEqual(lessonsOf(outline).filter((lesson) => lesson.expandedByDefault).map((lesson) => [lesson.courseId, lesson.id]), [["tutor", "000"]]);
});

test("a Codespace on a capstone lesson with no Lesson 0 record opens that lesson in the outline", () => {
  const onThree: Overview = {
    ...fixtureOverview,
    courses: fixtureOverview.courses.map((entry) =>
      entry.builtin
        ? { ...entry, lessons: entry.lessons.map((lesson) => ({ ...lesson, status: "current" as const })), current: entry.current === null ? null : { ...entry.current, iterationStatus: "not-started" as const } }
        : {
            ...entry,
            lessons: entry.lessons.map((lesson) => ({ ...lesson, status: lesson.id === "003" ? ("current" as const) : ("done" as const) })),
            current: entry.current === null ? null : { ...entry.current, lessonId: "003", iterationStatus: "WIP" as const },
          },
    ),
  };
  const outline = buildOutline(input({ overview: onThree }));
  assert.deepEqual(lessonsOf(outline).filter((lesson) => lesson.expandedByDefault).map((lesson) => [lesson.courseId, lesson.id]), [["software-factory", "003"]]);
});

test("the outline offers each course that can be added, catalog entries not fetched yet", () => {
  const outline = buildOutline(
    input({
      overview: { ...overviewWithChat, available: [{ id: "robotics", title: "Build a robot", description: "Six lessons, one robot.", unfinished: false }] },
    }),
  );
  assert.deepEqual(outline.addCourses, [
    { courseId: "robotics", title: "Build a robot", description: "Six lessons, one robot.", action: "Add the course" },
  ]);
});

test("a course whose adding was interrupted is still offered, as Finish adding the course", () => {
  const outline = buildOutline(
    input({
      overview: { ...overviewWithChat, available: [{ id: "robotics", title: "Build a robot", description: "Six lessons, one robot.", unfinished: true }] },
    }),
  );
  assert.deepEqual(outline.addCourses.map((row) => row.action), ["Finish adding the course"]);
});

test("once a course is fetched, it has no Add row: available is empty while it is being taught", () => {
  const outline = buildOutline(input());
  assert.deepEqual(outline.addCourses, [], "fixtureOverview's available list is empty: software-factory is already a course");
});

test("a course not started yet offers no coach in the outline: its lessons are ahead", () => {
  const outline = buildOutline(input({ overview: fixtureOverviewNoFactory }));
  assert.ok(lessonsOf(outline).every((lesson) => !lesson.canStartCoach));
  assert.deepEqual(
    fixtureOverviewNoFactory.courses.flatMap((entry) => entry.lessons.map((lesson) => [lesson.id, lesson.status])),
    [["000", "current"], ["001", "ahead"], ["002", "ahead"], ["003", "ahead"]],
  );
});
