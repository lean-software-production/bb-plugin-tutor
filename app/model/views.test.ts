import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgressCard, parseTermRef } from "../../shared/directives.ts";
import {
  FIXTURE_NOW,
  fixtureWorkspace,
  fixtureCandidates,
  fixtureCompletion,
  fixtureLessonDetail,
  fixtureLexicon,
  fixtureCourseOverview,
  fixtureOverview,
  fixtureOverviewNoFactory,
  fixtureThreads,
} from "../../shared/fixtures.ts";
import type { CourseOverview, Overview } from "../../shared/rpc.ts";
import { CARD_KIT_TONES, progressCardView, termView } from "./cards.ts";
import { completionView, doneRibbon, whatsNext } from "./completion.ts";
import { activeCourse, continueView, doneLessonsLabel, homeDecision } from "./home.ts";
import { parseRuleTabParams, ruleTabTarget, ruleTabView } from "./rule-tab.ts";
import { welcomeView } from "./welcome.ts";

const NOW = Date.parse(FIXTURE_NOW);
const FOCUS = "validation/a-task-is-finished-when-validation-is-satisfied";

// ---------------------------------------------------------------------------
// Directive cards (3A). Attributes are untrusted: they reach the view only
// through shared/directives.ts.
// ---------------------------------------------------------------------------

test("a passing Rule card shows the tally, the next Rule and a way into the Rule tab", () => {
  const card = parseProgressCard({
    kind: "rule-passing",
    title: "The factory accepts an assembly line it can run",
    passed: "30",
    total: "41",
    next: "The factory refuses an assembly line naming a machine it does not have",
    lesson: "003",
    rule: "assembly-line/the-factory-accepts-an-assembly-line-it-can-run",
  });
  assert.ok(card !== null);
  assert.deepEqual(progressCardView(card), {
    kind: "rule-passing",
    tone: "green",
    kitTone: "forest",
    mark: "✓",
    eyebrow: "Rule passing",
    title: "The factory accepts an assembly line it can run",
    ring: "30/41",
    next: "The factory refuses an assembly line naming a machine it does not have",
    note: null,
    rule: { lessonId: "003", ruleKey: "assembly-line/the-factory-accepts-an-assembly-line-it-can-run" },
    completedLessonId: null,
  });
});

test("a not-yet card finds its Rule from the Example key and drops what did not validate", () => {
  const card = parseProgressCard({
    kind: "not-yet",
    title: "A misspelt validator",
    note: "Crashed in the doer loop.",
    passed: "31",
    total: "30",
    next: "ignored for not-yet",
    lesson: "3",
    example: "assembly-line/refuses-unknown/a-misspelt-validator",
  });
  assert.ok(card !== null);
  const view = progressCardView(card);
  assert.equal(view.tone, "amber");
  assert.equal(view.kitTone, "coral");
  assert.equal(view.ring, null, "passed > total is not shown");
  assert.equal(view.next, null);
  assert.equal(view.note, "Crashed in the doer loop.");
  assert.equal(view.rule, null, "a malformed lesson id leaves no Rule link");

  const linked = parseProgressCard({ kind: "not-yet", title: "x", lesson: "003", example: "a/b/c" });
  assert.deepEqual(linked === null ? null : progressCardView(linked).rule, { lessonId: "003", ruleKey: "a/b" });
});

test("a lesson-complete card links to the completion page, focus cards are blue", () => {
  const done = parseProgressCard({ kind: "lesson-complete", title: "The assembly line", lesson: "003", rule: "a/b" });
  assert.ok(done !== null);
  const view = progressCardView(done);
  assert.deepEqual([view.eyebrow, view.completedLessonId, view.rule], ["Lesson 3 complete", "003", null]);
  const focus = parseProgressCard({ kind: "focus", title: "Refuses an unknown machine" });
  assert.deepEqual(focus === null ? null : [progressCardView(focus).tone, progressCardView(focus).mark], ["blue", "●"]);
  assert.equal(focus === null ? null : progressCardView(focus).kitTone, "blue");
});

