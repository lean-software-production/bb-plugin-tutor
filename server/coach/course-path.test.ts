import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveConfiguredCourse } from "./course-path.ts";

test("a configured course: the setting wins, then TUTOR_COURSE_PATH, else none (standalone)", () => {
  assert.equal(resolveConfiguredCourse("/setting/course", {}), "/setting/course");
  assert.equal(resolveConfiguredCourse(undefined, { TUTOR_COURSE_PATH: "/env/course" }), "/env/course");
  assert.equal(resolveConfiguredCourse("  ", { TUTOR_COURSE_PATH: "/env/course" }), "/env/course");
  assert.equal(resolveConfiguredCourse(" ", {}), null);
  assert.equal(resolveConfiguredCourse(undefined, {}), null);
});
