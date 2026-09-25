import type { PastLesson, ProgressFile, StudentState } from "../../shared/model.ts";

/** The student's progress when it is about `lessonId`; stale progress counts as none. */
export function progressFor(student: StudentState, lessonId: string): ProgressFile | null {
  return student.progress?.iteration === lessonId ? student.progress : null;
}

/** What is recorded about `lessonId`: the current progress, or its entry in the history. */
export function recordedProgress(student: StudentState, lessonId: string): ProgressFile | PastLesson | null {
  return progressFor(student, lessonId) ?? student.progress?.history?.[lessonId] ?? null;
}
