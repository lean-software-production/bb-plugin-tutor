import { test } from "node:test";
import assert from "node:assert/strict";
import { firstHeading, readmeDek, sharedSentences } from "./readme.ts";

const README = `# Homework 3 — The assembly line

*Set after day 3. This is the weekend.*

\`\`\`sh

$ ./factory --job tetris

\`\`\`

- a list item

Read \`FACTORY.md\`, then the feature files in \`features/\`. Together they
are the whole spec.

The factory does the same work. What changes is
where the route lives.
`;

test("the dek is the first prose paragraph on one line", () => {
  assert.equal(
    readmeDek(README),
    "Read `FACTORY.md`, then the feature files in `features/`. Together they are the whole spec.",
  );
});

test("sentences every README repeats are left out of the dek", () => {
  const other = "# Homework 4\n\nRead `FACTORY.md`, then the feature files in `features/`.\n\nTogether they are the whole spec.\n";
  const boilerplate = sharedSentences([README, other]);
  assert.deepEqual(
    [...boilerplate].sort(),
    ["Read `FACTORY.md`, then the feature files in `features/`.", "Together they are the whole spec."],
  );
  assert.equal(readmeDek(README, boilerplate), "The factory does the same work. What changes is where the route lives.");
});

test("a README with no prose has an empty dek", () => {
  assert.equal(readmeDek("# Title\n\n*Set after day 1.*\n\n## Next\n"), "");
});

test("the first heading is the course title", () => {
  assert.equal(firstHeading("Intro\n\n# Tutorial #\n\n# Second\n"), "Tutorial");
  assert.equal(firstHeading("No heading here\n"), null);
});
