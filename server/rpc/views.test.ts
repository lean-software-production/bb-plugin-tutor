import assert from "node:assert/strict";
import { test } from "node:test";
import { findHomework, homeworkExamples } from "../../shared/derive.ts";
import {
  fixtureCompletion,
  fixtureCourse,
  fixtureFreshStudent,
  fixtureLesson,
  fixtureOverview,
  fixtureOverviewUnbound,
  fixtureReachedRules,
  fixtureStudent,
  fixtureThreads,
} from "../../shared/fixtures.ts";
import type { StudentState } from "../../shared/model.ts";
import { completionSchema, lessonSchema, overviewSchema } from "../../shared/rpc.ts";
import { makeWorld } from "../../test/helpers/world.ts";
import type { TutorThreadRecord } from "../coach/threads.ts";
import { buildCompletion, buildLesson, buildOverview } from "./views.ts";

const records: TutorThreadRecord[] = fixtureThreads.map((thread, index) => ({
  ...thread,
  courseId: "software-factory",
  projectId: "prj_factory",
  createdAt: 100 - index,
  reachedRules: thread.id === "thr_coach002" ? fixtureReachedRules : [],
}));

test("the overview matches the fixture the frontend was built against", () => {
  const overview = buildOverview(makeWorld(), records);
  assert.deepEqual(overviewSchema.parse(overview), overview);
  assert.deepEqual(overview, fixtureOverview);
});

test("unbound: homeworks are listed from a fresh start, with no current state or threads", () => {
  assert.deepEqual(buildOverview(makeWorld(fixtureStudent, { status: "unbound" }), records), fixtureOverviewUnbound);
});

test("a missing course still gives an overview", () => {
  const overview = buildOverview({ ...makeWorld(), course: null, pointer: null, courseError: "No course at /x." }, records);
  assert.equal(overview.course, null);
  assert.equal(overview.courseError, "No course at /x.");
  assert.deepEqual(overview.homeworks, []);
});

test("the current lesson carries progress, focus and its coach thread", () => {
  const lesson = buildLesson(makeWorld(), "002", records);
  assert.deepEqual(lessonSchema.parse(lesson), lesson);
  assert.deepEqual(lesson, fixtureLesson);
  const ahead = buildLesson(makeWorld(), "003", records);
  assert.equal(ahead.status, "ahead");
  assert.deepEqual(ahead.progress, {});
  assert.equal(ahead.iterationStatus, null);
  assert.throws(() => buildLesson(makeWorld(), "009", records), /no lesson 009/);
});

test("completion describes the finished homework and what comes next", () => {
  const progress = fixtureStudent.progress;
  assert.ok(progress !== null);
  const done: StudentState = {
    iteration: { iteration: "002", status: "Done" },
    progress: { ...progress, summary: "It checks its work." },
    problems: [],
  };
  const completion = buildCompletion(makeWorld(done), "002", records);
  assert.deepEqual(completionSchema.parse(completion), completion);
  assert.equal(completion.summary, "It checks its work.");
  assert.equal(completion.sideThreads, 1);
  assert.equal(completion.adoptedAt, "2026-09-23T09:00:00Z");
  assert.equal(completion.next?.id, "003");
  assert.equal(completion.next?.factoryDiff?.length, fixtureCompletion.next?.factoryDiff === null ? 0 : 4);
  assert.throws(() => buildCompletion(makeWorld(fixtureFreshStudent), "002", records), /not complete/);
});

test("a past homework's completion counts carry-over from what was passing in that homework", () => {
  const one = findHomework(fixtureCourse, "001");
  const two = findHomework(fixtureCourse, "002");
  assert.ok(one !== undefined && two !== undefined);
  const passedInOne = new Set(homeworkExamples(one).map((example) => example.hash));
  const expected = homeworkExamples(two).filter((example) => passedInOne.has(example.hash)).length;
  assert.ok(expected > 0, "the fixture carries something from 001 into 002");
  const student: StudentState = {
    iteration: { iteration: "003", status: "WIP" },
    progress: {
      iteration: "003",
      examples: {},
      history: {
        "000": { examples: {} },
        "001": {
          examples: Object.fromEntries(
            homeworkExamples(one).map((example) => [example.key, { status: "passing", hash: example.hash, at: "2026-09-23T10:00:00Z" }]),
          ),
        },
        "002": { examples: {} },
      },
    },
    problems: [],
  };
  assert.equal(buildCompletion(makeWorld(student), "001", records).next?.carryOver, expected);
});