test("card tones map to the kit's accents in one place", () => {
  assert.deepEqual(CARD_KIT_TONES, { green: "forest", amber: "coral", blue: "blue" });
});

test("unusable directives parse to null so the source text shows instead", () => {
  assert.equal(parseProgressCard({ kind: "rule-passing" }), null);
  assert.equal(parseProgressCard({ kind: "celebrate", title: "x" }), null);
  assert.equal(parseTermRef({ id: "Not A Slug" }), null);
});

test("terms resolve against the lexicon; unknown ids fall back", () => {
  const doer = parseTermRef({ id: "doer" });
  assert.ok(doer !== null);
  assert.deepEqual(termView(doer, fixtureLexicon), { label: "Doer", entry: fixtureLexicon[0] });
  const plural = parseTermRef({ id: "doer", label: "doers" });
  assert.equal(plural === null ? null : termView(plural, fixtureLexicon)?.label, "doers");
  const unknown = parseTermRef({ id: "flux-capacitor" });
  assert.equal(unknown === null ? "unparsed" : termView(unknown, fixtureLexicon), null);
});

// ---------------------------------------------------------------------------
// Course root redirect and the BB home "Continue" section (5).
// ---------------------------------------------------------------------------

/** fixtureOverview with each course changed by `change`. */
function eachCourse(change: (entry: CourseOverview) => CourseOverview): Overview {
  return { ...fixtureOverview, courses: fixtureOverview.courses.map(change) };
}

test("the course root sends the student where they are: a course under way, else Lesson 0", () => {
  assert.deepEqual(homeDecision(fixtureOverview), { kind: "redirect", route: { kind: "start", courseId: "software-factory", lessonId: "002" } });
  assert.deepEqual(homeDecision(fixtureOverviewNoFactory), { kind: "redirect", route: { kind: "welcome" } });
  // A workspace whose machine is not connected is not one to set up again.
  const unreachable = { ...fixtureOverviewNoFactory, workspace: { status: "unreachable" as const, projectId: "prj_1", projectName: "repo" } };
  assert.deepEqual(homeDecision(unreachable), { kind: "error", message: "Tutor can't reach your computer's machine right now. Run `tutor status`." });
  assert.deepEqual(continueView(unreachable), { kind: "error", message: "Tutor can't reach your computer's machine right now. Run `tutor status`." });
  const done = eachCourse((entry) => (entry.builtin || entry.current === null ? entry : { ...entry, current: { ...entry.current, iterationStatus: "Done" } }));
  assert.deepEqual(homeDecision(done), { kind: "redirect", route: { kind: "complete", courseId: "software-factory", lessonId: "002" } });
  const onZero = eachCourse((entry) =>
    entry.current === null
      ? entry
      : entry.builtin
        ? { ...entry, lessons: entry.lessons.map((lesson) => ({ ...lesson, status: "current" as const })), current: { ...entry.current, iterationStatus: "WIP" } }
        : { ...entry, lessons: entry.lessons.map((lesson) => ({ ...lesson, status: "ahead" as const })), current: { ...entry.current, lessonId: "001", iterationStatus: "not-started" } },
  );
  assert.deepEqual(homeDecision(onZero), { kind: "redirect", route: { kind: "start", courseId: "tutor", lessonId: "000" } });
  const alone: Overview = { ...fixtureOverview, courses: fixtureOverview.courses.filter((entry) => entry.builtin) };
  assert.deepEqual(homeDecision(alone), { kind: "redirect", route: { kind: "complete", courseId: "tutor", lessonId: "000" } }, "Lesson 0 done, and no other course");
  assert.deepEqual(homeDecision({ ...fixtureOverview, courses: [], courseErrors: [{ source: "/x", error: "No course.yaml or ledger." }] }), {
    kind: "error",
    message: "No course.yaml or ledger.",
  });
  assert.deepEqual(homeDecision({ ...fixtureOverview, courses: [] }), {
    kind: "error",
    message: "We couldn't load the course.",
  });
  // A course with no current state yet hasn't started: the active course is Lesson 0's.
  assert.deepEqual(homeDecision(eachCourse((entry) => (entry.builtin ? entry : { ...entry, current: null }))), {
    kind: "redirect",
    route: { kind: "complete", courseId: "tutor", lessonId: "000" },
  });
  // Only another course, with no current state: its first lesson.
  assert.deepEqual(homeDecision({ ...fixtureOverview, courses: [{ ...fixtureCourseOverview, current: null }] }), {
    kind: "redirect",
    route: { kind: "start", courseId: "software-factory", lessonId: "001" },
  });
});

