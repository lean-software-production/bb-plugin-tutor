import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRoute, parseRoute, type TutorRoute } from "./routes.ts";

test("routes round-trip", () => {
  const routes: TutorRoute[] = [
    { kind: "home" },
    { kind: "welcome" },
    { kind: "start", homeworkId: "003" },
    { kind: "complete", homeworkId: "000" },
  ];
  for (const route of routes) assert.deepEqual(parseRoute(formatRoute(route)), route);
});

test("malformed sub-paths fall back to home", () => {
  for (const subPath of ["start", "start/3", "start/003/extra", "complete/abc", "welcome/x", "nope"]) {
    assert.deepEqual(parseRoute(subPath), { kind: "home" }, subPath);
  }
  assert.deepEqual(parseRoute("/start/004/"), { kind: "start", homeworkId: "004" });
});
