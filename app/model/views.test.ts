import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgressCard, parseTermRef } from "../../shared/directives.ts";
import {
  FIXTURE_NOW,
  fixtureBinding,
  fixtureCandidates,
  fixtureCompletion,
  fixtureLesson,
  fixtureLexicon,
  fixtureOverview,
  fixtureOverviewUnbound,
  fixtureThreads,
} from "../../shared/fixtures.ts";
import type { Overview } from "../../shared/rpc.ts";
import { progressCardView, termView } from "./cards.ts";
import { completionView, confettiPieces } from "./completion.ts";
import { continueView, doneHomeworksLabel, homeDecision } from "./home.ts";
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
    homework: "003",
    rule: "assembly-line/the-factory-accepts-an-assembly-line-it-can-run",
  });
  assert.ok(card !== null);
  assert.deepEqual(progressCardView(card), {
    kind: "rule-passing",
    tone: "green",
    mark: "✓",
    eyebrow: "Rule passing",
    title: "The factory accepts an assembly line it can run",
    ring: "30/41",
    next: "The factory refuses an assembly line naming a machine it does not have",
    note: null,
    rule: { homeworkId: "003", ruleKey: "assembly-line/the-factory-accepts-an-assembly-line-it-can-run" },
    completedHomeworkId: null,
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
    homework: "3",
    example: "assembly-line/refuses-unknown/a-misspelt-validator",
  });
  assert.ok(card !== null);
  const view = progressCardView(card);
  assert.equal(view.tone, "amber");
  assert.equal(view.ring, null, "passed > total is not shown");
  assert.equal(view.next, null);
  assert.equal(view.note, "Crashed in the doer loop.");
  assert.equal(view.rule, null, "a malformed homework id leaves no Rule link");

  const linked = parseProgressCard({ kind: "not-yet", title: "x", homework: "003", example: "a/b/c" });
  assert.deepEqual(linked === null ? null : progressCardView(linked).rule, { homeworkId: "003", ruleKey: "a/b" });
});

