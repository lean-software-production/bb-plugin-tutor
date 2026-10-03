// A course's layout in the workspace: what it expects to find there, whether
// it is there yet, and where the course keeps the student's progress.
//
// A course without a layout needs nothing in the workspace: it keeps its
// progress in a folder of its own under .tutor/. The capstone-factory layout
// is the capstone's factory (capstone-factory/detect.ts), and is ready once
// the workspace has a factory folder Tutor can use.
import { join } from "node:path";
import { capstoneProgress, resolveLayout, type Layout } from "./capstone-factory/detect.ts";
import type { LayoutProbe, ProgressLocation } from "./types.ts";

export type LayoutId = "capstone-factory";

/**
 * A fetched course whose starter is not all in the workspace yet (its seed
 * marker is not complete) is not ready either, whatever its layout, and says
 * NOT_READY: adding the course again finishes the seed (server/coach/world.ts).
 */
export type CourseLayoutState =
  | { id: null; ready: boolean; progress: ProgressLocation; problems: []; blocked: null }
  | { id: "capstone-factory"; ready: boolean; layout: Layout; progress: ProgressLocation; problems: string[]; blocked: string | null };

/** What a lesson of a course whose layout isn't ready says instead of starting. */
export const NOT_READY = "This lesson needs the course's starter files in your workspace. Finish adding the course from the outline first.";

/**
 * Why a course's own lessons can't start yet. A capstone factory Tutor can't
 * use says why in its own words (no factory folder: restore it from git; a
 * link or a file: make it a real folder), since there is nothing to add.
 * Anything else not ready needs the course's starter files.
 */
export function notReadyText(state: CourseLayoutState): string {
  return state.id === "capstone-factory" && state.blocked !== null ? state.blocked : NOT_READY;
}

/** `courseDir`: where a layoutless course keeps its files in the workspace, relative to it (".tutor/courses/<id>"). */
export async function resolveCourseLayout(
  id: LayoutId | null,
  workspaceRoot: string,
  courseDir: string,
  probe: LayoutProbe,
): Promise<CourseLayoutState> {
  if (id === null) {
    return {
      id: null,
      ready: true,
      progress: { dir: join(workspaceRoot, courseDir), progressFile: "progress.yaml", iterationFiles: ["ITERATION"] },
      problems: [],
      blocked: null,
    };
  }
  const layout = await resolveLayout(workspaceRoot, probe);
  return {
    id,
    // Every layout that is blocked lacks a factory folder Tutor can use: none at all, or one that is a link or a file.
    ready: layout.blocked === null,
    layout,
    progress: capstoneProgress(layout),
    problems: layout.problems,
    blocked: layout.blocked,
  };
}
