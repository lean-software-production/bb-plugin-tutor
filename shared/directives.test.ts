import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatProgressCard,
  formatTermRef,
  parseProgressCard,
  parseTermRef,
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
  homeworkId: "003",
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
    homework: "3",
    rule: "../../etc",
    example: "a/b/c",
    note: "n".repeat(1000),
  });
  assert.ok(parsed !== null);
  assert.equal(parsed.title, "x");
  assert.equal(parsed.passed, null);
  assert.equal(parsed.total, null);
  assert.equal(parsed.homeworkId, null);
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
