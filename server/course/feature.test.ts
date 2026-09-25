import { test } from "node:test";
import assert from "node:assert/strict";
import { CourseLoadError } from "../../shared/ports.ts";
import { parseFeatureFile } from "./feature.ts";

const parse = (text: string, path = "features/Line Rules.feature") =>
  parseFeatureFile({ text, path, displayPath: `hw/${path}` });

const SOURCE = `@core
Feature: Assembly line

  The line is a graph.

    Indented detail.

  Background:
    Given the factory keeps its jobs in a new, empty folder

  Example: Loose one
    Then it is loose

  Rule: The factory accepts a line it can run

    Lines that can finish are fine.

    Background:
      Given this assembly line:
        """dot
        digraph { start -> finish }
        """

    @real-agent
    Example: The line as it stands
      When the factory reads the assembly line
      Then it accepts it

    Example: The line as it stands
      * it still accepts it

  Rule: General

    Example: A table
      Given these machines:
        | name    | agent |
        | planner | pi    |
`;

test("a feature file becomes the shared model with stable keys", () => {
  const feature = parse(SOURCE);
  assert.equal(feature.slug, "line-rules");
  assert.equal(feature.path, "features/Line Rules.feature");
  assert.equal(feature.name, "Assembly line");
  assert.equal(feature.description, "The line is a graph.\n\n  Indented detail.");
  assert.deepEqual(feature.tags, ["core"]);
  assert.deepEqual(feature.background.map((step) => [step.keyword, step.text, step.line]), [
    ["Given", "the factory keeps its jobs in a new, empty folder", 9],
  ]);
  assert.deepEqual(
    feature.rules.map((rule) => [rule.key, rule.name, rule.line]),
    [
      ["line-rules/general", "Assembly line", 11],
      ["line-rules/the-factory-accepts-a-line-it-can-run", "The factory accepts a line it can run", 14],
      ["line-rules/general-2", "General", 32],
    ],
  );
  assert.deepEqual(
    feature.rules.flatMap((rule) => rule.examples.map((example) => example.key)),
    [
      "line-rules/general/loose-one",
      "line-rules/the-factory-accepts-a-line-it-can-run/the-line-as-it-stands",
      "line-rules/the-factory-accepts-a-line-it-can-run/the-line-as-it-stands-2",
      "line-rules/general-2/a-table",
    ],
  );
});

test("Rules keep their description and Background; Examples their tags, docstrings and tables", () => {
  const [, accepts, general] = parse(SOURCE).rules;
  assert.ok(accepts && general);
  assert.equal(accepts.description, "Lines that can finish are fine.");
  assert.deepEqual(accepts.background[0]?.docString, { mediaType: "dot", content: "digraph { start -> finish }" });
  const [tagged, starred] = accepts.examples;
  assert.deepEqual(tagged?.tags, ["real-agent"]);
  assert.equal(tagged?.line, 25);
  assert.match(tagged?.hash ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(starred?.steps.map((step) => step.keyword), ["*"]);
  assert.deepEqual(general.examples[0]?.steps[0]?.dataTable, [
    ["name", "agent"],
    ["planner", "pi"],
  ]);
});

test("a Scenario Outline is one Example", () => {
  const feature = parse(`Feature: F
  Rule: R
    Scenario Outline: Many <n>
      Given <n> things
      Examples:
        | n |
        | 1 |
        | 2 |
`);
  assert.deepEqual(feature.rules[0]?.examples.map((example) => example.name), ["Many <n>"]);
});

test("a syntax error names the file and the line", () => {
  assert.throws(
    () => parse("Feature: F\n  Rule: R\n    Example: E\n      Given a\n  what is this\n  and this\n"),
    (error: unknown) =>
      error instanceof CourseLoadError &&
      /^Could not read hw\/features\/Line Rules\.feature, line 5: expected: .*got 'what is this' \(and 1 more\)$/.test(
        error.message,
      ),
  );
});

test("a file without a Feature is refused", () => {
  assert.throws(() => parse("# just a comment\n"), /hw\/features\/Line Rules\.feature has no Feature\./);
});
