import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exampleKey,
  featureSlugFromPath,
  parseExampleKey,
  ruleKey,
  ruleKeyOfExample,
  slugify,
  uniqueSlugs,
} from "./keys.ts";

test("slugify lower-cases, drops apostrophes and collapses punctuation", () => {
  assert.equal(
    slugify("The factory refuses an assembly line naming a machine it does not have"),
    "the-factory-refuses-an-assembly-line-naming-a-machine-it-does-not-have",
  );
  assert.equal(slugify("The doer's agent is given the task — and the seed!"), "the-doers-agent-is-given-the-task-and-the-seed");
  assert.equal(slugify("  Café crème  "), "cafe-creme");
  assert.equal(slugify("???"), "untitled");
});

test("slugify cuts long names at a hyphen boundary", () => {
  const slug = slugify("word ".repeat(40));
  assert.ok(slug.length <= 96);
  assert.ok(!slug.endsWith("-"));
  assert.match(slug, /^word(-word)*$/);
});

test("uniqueSlugs suffixes repeats in order", () => {
  assert.deepEqual(uniqueSlugs(["A", "a", "A-2", "a"]), ["a", "a-2", "a-2-2", "a-3"]);
});

test("feature slugs come from the file name", () => {
  assert.equal(featureSlugFromPath("features/assembly-line.feature"), "assembly-line");
  assert.equal(featureSlugFromPath("C:\\x\\Agent.feature"), "agent");
});

test("keys compose and parse", () => {
  assert.equal(ruleKey("assembly-line", "y"), "assembly-line/y");
  const key = exampleKey("assembly-line", "y", "a-misspelt-validator");
  assert.equal(key, "assembly-line/y/a-misspelt-validator");
  assert.deepEqual(parseExampleKey(key), { feature: "assembly-line", rule: "y", example: "a-misspelt-validator" });
  assert.equal(ruleKeyOfExample(key), "assembly-line/y");
  assert.equal(parseExampleKey("a/b"), null);
  assert.equal(parseExampleKey("a/B/c"), null);
  assert.equal(ruleKeyOfExample("../etc/passwd"), null);
});
