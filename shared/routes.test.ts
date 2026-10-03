import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRoute, parseRoute, type TutorRoute } from "./routes.ts";

test("routes round-trip", () => {
  const routes: TutorRoute[] = [
    { kind: "home" },
    { kind: "welcome" },
    { kind: "start", courseId: "software-factory", lessonId: "003" },
    { kind: "complete", courseId: "tutor", lessonId: "000" },
    { kind: "start", courseId: null, lessonId: "003" },
  ];
  for (const route of routes) assert.deepEqual(parseRoute(formatRoute(route)), route);
});

test("lesson routes carry the course; a legacy start/NNN has none", () => {
  assert.deepEqual(parseRoute("start/tutor/000"), { kind: "start", courseId: "tutor", lessonId: "000" });
  assert.deepEqual(parseRoute("complete/software-factory/003"), { kind: "complete", courseId: "software-factory", lessonId: "003" });
  assert.deepEqual(parseRoute("start/003"), { kind: "start", courseId: null, lessonId: "003" });
  assert.equal(formatRoute({ kind: "start", courseId: "tutor", lessonId: "000" }), "start/tutor/000");
});

test("a course id with characters a path can't hold survives the round trip", () => {
  const route: TutorRoute = { kind: "start", courseId: "a b/c", lessonId: "001" };
  assert.equal(formatRoute(route), "start/a%20b%2Fc/001");
  assert.deepEqual(parseRoute(formatRoute(route)), route);
});

test("malformed sub-paths fall back to home", () => {
  for (const subPath of ["start", "start/3", "start/tutor/3", "start/tutor/003/extra", "complete/abc", "welcome/x", "nope", "start/%E0/001"]) {
    assert.deepEqual(parseRoute(subPath), { kind: "home" }, subPath);
  }
  assert.deepEqual(parseRoute("/start/004/"), { kind: "start", courseId: null, lessonId: "004" });
});
