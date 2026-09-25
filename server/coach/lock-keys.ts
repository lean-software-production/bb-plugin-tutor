// Keys for TutorRuntime.locks, so the tools and the RPC handlers agree on them.

/** Changes to the student's files in one factory repo. */
export function factoryLockKey(root: string): string {
  return `factory:${root}`;
}

/** Finding or spawning one homework's main coach thread in one project. */
export function mainThreadLockKey(projectId: string, courseId: string, homeworkId: string): string {
  return `main:${projectId}:${courseId}:${homeworkId}`;
}
