// Adding a course on request: the fetchCourse RPC and tutor_fetch_course run
// this one flow, and their callers hold the workspace lock (lock-keys.ts) for
// all of it, so a seed never races an adoption or another seed.
//
//   1. Fetch the course, then the starter its course.yaml names, into BB's data dir (server/content/store.ts).
//   2. Load the course, as the world will, under its catalog id (withCatalogId).
//   3. Record it as fetched, only once it has loaded with at least one lesson: a course that doesn't leaves no record.
//   4. If it has a starter, seed it into the workspace on the machine: only what is absent is written (Decision 10).
//      A seed that fails leaves the course recorded but unfinished: it is offered as "Finish adding the course".
//   5. Publish "course", so the outline lists its lessons after Lesson 0.
//
// A configured course wins (Decision 12): nothing is fetched then.
import { BUILTIN_COURSE_ID } from "../../shared/constants.ts";
import type { Course } from "../../shared/model.ts";
import { bundleFolder } from "../content/make-bundle.ts";
import { createContentStore, withCatalogId } from "../content/store.ts";
import { loadCourse } from "../course/load-course.ts";
import type { TutorRuntime } from "./runtime.ts";
import type { World } from "./world.ts";

/** The starter's own repo plumbing, never the student's. */
const NEVER_SEEDED = [".git", ".devcontainer", ".github"];

/** A seed can be thousands of files on a slow machine: well past a host call's default 30 seconds. */
export const SEED_TIMEOUT_MS = 120_000;

export const CONFIGURED_COURSE_TEXT = "This Tutor uses the course it was set up with.";

export interface AddedCourse {
  course: Course;
  /** The course's lessons start here (after Lesson 0). */
  firstLessonId: string;
  /** Null when the course has no starter. `written`: the starter's files now in the workspace; `kept`: there already with other content, left alone. */
  seeded: { written: number; kept: string[] } | null;
}

/** Fetches, loads and seeds the catalog's course `courseId` into `world`'s workspace. The caller holds the workspace lock. */
export async function addCourse(rt: TutorRuntime, world: World, courseId: string): Promise<AddedCourse> {
  if (world.coursePath !== null) throw new Error(CONFIGURED_COURSE_TEXT);
  if (world.workspace.status !== "found" || world.hostId === null) {
    throw new Error("No workspace is set up yet. Confirm it on the Course page, then add the course.");
  }
  const entry = world.catalog.find((candidate) => candidate.id === courseId);
  if (entry === undefined) {
    const ids = world.catalog.map((candidate) => candidate.id);
    throw new Error(`There is no course "${courseId}" to add.${ids.length === 0 ? "" : ` Courses you can add: ${ids.join(", ")}.`}`);
  }
  if (world.dataDir === null) throw new Error("Tutor can't add a course: it has no folder to keep courses in. Tell your course leader.");

  if (entry.id === BUILTIN_COURSE_ID) throw new Error(`The course "${courseId}" uses the id "${BUILTIN_COURSE_ID}", which is Tutor's own Lesson 0.`);

  const store = createContentStore(world.dataDir);
  const { coursePath, starterPath } = await store.fetch(entry);
  const course = withCatalogId(await loadCourse(coursePath), entry.id);
  const firstLessonId = course.lessons[0]?.id;
  if (firstLessonId === undefined) throw new Error(`The course "${course.title}" has no lessons.`);
  await store.record(entry, starterPath !== null);

  let seeded: AddedCourse["seeded"] = null;
  try {
    if (course.starter !== null && starterPath !== null) {
      const bundle = await bundleFolder(starterPath, { skip: [...NEVER_SEEDED, ...course.starter.exclude] });
      const result = await rt.host.seedWorkspace(
        world.hostId,
        { root: world.workspace.root, courseId: entry.id, ref: course.starter.ref, bundle },
        { timeoutMs: SEED_TIMEOUT_MS },
      );
      // A seed resumed after an interruption finds its earlier files as "same": they are the starter's too.
      seeded = { written: result.written.length + result.same.length, kept: result.kept };
    }
  } finally {
    // Recorded, seeded or not: the outline lists the course, or offers to finish adding it.
    rt.signals.publish("course", null);
  }
  return { course, firstLessonId, seeded };
}

/** What tutor_fetch_course tells the coach. */
export function addedCourseText(added: AddedCourse): string {
  const { title } = added.course;
  const lines = [`Added "${title}". Its lessons follow Lesson 0 in the outline.`];
  if (added.seeded !== null) {
    lines[0] += ` ${added.seeded.written} starter files are now in your workspace; commit them ("Add the ${title} starter") before you start its first lesson.`;
    if (added.seeded.kept.length > 0) lines.push(`These files were already there and were kept: ${added.seeded.kept.join(", ")}.`);
  }
  return lines.join("\n");
}