test("a homework-complete card links to the completion page, focus cards are blue", () => {
  const done = parseProgressCard({ kind: "homework-complete", title: "The assembly line", homework: "003", rule: "a/b" });
  assert.ok(done !== null);
  const view = progressCardView(done);
  assert.deepEqual([view.eyebrow, view.completedHomeworkId, view.rule], ["Homework 3 complete", "003", null]);
  const focus = parseProgressCard({ kind: "focus", title: "Refuses an unknown machine" });
  assert.deepEqual(focus === null ? null : [progressCardView(focus).tone, progressCardView(focus).mark], ["blue", "●"]);
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

test("the course root sends the student where they are", () => {
  assert.deepEqual(homeDecision(fixtureOverview), { kind: "redirect", route: { kind: "lesson", homeworkId: "002" } });
  assert.deepEqual(homeDecision(fixtureOverviewUnbound), { kind: "redirect", route: { kind: "welcome" } });
  const done: Overview = {
    ...fixtureOverview,
    current: fixtureOverview.current === null ? null : { ...fixtureOverview.current, iterationStatus: "Done" },
  };
  assert.deepEqual(homeDecision(done), { kind: "redirect", route: { kind: "complete", homeworkId: "002" } });
  assert.deepEqual(homeDecision({ ...fixtureOverview, course: null, courseError: "No course.yaml or ledger." }), {
    kind: "error",
    message: "No course.yaml or ledger.",
  });
  assert.deepEqual(homeDecision({ ...fixtureOverview, current: null }), {
    kind: "redirect",
    route: { kind: "lesson", homeworkId: "000" },
  });
});

test("the Continue section reads from the overview alone", () => {
  const view = continueView(fixtureOverview);
  assert.equal(view.kind, "continue");
  if (view.kind !== "continue") return;
  assert.equal(view.eyebrow, "Continue · Homework 2 · Day 2");
  assert.equal(view.title, "Checking the work");
  assert.equal(view.focusRuleName, "A task is finished when validation is satisfied");
  assert.equal(view.lastNote?.exampleName, "The work is wrong first time");
  assert.deepEqual([view.passing, view.total, view.percent], [2, 5, 40]);
  assert.deepEqual([view.freshRules, view.freshRulesPassing], [3, 0]);
  assert.equal(view.doneLabel, "Homework 1 done ✓");
  assert.equal(view.coachThreadId, "thr_coach002");
  assert.equal(view.complete, false);

  assert.deepEqual(continueView(fixtureOverviewUnbound), {
    kind: "setup",
    courseTitle: "Build a software factory",
    missing: false,
  });
  assert.equal(continueView({ ...fixtureOverview, course: null, courseError: null }).kind, "error");
});

test("done homeworks read as a range", () => {
  assert.equal(doneHomeworksLabel([]), null);
  assert.equal(doneHomeworksLabel(["002", "001"]), "Homeworks 1–2 done ✓");
  assert.equal(doneHomeworksLabel(["001", "003"]), "Homeworks 1, 3 done ✓");
});

// ---------------------------------------------------------------------------
// Between homeworks (7) and first run (8).
// ---------------------------------------------------------------------------

test("the completion page recaps the homework and introduces the next", () => {
  const view = completionView(fixtureCompletion, NOW);
  assert.equal(view.eyebrow, "Homework 1 complete");
  assert.deepEqual(view.stats, [
    { value: "2/2", label: "examples hold" },
    { value: "1", label: "new or reworded rule" },
    { value: "0", label: "side threads" },
    { value: "3 days", label: "since adopted" },
  ]);
  assert.equal(view.summary, fixtureCompletion.summary);
  assert.equal(view.next?.eyebrow, "Homework 2 · Set after day 2");
  assert.deepEqual(view.next?.chips, [
    { text: "3 rules · 5 examples", tone: "plain" },
    { text: "1 carry over as passing", tone: "green" },
    { text: "4 new or reworded", tone: "amber" },
  ]);
  assert.equal(view.next?.diff?.title, "FACTORY.md — what changed since homework 1");
  assert.equal(view.next?.started, false);
  assert.equal(view.next?.startLabel, "Start homework 2 with your coach →");
  assert.equal(view.next?.lessonSubPath, "lesson/002");

  const sameDay = completionView(
    {
      ...fixtureCompletion,
      homework: { ...fixtureCompletion.homework, set: "Day 3" },
      adoptedAt: null,
      next: fixtureCompletion.next === null ? null : { ...fixtureCompletion.next, set: "Day 3", factoryDiff: null },
    },
    NOW,
  );
  assert.equal(sameDay.next?.eyebrow, "Homework 2 · Also set after day 3");
  assert.equal(sameDay.next?.diff, null);
  assert.equal(sameDay.stats.length, 3, "no adoption date, no 'since adopted'");
  assert.equal(completionView({ ...fixtureCompletion, next: null }, NOW).next, null);
});

test("once the next homework has started, the completion page continues it", () => {
  const next = fixtureCompletion.next;
  assert.ok(next !== null);
  const view = completionView({ ...fixtureCompletion, next: { ...next, status: "current" } }, NOW);
  assert.equal(view.next?.started, true);
  assert.equal(view.next?.startLabel, "Continue homework 2 with your coach →");
});

test("confetti is deterministic and stays in the top right", () => {
  const pieces = confettiPieces();
  assert.equal(pieces.length, 46);
  assert.ok(pieces.every((piece) => piece.left >= 55 && piece.left < 100 && piece.top <= 36));
  assert.deepEqual(confettiPieces(), pieces);
});

test("first run confirms a detected factory, or explains how to set one up", () => {
  const view = welcomeView(fixtureCandidates, { status: "unbound" });
  assert.equal(view.mode, "confirm");
  assert.equal(view.preselected, "prj_factory");
  assert.deepEqual(view.others.map((project) => project.name), ["tutorial"]);
  assert.equal(view.missingProjectId, null);

  const none = welcomeView(fixtureCandidates.filter((project) => !project.qualifies), { status: "missing", projectId: "prj_gone" });
  assert.equal(none.mode, "setup");
  assert.equal(none.preselected, null);
  assert.equal(none.missingProjectId, "prj_gone");
  assert.equal(welcomeView([], fixtureBinding).mode, "setup");
});

// ---------------------------------------------------------------------------
// Rule tab (4).
// ---------------------------------------------------------------------------

test("rule tab params are validated field by field", () => {
  assert.deepEqual(parseRuleTabParams({ homeworkId: "002", ruleKey: FOCUS }), { homeworkId: "002", ruleKey: FOCUS });
  assert.deepEqual(parseRuleTabParams({ homeworkId: "2", ruleKey: "../etc" }), { homeworkId: null, ruleKey: null });
  assert.deepEqual(parseRuleTabParams(["002"]), { homeworkId: null, ruleKey: null });
  assert.deepEqual(parseRuleTabParams(null), { homeworkId: null, ruleKey: null });
});

test("the rule tab targets explicit params, else the thread's own homework and Rule", () => {
  const side = fixtureThreads[1] ?? null;
  const coach = fixtureThreads[0] ?? null;
  assert.deepEqual(ruleTabTarget({ homeworkId: null, ruleKey: null }, side), { homeworkId: "002", ruleKey: FOCUS });
  assert.deepEqual(ruleTabTarget({ homeworkId: null, ruleKey: null }, coach), { homeworkId: "002", ruleKey: null });
  assert.deepEqual(ruleTabTarget({ homeworkId: "001", ruleKey: null }, side), { homeworkId: "001", ruleKey: null });
  assert.equal(ruleTabTarget({ homeworkId: null, ruleKey: null }, null), null);
});

test("the rule tab shows the Rule and its Examples", () => {
  const view = ruleTabView(fixtureLesson, { homeworkId: "002", ruleKey: null }, false);
  assert.equal(view.kind, "rule");
  if (view.kind !== "rule") return;
  assert.equal(view.eyebrow, "Rule in focus · Validation");
  assert.equal(view.title, "A task is finished when validation is satisfied");
  assert.deepEqual([view.passing, view.total, view.percent], [1, 2, 50]);
  assert.deepEqual(
    view.examples.map((example) => example.detail),
    ["Passing", "Not yet — Crashed in the doer loop instead of retrying when the validator said no."],
  );
  assert.equal(view.lessonSubPath, "lesson/002");

  const spun = ruleTabView(fixtureLesson, { homeworkId: "002", ruleKey: "planning/the-planner-writes-a-plan" }, true);
  assert.equal(spun.kind === "rule" ? spun.eyebrow : null, "Spun off from · Planning");
  assert.equal(spun.kind === "rule" ? spun.examples[0]?.detail : null, "Passing · carried over");
  assert.deepEqual(ruleTabView({ ...fixtureLesson, focus: null }, { homeworkId: "002", ruleKey: null }, false), {
    kind: "no-rule",
    lessonSubPath: "lesson/002",
  });
});
