import { test } from "node:test";
import assert from "node:assert/strict";
import { CourseLoadError } from "../../shared/ports.ts";
import { parseLexicon } from "./lexicon.ts";

test("each key is a term id with its term and definition", () => {
  const entries = parseLexicon(
    `# comment
assembly-line:
  term: "Assembly line"
  definition: |-
    An ordered sequence of *machines*.
    Second line.
doer:
  term: Doer
  definition: The machine that attempts a task.
`,
    "docs/lexicon.yaml",
  );
  assert.deepEqual(entries, [
    { id: "assembly-line", term: "Assembly line", definition: "An ordered sequence of *machines*.\nSecond line." },
    { id: "doer", term: "Doer", definition: "The machine that attempts a task." },
  ]);
});

test("an empty lexicon has no entries", () => {
  assert.deepEqual(parseLexicon("# nothing yet\n", "lexicon.yaml"), []);
});

test("a bad entry names its line", () => {
  const cases: [string, RegExp][] = [
    ["ok:\n  term: Ok\n  definition: Fine.\nbad:\n  term: Bad\n", /^lexicon\.yaml, line 5: "bad" needs a term and a definition\.$/],
    ["Not A Slug:\n  term: X\n  definition: Y\n", /^lexicon\.yaml, line 2: the term id "Not A Slug" should be lower-case/],
    ["- a list\n", /^lexicon\.yaml should map each term id to a term and a definition\.$/],
  ];
  for (const [yaml, message] of cases) {
    assert.throws(() => parseLexicon(yaml, "lexicon.yaml"), (error: unknown) => error instanceof CourseLoadError && message.test(error.message));
  }
});
