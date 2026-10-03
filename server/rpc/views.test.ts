import assert from "node:assert/strict";
import { test } from "node:test";
import { findLesson, lessonExamples } from "../../shared/derive.ts";
import {
  fixtureCompletion,
  fixtureCourse,
  fixtureFreshStudent,
  fixtureLessonDetail,
  fixtureOverview,
  fixtureOverviewNoFactory,
  fixtureReachedRules,
  fixtureStudent,
  fixtureThreads,
} from "../../shared/fixtures.ts";
import type { StudentState } from "../../shared/model.ts";
import { completionSchema, lessonDetailSchema, overviewSchema } from "../../shared/rpc.ts";
import { makeWorld } from "../../test/helpers/world.ts";
import type { TutorThreadRecord } from "../coach/threads.ts";
import { buildCompletion, buildLessonDetail, buildOverview } from "./views.ts";

const records: TutorThreadRecord[] = fixtureThreads.map((thread, index) => ({
  ...thread,
  projectId: "prj_factory",
  createdAt: 100 - index,
  reachedRules: thread.id === "thr_coach002" ? fixtureReachedRules : [],
}));

test("the overview matches the fixture the frontend was built against", () => {
  const overview = buildOverview(makeWorld(), records);
  assert.deepEqual(overviewSchema.parse(overview), overview);
  assert.deepEqual(overview, fixtureOverview);
});

test("no factory project: each course's lessons are listed from a fresh start, with no current state or threads", () => {
  assert.deepEqual(buildOverview(makeWorld(fixtureStudent, { status: "unset" }), records), fixtureOverviewNoFactory);
});

test("a course that will not load still gives an overview, with the built-in course and why", () => {
  const world = makeWorld();
  const overview = buildOverview(
    { ...world, available: world.available.slice(0, 1), courses: world.courses.slice(0, 1), courseErrors: [{ source: "/x", error: "No course at /x." }] },
    records,
  );
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor"]);
  assert.deepEqual(overview.courseErrors, [{ source: "/x", error: "No course at /x." }]);
  assert.deepEqual(overview.threads, [], "the missing course's threads are not listed");
});

test("a Lesson 0 coach thread an older Tutor recorded under the course counts as the built-in course's", () => {
  const old: TutorThreadRecord = { ...records[0]!, id: "thr_old0", courseId: "tutor", lessonId: "000", createdAt: 1 };
  const overview = buildOverview(makeWorld(), [...records, old]);
  assert.equal(overview.courses[0]?.lessons[0]?.coachThreadId, "thr_old0");
  assert.equal(overview.threads.find((thread) => thread.id === "thr_old0")?.courseId, "tutor");
});

test("the current lesson carries progress, focus and its coach thread", () => {
  const detail = buildLessonDetail(makeWorld(), fixtureCourse.id, "002", records);
  assert.deepEqual(lessonDetailSchema.parse(detail), detail);
  assert.deepEqual(detail, fixtureLessonDetail);
  const ahead = buildLessonDetail(makeWorld(), fixtureCourse.id, "003", records);
  assert.equal(ahead.status, "ahead");
  assert.deepEqual(ahead.progress, {});
  assert.equal(ahead.iterationStatus, null);
  assert.throws(() => buildLessonDetail(makeWorld(), fixtureCourse.id, "009", records), /no lesson 009/);
});

test("completion describes the finished lesson and what comes next", () => {
  const progress = fixtureStudent.progress;
  assert.ok(progress !== null);
  const done: StudentState = {
    iteration: { iteration: "002", status: "Done" },
    progress: { ...progress, summary: "It checks its work." },
    problems: [],
  };
  const completion = buildCompletion(makeWorld(done), fixtureCourse.id, "002", records);
  assert.deepEqual(completionSchema.parse(completion), completion);
  assert.equal(completion.summary, "It checks its work.");
  assert.equal(completion.sideChats, 1);
  assert.equal(completion.adoptedAt, "2026-09-23T09:00:00Z");
  assert.equal(completion.next?.id, "003");
  assert.equal(completion.next?.factoryDiff?.length, fixtureCompletion.next?.factoryDiff === null ? 0 : 4);
  assert.throws(() => buildCompletion(makeWorld(fixtureFreshStudent), fixtureCourse.id, "002", records), /not complete/);
});

test("a past lesson's completion counts carry-over from what was passing in that lesson", () => {
  const one = findLesson(fixtureCourse, "001");
  const two = findLesson(fixtureCourse, "002");
  assert.ok(one !== undefined && two !== undefined);
  const passedInOne = new Set(lessonExamples(one).map((example) => example.hash));
  const expected = lessonExamples(two).filter((example) => passedInOne.has(example.hash)).length;
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
            lessonExamples(one).map((example) => [example.key, { status: "passing", hash: example.hash, at: "2026-09-23T10:00:00Z" }]),
          ),
        },
        "002": { examples: {} },
      },
    },
    problems: [],
  };
  assert.equal(buildCompletion(makeWorld(student), fixtureCourse.id, "001", records).next?.carryOver, expected);
});

test("after Lesson 0, what comes next is the first lesson (ahead until started, so the page says Start) of the course that follows it, with nothing carried over", () => {
  const completion = buildCompletion(makeWorld(fixtureFreshStudent), "tutor", "000", records);
  assert.deepEqual(completionSchema.parse(completion), completion);
  assert.equal(completion.summary, "You know your way around.");
  assert.deepEqual([completion.next?.courseId, completion.next?.id, completion.next?.status, completion.next?.carryOver], ["software-factory", "001", "ahead", 0]);
});
