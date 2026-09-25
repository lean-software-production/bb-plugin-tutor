// Which thread is each lesson's coach thread, kept in Tutor's own storage
// (`bb.storage.kv`) when openCoach finds or spawns it. Listing threads can
// miss one: `threads.list` pages by offset only, so a thread archived between
// two pages shifts the rest past the reader. The record is read first, and
// only trusted while BB still has the thread as that lesson's live coach
// thread; otherwise openCoach falls back to the listing. The coach-thread
// lock (lock-keys.ts) covers the whole find-or-spawn, record included.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isTutorCoachThread } from "./auth.ts";
import { toTutorThread } from "./threads.ts";

export interface LessonCoach {
  projectId: string;
  courseId: string;
  lessonId: string;
}

interface CoachRecord {
  threadId: string;
}

export function coachRecordKey(lesson: LessonCoach): string {
  return `coach-thread:${lesson.projectId}:${lesson.courseId}:${lesson.lessonId}`;
}

function isCoachRecord(value: unknown): value is CoachRecord {
  return typeof value === "object" && value !== null && typeof (value as { threadId?: unknown }).threadId === "string";
}

/**
 * The recorded coach thread of the lesson, when BB still has it as Tutor's
 * live coach thread of that course and lesson in that project; else null.
 */
export async function recordedCoachThread(bb: BbPluginApi, lesson: LessonCoach): Promise<string | null> {
  const record = await bb.storage.kv.get<unknown>(coachRecordKey(lesson)).catch(() => undefined);
  if (!isCoachRecord(record)) return null;
  const thread = await bb.sdk.threads.get({ threadId: record.threadId }).catch(() => null);
  if (thread === null || thread.archivedAt !== null || thread.projectId !== lesson.projectId || !isTutorCoachThread(thread, bb.pluginId)) {
    return null;
  }
  const metadata = await bb.sdk.threads.getPluginMetadata({ pluginId: bb.pluginId, threadId: thread.id }).catch(() => null);
  const coach = toTutorThread(thread, metadata);
  return coach?.role === "coach" && coach.courseId === lesson.courseId && coach.lessonId === lesson.lessonId ? thread.id : null;
}

/** Records the lesson's coach thread. Failing to is logged, not fatal: the listing still finds it. */
export async function recordCoachThread(bb: BbPluginApi, lesson: LessonCoach, threadId: string): Promise<void> {
  const record: CoachRecord = { threadId };
  try {
    await bb.storage.kv.set(coachRecordKey(lesson), record);
  } catch (cause) {
    bb.log.warn(`[tutor] could not record the coach thread of lesson ${lesson.lessonId}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
