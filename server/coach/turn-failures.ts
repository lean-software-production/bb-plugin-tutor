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

/** The most of an agent's message the outline quotes: past it, the message is cut with an ellipsis. */
export const MAX_QUOTED_FAILURE = 300;

export function failureText(message: string | null): string {
  const advice = "Sign in to another agent in your Codespace (Claude Code: `claude`), or choose a model under Settings → Plugins → Tutor → Coach model.";
  if (message === null) return `Your coach stopped. ${advice}`;
  const quoted = message.length > MAX_QUOTED_FAILURE ? `${message.slice(0, MAX_QUOTED_FAILURE).trimEnd()}…` : message;
  return `Your coach stopped: its agent said "${quoted}". ${advice}`;
}
