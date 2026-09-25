import { test } from "node:test";
import assert from "node:assert/strict";
import type { Step } from "../../shared/model.ts";
import { exampleHash } from "./example-hash.ts";

function step(keyword: string, text: string, extra: Partial<Step> = {}): Step {
  return { keyword, text, docString: null, dataTable: null, line: 1, ...extra };
}

const drawing = [
  step("Given", "this drawing:", { docString: { mediaType: "dot", content: "digraph {\n  a -> b\n}" } }),
  step("Then", "these rows:", { dataTable: [["a", "b"], ["1", "2"]] }),
];

test("the hash input is pinned: changing it would reset every student's carry-over", () => {
  // sha256 of 'A drawing\nGiven this drawing:\n"""dot\ndigraph {\na -> b\n}\n"""\nThen these rows:\na | b\n1 | 2'
  assert.equal(
    exampleHash("A drawing", drawing),
    "sha256:9590cb0113d64df9c41d3eeeba61730d71326d9673de162bc0faf3ab4f3417cb",
  );
});

test("whitespace and line numbers do not change the hash", () => {
  const respaced = [
    step("Given", "this   drawing: ", {
      line: 40,
      docString: { mediaType: "dot", content: "  digraph {\n\t\ta   ->  b\n  }" },
    }),
    step("Then", "these rows:", { line: 41, dataTable: [[" a", "b "], ["1", "2"]] }),
  ];
  assert.equal(exampleHash("  A  drawing", respaced), exampleHash("A drawing", drawing));
});

test("rewording the name, a step, a keyword, a docstring or a table changes the hash", () => {
  const base = exampleHash("A drawing", drawing);
  const [given, then] = drawing as [Step, Step];
  const variants: Step[][] = [
    [step("Given", "that drawing:", { docString: given.docString }), then],
    [step("And", "this drawing:", { docString: given.docString }), then],
    [step("Given", "this drawing:", { docString: { mediaType: null, content: "digraph {\n  a -> b\n}" } }), then],
    [step("Given", "this drawing:", { docString: { mediaType: "dot", content: "digraph {\n  a -> c\n}" } }), then],
    [given, step("Then", "these rows:", { dataTable: [["a", "b"], ["1", "3"]] })],
  ];
  assert.notEqual(exampleHash("Another drawing", drawing), base);
  for (const variant of variants) assert.notEqual(exampleHash("A drawing", variant), base);
});
