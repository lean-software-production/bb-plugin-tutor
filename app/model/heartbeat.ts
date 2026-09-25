// When the page tells the backend the student is using BB. GitHub stops an
// idle Codespace on its own timer, and browser traffic through the forwarded
// port does not reset it, so the tutor feature's keep-alive reads the stamp
// these heartbeats leave behind (see ACTIVITY_FILE in shared/constants.ts).

/** Interaction older than this does not count as using BB. */
export const ACTIVE_WINDOW_MS = 60_000;
/** At most one heartbeat per window this often. */
export const HEARTBEAT_INTERVAL_MS = 45_000;

/**
 * DOM events that only the student's own input produces. Not `focusin` or
 * `scroll`: BB autofocuses its composer on every page load, and the lesson
 * scrolls itself to the latest message while the coach writes, so both fire
 * with nobody at the keyboard. Scrolling by hand arrives as one of these.
 */
export const STUDENT_INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export interface HeartbeatState {
  visible: boolean;
  lastInteractionAt: number | null;
  lastSentAt: number | null;
}

export function shouldSendHeartbeat(state: HeartbeatState, now: number): boolean {
  if (!state.visible || state.lastInteractionAt === null) return false;
  if (now - state.lastInteractionAt > ACTIVE_WINDOW_MS) return false;
  return state.lastSentAt === null || now - state.lastSentAt >= HEARTBEAT_INTERVAL_MS;
}

export interface HeartbeatTrackerDeps {
  now: () => number;
  visible: () => boolean;
  /** Fire and forget; a failure is not retried before the next interval. */
  send: () => void;
}

export interface HeartbeatTracker {
  /** The student pressed a key, moved or clicked the pointer, turned the wheel, touched the screen or came back to the tab. */
  interacted(): void;
  /** Periodic check, so a student who keeps working keeps the stamp fresh. */
  tick(): void;
}

export function createHeartbeatTracker({ now, visible, send }: HeartbeatTrackerDeps): HeartbeatTracker {
  let lastInteractionAt: number | null = null;
  let lastSentAt: number | null = null;
  const maybeSend = () => {
    const at = now();
    if (!shouldSendHeartbeat({ visible: visible(), lastInteractionAt, lastSentAt }, at)) return;
    lastSentAt = at;
    try {
      send();
    } catch {
      // Counted as sent: a lost connection must not turn every keypress into a request.
    }
  };
  return {
    interacted() {
      lastInteractionAt = now();
      maybeSend();
    },
    tick: maybeSend,
  };
}
