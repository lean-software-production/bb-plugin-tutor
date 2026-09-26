import assert from "node:assert/strict";
import { test } from "node:test";
import { formatIteration, parseIteration } from "./iteration.ts";

test("parses the canonical line and tolerates case and spacing", () => {
  assert.deepEqual(parseIteration("003 WIP\n", "ITERATION"), { state: { iteration: "003", status: "WIP" } });
  assert.deepEqual(parseIteration("  001   done ", "ITERATION"), { state: { iteration: "001", status: "Done" } });
});

test("reports anything else as a problem", () => {
  const parsed = parseIteration("iteration three", "ITERATION");
  assert.ok("problem" in parsed);
  assert.match(parsed.problem, /iteration three/);
  assert.ok("problem" in parseIteration("3 WIP", "ITERATION"));
});

test("a problem names the file it was read from", () => {
  for (const label of ["ITERATION", "spec/ITERATION"]) {
    const parsed = parseIteration("three", label);
    assert.ok("problem" in parsed);
    assert.equal(parsed.problem, `${label} should read like "003 WIP", but it reads "three".`);
  }
});

test("formats one line with a trailing newline", () => {
  assert.equal(formatIteration({ iteration: "002", status: "Done" }), "002 Done\n");
});
