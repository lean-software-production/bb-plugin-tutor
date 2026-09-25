// The window-wide client state that Tutor's separate slot trees share.
import type { TutorRoute } from "../../shared/routes.ts";
import { createQueryCache } from "./query-cache.ts";
import { createStore } from "./store.ts";

/** RPC results, shared by the course outline, the course page, the home section and the directives. */
export const queryCache = createQueryCache();

/** The Tutor route on screen, published by the course page; null elsewhere in BB. */
export const routeStore = createStore<TutorRoute | null>(null);

/** Whether the course outline is the selected sidebar list (it only mounts when it is). */
export const railMountedStore = createStore(false);

export const QUERY_KEYS = {
  overview: "overview",
  lexicon: "lexicon",
  candidates: "candidates",
  lessonDetail: (lessonId: string) => `lessonDetail:${lessonId}`,
  completion: (lessonId: string) => `completion:${lessonId}`,
  threadContext: (threadId: string) => `thread:${threadId}`,
} as const;

/**
 * Which cached results a backend change signal makes stale. The payload is
 * only a hint, so anything unrecognised refreshes everything; the lexicon
 * only changes with the course.
 */
export function staleKeys(signal: unknown): (key: string) => boolean {
  const reason =
    typeof signal === "object" && signal !== null && "reason" in signal ? (signal as { reason: unknown }).reason : null;
  if (reason === "course" || typeof reason !== "string") return () => true;
  return (key) => key !== QUERY_KEYS.lexicon;
}