/** A Codespace on capstone lesson 003 (WIP) with no Lesson 0 record: it adopted 001 directly, or predates Lesson 0. */
function onThreeWithoutLesson0(): Overview {
  return eachCourse((entry) => {
    if (entry.builtin) {
      return { ...entry, lessons: entry.lessons.map((lesson) => ({ ...lesson, status: "current" as const, counts: { ...lesson.counts, passing: 0 } })), current: entry.current === null ? null : { ...entry.current, iterationStatus: "not-started" } };
    }
    return {
      ...entry,
      lessons: entry.lessons.map((lesson) => ({ ...lesson, status: lesson.id === "003" ? ("current" as const) : ("done" as const) })),
      current: entry.current === null ? null : { ...entry.current, lessonId: "003", iterationStatus: "WIP" },
    };
  });
}

test("a Codespace on a capstone lesson with no Lesson 0 record goes to that lesson, not to Lesson 0", () => {
  const overview = onThreeWithoutLesson0();
  assert.equal(activeCourse(overview)?.course.id, "software-factory");
  assert.deepEqual(homeDecision(overview), { kind: "redirect", route: { kind: "start", courseId: "software-factory", lessonId: "003" } });
  const view = continueView(overview);
  assert.deepEqual(view.kind === "continue" ? [view.courseId, view.lessonId] : view.kind, ["software-factory", "003"]);
});

test("Lesson 0 done and the next course not started: home stays on Lesson 0's completion, which starts the course", () => {
  const overview = eachCourse((entry) =>
    entry.builtin
      ? entry
      : { ...entry, lessons: entry.lessons.map((lesson) => ({ ...lesson, status: "ahead" as const, coachThreadId: null })), current: entry.current === null ? null : { ...entry.current, lessonId: "001", iterationStatus: "not-started" } },
  );
  assert.equal(activeCourse(overview)?.course.id, "tutor");
  assert.deepEqual(homeDecision(overview), { kind: "redirect", route: { kind: "complete", courseId: "tutor", lessonId: "000" } });
});

test("the Continue section reads from the overview alone", () => {
  const view = continueView(fixtureOverview);
  assert.equal(view.kind, "continue");
  if (view.kind !== "continue") return;
  assert.equal(view.eyebrow, "Continue · Lesson 2 · Day 2");
  assert.equal(view.title, "Checking the work");
  assert.equal(view.focusRuleName, "A task is finished when validation is satisfied");
  assert.equal(view.lastNote?.exampleName, "The work is wrong first time");
  assert.deepEqual([view.passing, view.total, view.percent], [2, 5, 40]);
  assert.deepEqual([view.freshRules, view.freshRulesPassing], [3, 0]);
  assert.equal(view.doneLabel, "Lesson 1 done ✓");
  assert.equal(view.coachThreadId, "thr_coach002");
  assert.equal(view.complete, false);

  assert.deepEqual(continueView(fixtureOverviewNoFactory), {
    kind: "setup",
    courseTitle: "Build a software factory",
    missing: false,
  });
  assert.equal(continueView({ ...fixtureOverview, courses: [] }).kind, "error");
});

test("after Lesson 0, BB home's Continue suggests adding the course when nothing has been fetched", () => {
  const onlyBuiltin: Overview = {
    ...fixtureOverview,
    courses: fixtureOverview.courses.filter((entry) => entry.builtin),
    available: [{ id: "robotics", title: "Build a robot", description: "Six lessons, one robot." }],
  };
  assert.deepEqual(continueView(onlyBuiltin), {
    kind: "add-course",
    courseId: "robotics",
    title: "Build a robot",
    description: "Six lessons, one robot.",
  });
  // A configured course wins (Decision 12): available stays empty, so today's behaviour holds (Lesson 0's own completion).
  assert.deepEqual(continueView({ ...onlyBuiltin, available: [] }).kind, "continue");
});

