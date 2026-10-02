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

export type CourseLayoutState =
  | { id: null; ready: true; progress: ProgressLocation; problems: []; blocked: null }
  | { id: "capstone-factory"; ready: boolean; layout: Layout; progress: ProgressLocation; problems: string[]; blocked: string | null };

/** What a lesson of a course whose layout isn't ready says instead of starting. */
export const NOT_READY = "This lesson needs the course's starter files in your workspace. Add the course from the outline first.";

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
