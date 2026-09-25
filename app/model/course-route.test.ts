import { test } from "node:test";
import assert from "node:assert/strict";
import { coursePath, parseCoursePath } from "./course-route.ts";

const RULE = "validation/a-task-is-finished-when-validation-is-satisfied";

test("a lesson link can name a Rule, so it survives a new tab or a reload", () => {
  const path = coursePath({ kind: "lesson", homeworkId: "002" }, RULE);
  assert.equal(path, `lesson/002/${RULE}`);
  assert.deepEqual(parseCoursePath(path), { route: { kind: "lesson", homeworkId: "002" }, ruleKey: RULE });
  assert.deepEqual(
    parseCoursePath(`lesson/002/${encodeURIComponent(RULE)}`),
    { route: { kind: "lesson", homeworkId: "002" }, ruleKey: RULE },
    "an encoded slash reads the same",
  );
});

test("every other sub-path means what shared/routes.ts says, without a Rule", () => {
  assert.deepEqual(parseCoursePath("lesson/002"), { route: { kind: "lesson", homeworkId: "002" }, ruleKey: null });
  assert.deepEqual(parseCoursePath("complete/002"), { route: { kind: "complete", homeworkId: "002" }, ruleKey: null });
  assert.deepEqual(parseCoursePath("welcome"), { route: { kind: "welcome" }, ruleKey: null });
  for (const subPath of ["lesson/003/extra", "lesson/003/Not/Aslug", "complete/002/a/b", "lesson/003/a/b/c", "lesson/003/%E0%A4%A"]) {
    assert.deepEqual(parseCoursePath(subPath), { route: { kind: "home" }, ruleKey: null }, subPath);
  }
  assert.equal(coursePath({ kind: "complete", homeworkId: "002" }, RULE), "complete/002", "only lessons carry a Rule");
  assert.equal(coursePath({ kind: "lesson", homeworkId: "002" }, null), "lesson/002");
});
