import type { PastHomework, ProgressFile, StudentState } from "../../shared/model.ts";

/** The student's progress when it is about `homeworkId`; stale progress counts as none. */
export function progressFor(student: StudentState, homeworkId: string): ProgressFile | null {
  return student.progress?.iteration === homeworkId ? student.progress : null;
}

/** What is recorded about `homeworkId`: the current progress, or its entry in the history. */
export function recordedProgress(student: StudentState, homeworkId: string): ProgressFile | PastHomework | null {
  return progressFor(student, homeworkId) ?? student.progress?.history?.[homeworkId] ?? null;
}
