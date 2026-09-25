import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_TOOL_NAMES, TOOL_NAMES } from "./constants.ts";
import { toolParameterSchemas } from "./tools.ts";

const example = "validation/a-task-is-finished-when-validation-is-satisfied/the-work-is-right-first-time";

test("every tool has a parameter schema", () => {
  assert.deepEqual(Object.keys(toolParameterSchemas).sort(), [...ALL_TOOL_NAMES].sort());
});

test("tutor_mark_example requires evidence for passing and a note for not-yet", () => {
  const schema = toolParameterSchemas[TOOL_NAMES.markExample];
  assert.equal(schema.safeParse({ example, status: "passing" }).success, false);
  assert.equal(schema.safeParse({ example, status: "passing", evidence: "$ ./factory\nok" }).success, true);
  assert.equal(schema.safeParse({ example, status: "not-yet" }).success, false);
  assert.equal(schema.safeParse({ example, status: "not-yet", note: "crashed" }).success, true);
  assert.equal(schema.safeParse({ example, status: "skipped" }).success, true);
  assert.equal(schema.safeParse({ example: "../x", status: "skipped" }).success, false);
});

test("tutor_adopt_iteration takes a three-digit id", () => {
  const schema = toolParameterSchemas[TOOL_NAMES.adoptIteration];
  assert.equal(schema.safeParse({ iteration: "004" }).success, true);
  assert.equal(schema.safeParse({ iteration: "4" }).success, false);
});
