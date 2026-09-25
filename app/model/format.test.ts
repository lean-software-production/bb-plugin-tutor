import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipLines,
  daysSince,
  firstSentence,
  homeworkEyebrow,
  homeworkLabel,
  percent,
  plural,
  relativeTime,
  setLabel,
} from "./format.ts";

const NOW = Date.parse("2026-09-25T10:12:00Z");

test("homework labels drop the leading zeros", () => {
  assert.equal(homeworkLabel("003"), "Homework 3");
  assert.equal(homeworkLabel("000"), "Homework 0");
  assert.equal(homeworkLabel("012"), "Homework 12");
});

test("a ledger day reads as 'Set after day N'; other sets are shown as written", () => {
  assert.equal(setLabel("Day 3"), "Set after day 3");
  assert.equal(setLabel("Start here"), "Start here");
  assert.equal(setLabel(null), null);
  assert.equal(setLabel("  "), null);
  assert.equal(homeworkEyebrow("003", "Day 3"), "Homework 3 · Set after day 3");
  assert.equal(homeworkEyebrow("004", null), "Homework 4");
});

test("plural and percent", () => {
  assert.equal(plural(1, "rule"), "1 rule");
  assert.equal(plural(3, "rule"), "3 rules");
  assert.equal(plural(2, "day", "days"), "2 days");
  assert.equal(percent(30, 41), 73);
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(5, 4), 100);
});

test("relative times", () => {
  assert.equal(relativeTime("2026-09-25T10:11:30Z", NOW), "just now");
  assert.equal(relativeTime("2026-09-25T10:06:00Z", NOW), "6m ago");
  assert.equal(relativeTime("2026-09-25T07:00:00Z", NOW), "3h ago");
  assert.equal(relativeTime("2026-09-23T09:00:00Z", NOW), "2d ago");
  assert.equal(relativeTime("2026-09-26T00:00:00Z", NOW), "just now", "future times clamp");
  assert.equal(relativeTime(null, NOW), null);
  assert.equal(relativeTime("not a date", NOW), null);
});

test("days since adoption", () => {
  assert.equal(daysSince("2026-09-25T01:00:00Z", NOW), "today");
  assert.equal(daysSince("2026-09-24T09:00:00Z", NOW), "1 day");
  assert.equal(daysSince("2026-09-22T09:00:00Z", NOW), "3 days");
  assert.equal(daysSince(undefined, NOW), null);
});

test("first sentence and clipped lines", () => {
  assert.equal(firstSentence("The route is a graph.\nIt is read first."), "The route is a graph.");
  assert.equal(firstSentence("No full stop here"), "No full stop here");
  assert.equal(firstSentence("  "), "");
  assert.deepEqual(clipLines("a\nb\nc\n", 2), { text: "a\nb", clipped: true });
  assert.deepEqual(clipLines("a\nb\n", 2), { text: "a\nb", clipped: false });
});