test("done lessons read as a range", () => {
  assert.equal(doneLessonsLabel([]), null);
  assert.equal(doneLessonsLabel(["002", "001"]), "Lessons 1–2 done ✓");
  assert.equal(doneLessonsLabel(["001", "003"]), "Lessons 1, 3 done ✓");
});

// ---------------------------------------------------------------------------
// Between lessons (7) and first run (8).
// ---------------------------------------------------------------------------

test("the completion page recaps the lesson and introduces the next", () => {
  const view = completionView(fixtureCompletion, NOW);
  assert.equal(view.eyebrow, "Lesson 1 complete");
  assert.deepEqual(view.stats, [
    { value: "2/2", label: "Examples hold" },
    { value: "1", label: "new or reworded Rule" },
    { value: "0", label: "side chats" },
    { value: "3 days", label: "since adopted" },
  ]);
  assert.equal(view.summary, fixtureCompletion.summary);
  assert.equal(view.next?.eyebrow, "Lesson 2 · Set after day 2");
  assert.deepEqual(view.next?.chips, [
    { text: "3 Rules · 5 Examples", tone: "plain" },
    { text: "1 already passing", tone: "green" },
    { text: "4 new or reworded", tone: "amber" },
  ]);
  assert.equal(view.next?.diff?.title, "FACTORY.md — what changed since lesson 1");
  assert.equal(view.next?.started, false);
  assert.equal(view.next?.startLabel, "Start lesson 2 with your coach →");
  assert.equal(view.next?.startPath, "start/software-factory/002");

  const sameDay = completionView(
    {
      ...fixtureCompletion,
      lesson: { ...fixtureCompletion.lesson, set: "Day 3" },
      adoptedAt: null,
      next: fixtureCompletion.next === null ? null : { ...fixtureCompletion.next, set: "Day 3", factoryDiff: null },
    },
    NOW,
  );
  assert.equal(sameDay.next?.eyebrow, "Lesson 2 · Also set after day 3");
  assert.equal(sameDay.next?.diff, null);
  assert.equal(sameDay.stats.length, 3, "no adoption date, no 'since adopted'");
  assert.equal(completionView({ ...fixtureCompletion, next: null }, NOW).next, null);
});

test("the lesson-complete ribbon names the lesson and its tally", () => {
  assert.deepEqual(doneRibbon("001", fixtureCompletion.counts), { kicker: "Lesson 1 done.", line: "All 2 Examples hold." });
  assert.deepEqual(doneRibbon("001", { ...fixtureCompletion.counts, passing: 1 }), {
    kicker: "Lesson 1 done.",
    line: "1 of 2 Examples hold.",
  });
  assert.deepEqual(doneRibbon("001", null), { kicker: "Lesson 1 done.", line: null }, "no stats yet: no tally");
});

test("What's next names the next lesson, or the end of the course", () => {
  assert.deepEqual(whatsNext(completionView(fixtureCompletion, NOW)), { label: "What's next →", detail: "Lesson 2 · Checking the work" });
  assert.deepEqual(whatsNext(completionView({ ...fixtureCompletion, next: null }, NOW)), {
    label: "What's next →",
    detail: "That was the last lesson",
  });
  assert.deepEqual(whatsNext(null), { label: "What's next →", detail: null });
});

test("once the next lesson has started, the completion page continues it", () => {
  const next = fixtureCompletion.next;
  assert.ok(next !== null);
  const view = completionView({ ...fixtureCompletion, next: { ...next, status: "current" } }, NOW);
  assert.equal(view.next?.started, true);
  assert.equal(view.next?.startLabel, "Continue lesson 2 with your coach →");
});

