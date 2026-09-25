import { test } from "node:test";
import assert from "node:assert/strict";
import { CourseLoadError } from "../../shared/ports.ts";
import { parseLedger } from "./ledger.ts";

const parse = (markdown: string) => parseLedger(markdown, "/course/docs/iterations", "ledger.md");

test("each ledger row is a homework: id, title and folder from the link, and when it was set", () => {
  const markdown = `# Iterations

| Iteration | Spec | Set after |
|:---|---|---:|
| 001 | [Basic unvalidated loop](001-basic-unvalidated-loop/README.md) | Day 1 |
| 002 | [Checking the work](002-checking-the-work) |  |

Your progress lives elsewhere.
`;
  assert.deepEqual(parse(markdown), [
    { id: "001", title: "Basic unvalidated loop", set: "Day 1", dir: "/course/docs/iterations/001-basic-unvalidated-loop" },
    { id: "002", title: "Checking the work", set: null, dir: "/course/docs/iterations/002-checking-the-work" },
  ]);
});

test("columns are found by name, in any order", () => {
  const markdown = "| Set after | Iteration | Spec |\n|---|---|---|\n| Day 9 | 009 | [Nine](009-nine/README.md) |\n";
  assert.deepEqual(parse(markdown), [{ id: "009", title: "Nine", set: "Day 9", dir: "/course/docs/iterations/009-nine" }]);
});

test("a missing table, a bad id or a Spec without a link is a readable error naming the line", () => {
  const table = (row: string) => `Intro\n\n| Iteration | Spec | Set after |\n|---|---|---|\n${row}\n`;
  const cases: [string, RegExp][] = [
    ["# Nothing here\n", /^ledger\.md has no homework table with the columns Iteration, Spec and Set after\.$/],
    [table("| 1 | [One](001/README.md) | Day 1 |"), /^ledger\.md, line 5: the iteration "1" should be three digits/],
    [table("| 001 | One | Day 1 |"), /^ledger\.md, line 5: the Spec column should be a link/],
    ["| Iteration | Spec | Set after |\n|---|---|---|\n", /^ledger\.md's homework table has no rows\.$/],
  ];
  for (const [markdown, message] of cases) {
    assert.throws(() => parse(markdown), (error: unknown) => error instanceof CourseLoadError && message.test(error.message));
  }
});
