// Keys for TutorRuntime.locks, so the tools and the RPC handlers agree on them.

/** Changes to the student's files in one workspace, whichever course they belong to. */
export function workspaceLockKey(root: string): string {
  return `workspace:${root}`;
}

/** Finding or spawning one lesson's coach thread in one project. */
export function coachThreadLockKey(projectId: string, courseId: string, lessonId: string): string {
  return `coach:${projectId}:${courseId}:${lessonId}`;
}
