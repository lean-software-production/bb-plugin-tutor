import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureOverview } from "../../shared/fixtures.ts";
import { coursePath, parseCoursePath, routeCourse } from "./course-route.ts";

const RULE = "validation/a-task-is-finished-when-validation-is-satisfied";
const COURSE = "software-factory";

test("a lesson link can name a Rule, so it survives a new tab or a reload", () => {
  const path = coursePath({ kind: "start", courseId: COURSE, lessonId: "002" }, RULE);
  assert.equal(path, `start/${COURSE}/002/${RULE}`);
  assert.deepEqual(parseCoursePath(path), { route: { kind: "start", courseId: COURSE, lessonId: "002" }, ruleKey: RULE });
  assert.deepEqual(
    parseCoursePath(`start/${COURSE}/002/${encodeURIComponent(RULE)}`),
    { route: { kind: "start", courseId: COURSE, lessonId: "002" }, ruleKey: RULE },
    "an encoded slash reads the same",
  );
});

test("a lesson link from before courses still opens its Rule, with no course named", () => {
  assert.deepEqual(parseCoursePath(`start/002/${RULE}`), { route: { kind: "start", courseId: null, lessonId: "002" }, ruleKey: RULE });
});

test("every other sub-path means what shared/routes.ts says, without a Rule", () => {
  assert.deepEqual(parseCoursePath(`start/${COURSE}/002`), { route: { kind: "start", courseId: COURSE, lessonId: "002" }, ruleKey: null });
  assert.deepEqual(parseCoursePath("start/002"), { route: { kind: "start", courseId: null, lessonId: "002" }, ruleKey: null });
  assert.deepEqual(parseCoursePath(`complete/${COURSE}/002`), { route: { kind: "complete", courseId: COURSE, lessonId: "002" }, ruleKey: null });
  assert.deepEqual(parseCoursePath("welcome"), { route: { kind: "welcome" }, ruleKey: null });
  for (const subPath of ["start/003/extra", "start/003/Not/Aslug", "complete/002/a/b", "start/003/a/b/c", "start/003/%E0%A4%A", `start/${COURSE}/002/Not/Aslug`]) {
    assert.deepEqual(parseCoursePath(subPath), { route: { kind: "home" }, ruleKey: null }, subPath);
  }
  assert.equal(coursePath({ kind: "complete", courseId: COURSE, lessonId: "002" }, RULE), `complete/${COURSE}/002`, "only lessons carry a Rule");
  assert.equal(coursePath({ kind: "start", courseId: COURSE, lessonId: "002" }, null), `start/${COURSE}/002`);
});

test("a link from before courses means the built-in course for Lesson 0, else the course that has the lesson", () => {
  const courses = fixtureOverview.courses;
  assert.equal(routeCourse(null, "000", courses), "tutor");
  assert.equal(routeCourse(null, "002", courses), COURSE);
  assert.equal(routeCourse(null, "009", courses), null);
  assert.equal(routeCourse("elsewhere", "002", courses), "elsewhere");
});
