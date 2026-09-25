// One cache of RPC results for every Tutor surface in the window. The rail,
// the course page and the home section all read getOverview; this makes them
// share one request and one refetch when the backend signals a change.
// Mounting a surface revalidates its data in the background (the old answer
// stays on screen), because the course and spec/ can change outside BB
// without a signal. Errors are never cached: the next mount retries.

export type QueryState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: T | null; error: string };

interface Entry {
  state: QueryState<unknown>;
  inFlight: Promise<void> | null;
  stale: boolean;
  /** When the last successful answer arrived; null before one, and after an error. */
  settledAt: number | null;
  fetcher: (() => Promise<unknown>) | null;
  listeners: Set<() => void>;
}

const LOADING: QueryState<never> = { status: "loading", data: null, error: null };

/** Surfaces that mount this close together share one answer instead of each revalidating. */
export const SHARE_WINDOW_MS = 3_000;

export interface QueryCacheOptions {
  now?: () => number;
}

export interface QueryCache {
  /** Current state, without side effects (a useSyncExternalStore snapshot). */
  peek<T>(key: string): QueryState<T>;
  /**
   * Remembers how to fetch `key` and fetches it unless an answer is in flight
   * or arrived within SHARE_WINDOW_MS. Call it when a surface mounts.
   */
  ensure(key: string, fetcher: () => Promise<unknown>): void;
  subscribe(key: string, listener: () => void): () => void;
  /** Marks matching keys stale and refetches the ones someone is watching. */
  invalidate(match?: (key: string) => boolean): void;
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim() !== "") return cause.message;
  if (typeof cause === "string" && cause.trim() !== "") return cause;
  return "Something went wrong.";
}

export function createQueryCache({ now = Date.now }: QueryCacheOptions = {}): QueryCache {
  const entries = new Map<string, Entry>();

  const entryFor = (key: string): Entry => {
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = { state: LOADING, inFlight: null, stale: true, settledAt: null, fetcher: null, listeners: new Set() };
      entries.set(key, entry);
    }
    return entry;
  };

  const notify = (entry: Entry) => {
    for (const listener of [...entry.listeners]) listener();
  };

  const load = (entry: Entry) => {
    const fetcher = entry.fetcher;
    if (fetcher === null || entry.inFlight !== null) return;
    entry.stale = false;
    entry.inFlight = fetcher().then(
      (data) => {
        entry.state = { status: "ready", data, error: null };
        entry.settledAt = now();
      },
      (cause: unknown) => {
        entry.settledAt = null;
        entry.state = { status: "error", data: entry.state.data, error: errorMessage(cause) };
      },
    ).finally(() => {
      entry.inFlight = null;
      notify(entry);
      // A change signalled mid-flight must not be lost behind the older answer.
      if (entry.stale && entry.listeners.size > 0) load(entry);
    });
  };

  return {
    peek<T>(key: string): QueryState<T> {
      return (entries.get(key)?.state ?? LOADING) as QueryState<T>;
    },
    ensure(key, fetcher) {
      const entry = entryFor(key);
      entry.fetcher = fetcher;
      const fresh = entry.settledAt !== null && now() - entry.settledAt < SHARE_WINDOW_MS;
      if (entry.stale || !fresh) load(entry);
    },
    subscribe(key, listener) {
      const entry = entryFor(key);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    invalidate(match = () => true) {
      for (const [key, entry] of entries) {
        if (!match(key)) continue;
        entry.stale = true;
        if (entry.listeners.size > 0) load(entry);
      }
    },
  };
}
