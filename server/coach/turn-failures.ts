// The last failed turn of each coach thread, so the outline can say why the
// coach stopped. Cleared when the thread next goes idle after a good turn.
export interface TurnFailures {
  record(threadId: string, message: string | null): void;
  clear(threadId: string): void;
  get(threadId: string): string | null;
}

export function createTurnFailures(): TurnFailures {
  const failures = new Map<string, string | null>();
  return {
    record(threadId, message) {
      failures.set(threadId, message);
    },
    clear(threadId) {
      failures.delete(threadId);
    },
    get(threadId) {
      return failures.has(threadId) ? failureText(failures.get(threadId) ?? null) : null;
    },
  };
}

export function failureText(message: string | null): string {
  const advice = "Sign in to another agent in your Codespace (Claude Code: `claude`), or choose a model under Settings → Tutor → Coach model.";
  return message === null ? `Your coach stopped. ${advice}` : `Your coach stopped: its agent said "${message}". ${advice}`;
}
