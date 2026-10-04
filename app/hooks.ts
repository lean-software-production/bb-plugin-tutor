// React bindings for Tutor's shared state: cached RPC queries that refresh on
// the backend's change signal, actions with pending/error state, stores, and
// navigation inside the course page.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { BUILTIN_COURSE_ID, BUILTIN_LESSON_ID, NAV_PANEL_PATH, REALTIME_CHANNELS } from "../shared/constants.ts";
import type { TutorRoute } from "../shared/routes.ts";
import type { RpcContract } from "../shared/rpc.ts";
import { coursePath, routeCourse } from "./model/course-route.ts";
import { addedCourseRoute } from "./model/home.ts";
import { awaitingAgentSignIn, coachGate, type CoachGate } from "./model/outline.ts";
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

/** How often a page with a waiting coach button asks again whether an agent is signed in. */
const AGENT_POLL_MS = 10_000;

/**
 * The overview's coach gate (coachGate), kept fresh while it waits: signing in
 * to an agent in the Codespace's terminal sends Tutor no signal, so while
 * none is ready, refetch the overview on window focus and every 10 s.
 */
export function useCoachGate(): CoachGate {
  const overview = useOverview();
  const agentState = overview.data?.coachAgent ?? null;
  const waiting = awaitingAgentSignIn(agentState);
  useEffect(() => {
    if (!waiting) return;
    const refetch = () => queryCache.invalidate((key) => key === QUERY_KEYS.overview);
    const timer = window.setInterval(refetch, AGENT_POLL_MS);
    window.addEventListener("focus", refetch);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refetch);
    };
  }, [waiting]);
  return coachGate(agentState);
}

/**
 * The course of a lesson a message in `threadId` names (a directive): the
 * thread's own course, from getThreadContext, when the thread is Tutor's;
 * otherwise the course a link from before courses would mean (routeCourse).
 * Null until it is known.
 */
export function useLessonCourse(threadId: string, lessonId: string | null): string | null {
  const rpc = useTutorRpc();
  const context = useQuery(QUERY_KEYS.threadContext(threadId), () => rpc.call("getThreadContext", { threadId }));
  const overview = useOverview();
  if (lessonId === null) return null;
  const thread = context.data?.thread ?? null;
  // Lesson 0 is the built-in course's in any thread; the thread's course holds its other lessons.
  if (thread !== null && lessonId !== BUILTIN_LESSON_ID && thread.courseId !== BUILTIN_COURSE_ID) return thread.courseId;
  if (context.status === "loading" && lessonId !== BUILTIN_LESSON_ID) return null;
  return routeCourse(null, lessonId, overview.data?.courses ?? []);
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

/**
 * "Add the course" (or "Finish adding the course"): fetchCourse, then the
 * first lesson's start page under the course id the server returns. The
 * outline, BB home and the completion page all use this one action.
 */
export function useAddCourse(courseId: string | null): Action<[]> {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  return useAction(async () => {
    if (courseId === null) return;
    const added = await rpc.call("fetchCourse", { courseId });
    refreshAll();
    goCourse(addedCourseRoute(added));
  });
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
export function useAskSideQuestion(
  onDone: () => void = () => undefined,
): Action<[courseId: string, lessonId: string, ruleKey: string | null]> {
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  return useAction(async (courseId: string, lessonId: string, ruleKey: string | null) => {
    const { coachThreadId } = await rpc.call("startSideChat", { courseId, lessonId, ruleKey });
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
