import { test } from "node:test";
import assert from "node:assert/strict";
import type { FeatureFile } from "../../shared/model.ts";
import { parseFeatureFile } from "./feature.ts";
import { suggestedRuleOrder, withChanges } from "./changes.ts";

function feature(path: string, body: string): FeatureFile {
  return parseFeatureFile({ text: `Feature: ${path}\n${body}`, path: `features/${path}.feature`, displayPath: path });
}

const before = [
  feature("a", `
  Rule: Kept
    Example: Same
      Then same
  Rule: Emptied
    Example: Gone
      Then gone
`),
];

const after = [
  feature("a", `
  Rule: Kept
    Example: Same
      Then same
  Rule: Emptied
  Rule: Empty from the start
`),
];

test("the first lesson is all new", () => {
  const [a] = withChanges(before, null);
  assert.equal(a?.change, "new");
  assert.ok(a?.rules.every((rule) => rule.change === "new" && rule.examples.every((e) => e.change === "new")));
});

test("a Rule without Examples is new unless it existed before", () => {
  const [a] = withChanges(after, before);
  assert.deepEqual(
    a?.rules.map((rule) => [rule.slug, rule.change]),
    [
      ["kept", "unchanged"],
      ["emptied", "unchanged"],
      ["empty-from-the-start", "new"],
    ],
  );
  assert.equal(a?.change, "unchanged");
});

test("the suggested order puts Rules that are not unchanged first, each group in file order", () => {
  const features = withChanges(
    [
      feature("a", "  Rule: Old\n    Example: Same\n      Then same\n  Rule: Fresh\n    Example: New\n      Then new\n"),
      feature("b", "  Rule: Also fresh\n    Example: Newer\n      Then newer\n"),
    ],
    before,
  );
  assert.deepEqual(suggestedRuleOrder(features), ["a/fresh", "b/also-fresh", "a/old"]);
});
