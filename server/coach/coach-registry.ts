// The coach threads Tutor has seen, by id, with their lesson. configure is
// synchronous, so it cannot ask BB whether a side chat BB made ("Reply in side
// chat") forks a Tutor coach thread; it asks this instead. It only decides
// what is offered: every tool call re-checks the thread with BB (auth.ts).
export interface CoachRegistry {
  /** Records coach threads (role "coach") from a listing or a spawn. */
  remember(threads: readonly { id: string; role: string; lessonId: string }[]): void;
  /** The lesson of a coach thread Tutor has seen, else undefined. */
  lessonOf(threadId: string): string | undefined;
}

export function createCoachRegistry(): CoachRegistry {
  const lessons = new Map<string, string>();
  return {
    remember(threads) {
      for (const thread of threads) if (thread.role === "coach") lessons.set(thread.id, thread.lessonId);
    },
    lessonOf: (threadId) => lessons.get(threadId),
  };
}
