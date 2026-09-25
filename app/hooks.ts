// React bindings for Tutor's shared state: cached RPC queries that refresh on
// the backend's change signal, actions with pending/error state, stores, and
// navigation inside the course page.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { NAV_PANEL_PATH, REALTIME_CHANNELS } from "../shared/constants.ts";
import type { TutorRoute } from "../shared/routes.ts";
import type { RpcContract } from "../shared/rpc.ts";
import { coursePath } from "./model/course-route.ts";
import { SIDE_CHAT_HINT } from "./model/side-chat.ts";
import { jumpToRuleSection, type RuleTarget } from "./rule-jump.ts";
import { withConnectionLossDetection } from "./model/rpc-errors.ts";
import { QUERY_KEYS, queryCache, staleKeys } from "./state/app-state.ts";
import { errorMessage } from "./state/query-cache.ts";
import type { QueryState } from "./state/query-cache.ts";
import type { Store } from "./state/store.ts";

/** Tutor's RPC client; a failure that did not come from BB rejects with ConnectionLostError. */
export function useTutorRpc() {
  const rpc = useRpc<RpcContract>();
  return useMemo(() => withConnectionLossDetection(rpc), [rpc]);
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

let pendingStale: ((key: string) => boolean)[] = [];

/** Several mounted surfaces hear the same signal; coalesce them into one refresh. */
function invalidateSoon(match: (key: string) => boolean): void {
  pendingStale.push(match);
  if (pendingStale.length > 1) return;
  queueMicrotask(() => {
    const matches = pendingStale;
    pendingStale = [];
    queryCache.invalidate((key) => matches.some((m) => m(key)));
  });
}

/**
 * Keeps cached results fresh: refetch on the backend's change signal and after
 * a reconnect, since signals are not replayed. Call once per slot root.
 */
export function useLiveRefresh(): void {
  useRealtime(REALTIME_CHANNELS.stateChanged, (signal) => invalidateSoon(staleKeys(signal)));
  const connection = useRealtimeConnectionState();
  const wasDisconnected = useRef(false);
  useEffect(() => {
    if (connection === "reconnecting") wasDisconnected.current = true;
    if (connection === "connected" && wasDisconnected.current) {
      wasDisconnected.current = false;
      invalidateSoon(() => true);
    }
  }, [connection]);
}

const LOADING: QueryState<never> = { status: "loading", data: null, error: null };

/** A cached query; `key` must identify `fetcher`'s input completely. */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>): QueryState<T> {
  const subscribe = useCallback(
    (listener: () => void) => (key === null ? () => undefined : queryCache.subscribe(key, listener)),
    [key],
  );
  const snapshot = useCallback(
    () => (key === null ? LOADING : queryCache.peek<T>(key)),
    [key],
  );
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const latestFetcher = useRef(fetcher);
  latestFetcher.current = fetcher;
  useEffect(() => {
    if (key !== null) queryCache.ensure(key, () => latestFetcher.current());
  }, [key]);
  return state;
}

export function useOverview() {
  const rpc = useTutorRpc();
  return useQuery(QUERY_KEYS.overview, () => rpc.call("getOverview", null));
}

export interface Action<A extends unknown[]> {
  run: (...args: A) => Promise<void>;
  pending: boolean;
  error: string | null;
}

/** A user-triggered call with pending and error state; the error message is the backend's. */
export function useAction<A extends unknown[]>(perform: (...args: A) => Promise<void>): Action<A> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const latest = useRef(perform);
  latest.current = perform;
  const run = useCallback(async (...args: A) => {
    setPending(true);
    setError(null);
    try {
      await latest.current(...args);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      if (mounted.current) setPending(false);
    }
  }, []);
  return { run, pending, error };
}

export interface CourseNavigateOptions {
  /** For redirects, so back does not bounce. */
  replace?: boolean;
  /** A lesson's Rule to open, kept in the URL. */
  ruleKey?: string | null;
}

/** Navigate inside the course page. */
export function useCourseNavigate(): (route: TutorRoute, options?: CourseNavigateOptions) => void {
  const navigate = useBbNavigate();
  return useCallback(
    (route, options) =>
      navigate.toPluginPanel(NAV_PANEL_PATH, { subPath: coursePath(route, options?.ruleKey ?? null), replace: options?.replace }),
    [navigate],
  );
}

/** Refetch everything after a mutation instead of waiting for the backend's signal. */
export function refreshAll(): void {
  invalidateSoon(() => true);
}

/** Opens the coach thread at a Rule's section, loading older history as needed (app/rule-jump.ts). */
export function useOpenRule(): (target: RuleTarget) => void {
  const navigate = useBbNavigate();
  return useCallback((target) => jumpToRuleSection(target, (threadId) => navigate.toThread(threadId)), [navigate]);
}

/**
 * "Ask a side question": a BB side chat of the lesson's coach thread, then the
 * coach thread with a pointer to its "Side chat" tab (a plugin cannot select
 * that tab itself).
 */
export function useAskSideQuestion(onDone: () => void = () => undefined): Action<[lessonId: string, ruleKey: string | null]> {
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  return useAction(async (lessonId: string, ruleKey: string | null) => {
    const { coachThreadId } = await rpc.call("startSideChat", { lessonId, ruleKey });
    refreshAll();
    navigate.toThread(coachThreadId);
    toast.success(SIDE_CHAT_HINT);
    onDone();
  });
}

/** Opens a side chat: its coach thread, with the side chat's tab put back if it was closed. */
export function useOpenSideChat(): Action<[sideChatId: string]> {
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  return useAction(async (sideChatId: string) => {
    const { coachThreadId } = await rpc.call("ensureSideChatTab", { sideChatId });
    navigate.toThread(coachThreadId);
    toast.message(SIDE_CHAT_HINT);
  });
}
