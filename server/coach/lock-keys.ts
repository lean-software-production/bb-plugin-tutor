// Keys for TutorRuntime.locks, so the tools and the RPC handlers agree on them.

/** Changes to the student's files in one factory repo. */
export function factoryLockKey(root: string): string {
  return `factory:${root}`;
}

/** Finding or spawning one lesson's main coach thread in one project. */
export function mainThreadLockKey(projectId: string, courseId: string, lessonId: string): string {
  return `main:${projectId}:${courseId}:${lessonId}`;
}