test("first run confirms a detected factory, or explains how to set one up", () => {
  const view = welcomeView(fixtureCandidates, { status: "unset" });
  assert.equal(view.mode, "confirm");
  assert.equal(view.preselected, "prj_factory");
  assert.deepEqual(view.others.map((project) => project.name), ["tutorial"]);
  assert.equal(view.missingProjectId, null);

  const none = welcomeView(fixtureCandidates.filter((project) => !project.qualifies), { status: "missing", projectId: "prj_gone" });
  assert.equal(none.mode, "setup");
  assert.equal(none.preselected, null);
  assert.equal(none.missingProjectId, "prj_gone");
  assert.equal(welcomeView([], fixtureWorkspace).mode, "setup");
});

// ---------------------------------------------------------------------------
// Rule tab (4).
// ---------------------------------------------------------------------------

test("rule tab params are validated field by field", () => {
  assert.deepEqual(parseRuleTabParams({ courseId: "software-factory", lessonId: "002", ruleKey: FOCUS }), { courseId: "software-factory", lessonId: "002", ruleKey: FOCUS });
  assert.deepEqual(parseRuleTabParams({ lessonId: "002", ruleKey: FOCUS }), { courseId: null, lessonId: "002", ruleKey: FOCUS }, "a tab from before courses");
  assert.deepEqual(parseRuleTabParams({ courseId: "x".repeat(65), lessonId: "2", ruleKey: "../etc" }), { courseId: null, lessonId: null, ruleKey: null });
  assert.deepEqual(parseRuleTabParams(["002"]), { courseId: null, lessonId: null, ruleKey: null });
  assert.deepEqual(parseRuleTabParams(null), { courseId: null, lessonId: null, ruleKey: null });
});

test("the rule tab targets explicit params, else the thread's own lesson and Rule", () => {
  const side = fixtureThreads[1] ?? null;
  const coach = fixtureThreads[0] ?? null;
  const none = { courseId: null, lessonId: null, ruleKey: null };
  assert.deepEqual(ruleTabTarget(none, side), { courseId: "software-factory", lessonId: "002", ruleKey: FOCUS });
  assert.deepEqual(ruleTabTarget(none, coach), { courseId: "software-factory", lessonId: "002", ruleKey: null });
  assert.deepEqual(ruleTabTarget({ ...none, lessonId: "001" }, side), { courseId: null, lessonId: "001", ruleKey: null }, "another lesson's course isn't the thread's to say");
  assert.deepEqual(ruleTabTarget({ courseId: "software-factory", lessonId: "001", ruleKey: null }, side), { courseId: "software-factory", lessonId: "001", ruleKey: null });
  assert.equal(ruleTabTarget(none, null), null);
});

test("the rule tab shows the Rule and its Examples", () => {
  const view = ruleTabView(fixtureLessonDetail, { courseId: "software-factory", lessonId: "002", ruleKey: null }, false);
  assert.equal(view.kind, "rule");
  if (view.kind !== "rule") return;
  assert.equal(view.eyebrow, "Rule in focus · Validation");
  assert.equal(view.title, "A task is finished when validation is satisfied");
  assert.deepEqual([view.passing, view.total, view.percent], [1, 2, 50]);
  assert.deepEqual(
    view.examples.map((example) => example.detail),
    ["Passing", "Not yet — Crashed in the doer loop instead of retrying when the validator said no."],
  );
  assert.equal(view.startPath, "start/software-factory/002");
  const keys = fixtureLessonDetail.lesson.features.flatMap((feature) => feature.rules.map((rule) => rule.key));
  assert.equal(view.number, keys.indexOf(FOCUS) + 1, "the Rule's number across the lesson, for its step badge");

  const spun = ruleTabView(fixtureLessonDetail, { courseId: "software-factory", lessonId: "002", ruleKey: "planning/the-planner-writes-a-plan" }, true);
  assert.equal(spun.kind === "rule" ? spun.eyebrow : null, "Spun off from · Planning");
  assert.equal(spun.kind === "rule" ? spun.examples[0]?.detail : null, "Passing · carried over");
  assert.equal(spun.kind === "rule" ? spun.number : null, 1);
  assert.deepEqual(ruleTabView({ ...fixtureLessonDetail, focus: null }, { courseId: "software-factory", lessonId: "002", ruleKey: null }, false), {
    kind: "no-rule",
    startPath: "start/software-factory/002",
  });
});
