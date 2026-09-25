import assert from "node:assert/strict";
import { test } from "node:test";
import { formatIteration, parseIteration } from "./iteration.ts";

test("parses the canonical line and tolerates case and spacing", () => {
  assert.deepEqual(parseIteration("003 WIP\n"), { state: { iteration: "003", status: "WIP" } });
  assert.deepEqual(parseIteration("  001   done "), { state: { iteration: "001", status: "Done" } });
});

test("reports anything else as a problem", () => {
  const parsed = parseIteration("iteration three");
  assert.ok("problem" in parsed);
  assert.match(parsed.problem, /iteration three/);
  assert.ok("problem" in parseIteration("3 WIP"));
});

test("formats one line with a trailing newline", () => {
  assert.equal(formatIteration({ iteration: "002", status: "Done" }), "002 Done\n");
});
