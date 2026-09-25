import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatLessonRef,
  formatProgressCard,
  formatTermRef,
  parseLessonRef,
  parseProgressCard,
  parseTermRef,
  ruleAnchor,
  withoutLeadingDirectives,
  type ProgressCard,
} from "./directives.ts";

/** Minimal stand-in for BB's leaf-directive attribute parser: name{key="value" …}. */
function attributesOf(source: string): Record<string, string> {
  const body = /^::[a-z-]+\{(.*)\}$/.exec(source)?.[1];
  assert.ok(body !== undefined, `not a leaf directive: ${source}`);
  return Object.fromEntries([...body.matchAll(/([a-z]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}

const card: ProgressCard = {
  kind: "rule-passing",
  title: "The factory accepts an assembly line it can run",
  passed: 30,
  total: 41,
  next: "The factory refuses an assembly line naming a machine it does not have",
  note: null,
  lessonId: "003",
  ruleKey: "assembly-line/the-factory-accepts-an-assembly-line-it-can-run",
  exampleKey: null,
};

test("a formatted progress card parses back to itself", () => {
  const source = formatProgressCard(card);
  assert.match(source, /^::tutor-progress\{kind="rule-passing" title=/);
  assert.deepEqual(parseProgressCard(attributesOf(source)), card);
});

test("formatting neutralises quotes, braces and newlines", () => {
  const source = formatProgressCard({ ...card, kind: "not-yet", note: 'It said "no" {twice}\nthen crashed' });
  assert.equal(source.split("\n").length, 1);
  assert.equal(parseProgressCard(attributesOf(source))?.note, "It said ”no” twice then crashed");
});

test("untrusted progress attributes are validated", () => {
  assert.equal(parseProgressCard({ kind: "explode", title: "x" }), null);
  assert.equal(parseProgressCard({ kind: "focus" }), null);
  const parsed = parseProgressCard({
    kind: "focus",
    title: "  x  ",
    passed: "50",
    total: "41",
    lesson: "3",
    rule: "../../etc",
    example: "a/b/c",
    note: "n".repeat(1000),
  });
  assert.ok(parsed !== null);
  assert.equal(parsed.title, "x");
  assert.equal(parsed.passed, null);
  assert.equal(parsed.total, null);
  assert.equal(parsed.lessonId, null);
  assert.equal(parsed.ruleKey, null);
  assert.equal(parsed.exampleKey, "a/b/c");
  assert.equal(parsed.note?.length, 400);
});

test("term refs round-trip and reject bad ids", () => {
  const source = formatTermRef({ id: "assembly-line", label: "assembly lines" });
  assert.equal(source, '::term{id="assembly-line" label="assembly lines"}');
  assert.deepEqual(parseTermRef(attributesOf(source)), { id: "assembly-line", label: "assembly lines" });
  assert.deepEqual(parseTermRef({ id: "doer" }), { id: "doer", label: null });
  assert.equal(parseTermRef({ id: "<script>" }), null);
  assert.equal(parseTermRef({}), null);
});

test("a lesson card names one lesson, and nothing else is accepted", () => {
  const source = formatLessonRef({ lessonId: "003" });
  assert.equal(source, '::tutor-lesson{lesson="003"}');
  assert.deepEqual(parseLessonRef(attributesOf(source)), { lessonId: "003" });
  for (const lesson of [undefined, "", "3", "0003", "003 ", "../003", "abc"]) {
    assert.equal(parseLessonRef(lesson === undefined ? {} : { lesson }), null, String(lesson));
  }
});

test("a Rule anchor joins the thread, the lesson and the Rule, and refuses anything malformed", () => {
  assert.equal(ruleAnchor("thr_abc", "003", "assembly-line/refuses"), "thr_abc|003/assembly-line/refuses");
  assert.equal(ruleAnchor("thr abc", "003", "a/b"), null);
  assert.equal(ruleAnchor("thr_abc", "3", "a/b"), null);
  assert.equal(ruleAnchor("thr_abc", "003", "a/b/c"), null);
  assert.equal(ruleAnchor("thr_abc", "003", 'a/b"]'), null);
});

test("a title drawn from a message drops the cards it opens with", () => {
  assert.equal(withoutLeadingDirectives('::tutor-progress{kind="focus" title="x"}\n\nLet us start.'), "Let us start.");
  assert.equal(withoutLeadingDirectives('::tutor-lesson{lesson="000"} ::tutor-progress{kind="foc…'), "");
  assert.equal(withoutLeadingDirectives("Plain text ::term{id=\"x\"}"), "Plain text ::term{id=\"x\"}");
});
