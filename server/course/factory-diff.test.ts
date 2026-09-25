import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryDiff } from "./factory-diff.ts";

test("FACTORY.md changes come out line by line", () => {
  assert.deepEqual(factoryDiff("# F\n\nA planner.\nA pass.\n", "# F\n\nA planner.\nA line.\n\nMore."), [
    { kind: "ctx", text: "# F" },
    { kind: "ctx", text: "" },
    { kind: "ctx", text: "A planner." },
    { kind: "del", text: "A pass." },
    { kind: "add", text: "A line." },
    { kind: "add", text: "" },
    { kind: "add", text: "More." },
  ]);
});

test("a missing final newline is not a change", () => {
  assert.deepEqual(factoryDiff("A.\nB.", "A.\nB.\n"), [
    { kind: "ctx", text: "A." },
    { kind: "ctx", text: "B." },
  ]);
});

test("a FACTORY.md that appears is all additions", () => {
  assert.deepEqual(factoryDiff("", "New.\n"), [{ kind: "add", text: "New." }]);
});
