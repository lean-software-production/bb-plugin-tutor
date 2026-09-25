// The coach threads Tutor has seen, by id, with their homework. configure is
// synchronous, so it cannot ask BB whether a side chat BB made ("Reply in side
// chat") forks a Tutor coach thread; it asks this instead. It only decides
// what is offered: every tool call re-checks the thread with BB (auth.ts).
export interface CoachRegistry {
  /** Records coach threads (role "main") from a listing or a spawn. */
  remember(threads: readonly { id: string; role: string; homeworkId: string }[]): void;
  /** The homework of a coach thread Tutor has seen, else undefined. */
  homeworkOf(threadId: string): string | undefined;
}

export function createCoachRegistry(): CoachRegistry {
  const homeworks = new Map<string, string>();
  return {
    remember(threads) {
      for (const thread of threads) if (thread.role === "main") homeworks.set(thread.id, thread.homeworkId);
    },
    homeworkOf: (threadId) => homeworks.get(threadId),
  };
}
