// The seams between backend modules owned by different builders.
//
//   CourseSource   implemented by server/course/ (CONTENT), consumed by the backend
//   ProgressStore  implemented by server/progress/ (BACKEND), consumed by server/coach/ and server/rpc/
import type { Course, IterationState, ProgressFile, StudentState } from "./model.ts";

/** Thrown by CourseSource.loadCourse; the message is shown to the student as-is. */
export class CourseLoadError extends Error {
  override name = "CourseLoadError";
}

export interface CourseSource {
  /**
   * Reads the course at `coursePath` from disk: course.yaml when present,
   * otherwise the ledger table in docs/iterations/README.md. Returns a fully
   * derived Course (Lesson 0 prepended; slugs, hashes, novelty,
   * suggestedRuleOrder, factoryDiff and lexicon filled in). Never caches:
   * callers decide when to re-read. Rejects with CourseLoadError when the path
   * is missing or holds neither a course.yaml nor a ledger; a malformed single
   * feature file is a CourseLoadError too, naming the file and line.
   */
  loadCourse(coursePath: string): Promise<Course>;
}

export interface ProgressStore {
  /** Reads spec/ITERATION and spec/PROGRESS.yaml under `factoryRoot`. Never throws for bad content. */
  read(factoryRoot: string): Promise<StudentState>;
  /** Writes spec/PROGRESS.yaml atomically (temp file + rename). */
  writeProgress(factoryRoot: string, progress: ProgressFile): Promise<void>;
  /** Writes spec/ITERATION as "<NNN> <WIP|Done>\n". Refuses Lesson 0. */
  writeIteration(factoryRoot: string, state: IterationState): Promise<void>;
}
