// The seams between backend modules owned by different builders.
//
//   CourseSource   implemented by server/course/ (CONTENT), consumed by the backend
//   ProgressStore  implemented by server/progress/ (BACKEND), consumed by server/coach/ and server/rpc/
import type { ProgressLocation } from "../layouts/types.ts";
import type { WorkspaceAccess } from "../server/workspace/access.ts";
import type { Course, IterationState, ProgressFile, StudentState } from "./model.ts";

/** Thrown by CourseSource.loadCourse; the message is shown to the student as-is. */
export class CourseLoadError extends Error {
  override name = "CourseLoadError";
}

export interface CourseSource {
  /**
   * Reads the course at `coursePath` from disk: course.yaml when present,
   * otherwise the ledger table in docs/iterations/README.md. Returns a fully
   * derived Course (Lesson 0 prepended; slugs, hashes, new/reworded changes,
   * suggestedRuleOrder, factoryDiff and lexicon filled in). Never caches:
   * callers decide when to re-read. Rejects with CourseLoadError when the path
   * is missing or holds neither a course.yaml nor a ledger; a malformed single
   * feature file is a CourseLoadError too, naming the file and line.
   */
  loadCourse(coursePath: string): Promise<Course>;
}

export interface ProgressStore {
  /**
   * Reads the location's ITERATION files (the first found; a capstone factory
   * falls back to an older spec/ITERATION) and its progress file, through
   * `access`. Never throws for bad content.
   */
  read(access: WorkspaceAccess, at: ProgressLocation): Promise<StudentState>;
  /** Writes the progress file whole, only if it is still what this call read (or still absent). */
  writeProgress(access: WorkspaceAccess, at: ProgressLocation, progress: ProgressFile): Promise<void>;
  /** Writes the first ITERATION file as "<NNN> <WIP|Done>\n", then removes the older ones. Refuses Lesson 0. */
  writeIteration(access: WorkspaceAccess, at: ProgressLocation, state: IterationState): Promise<void>;
}
