// The window-wide client state that Tutor's separate slot trees share.
import type { TutorRoute } from "../../shared/routes.ts";
import { createQueryCache } from "./query-cache.ts";
import { createStore } from "./store.ts";

/** RPC results, shared by the rail, the course page, the home section and the directives. */
export const queryCache = createQueryCache();

/** The Tutor route on screen, published by the course page; null elsewhere in BB. */
export const routeStore = createStore<TutorRoute | null>(null);

/** A Rule the rail asked the lesson to open and scroll to; the lesson takes it once. */
export interface RuleRequest {
  homeworkId: string;
  ruleKey: string;
  /** Distinguishes two requests for the same Rule. */
  seq: number;
}
export const ruleRequestStore = createStore<RuleRequest | null>(null);

let requestSeq = 0;
export function requestRule(homeworkId: string, ruleKey: string): void {
  requestSeq += 1;
  ruleRequestStore.set({ homeworkId, ruleKey, seq: requestSeq });
}

/** The pending request for this homework's lesson, cleared so a remount never replays it. */
export function takeRuleRequest(homeworkId: string): RuleRequest | null {
  const request = ruleRequestStore.get();
  if (request === null || request.homeworkId !== homeworkId) return null;
  ruleRequestStore.set(null);
  return request;
}

/** Whether the course rail is the selected sidebar list (it only mounts when it is). */
export const railMountedStore = createStore(false);

export const QUERY_KEYS = {
  overview: "overview",
  lexicon: "lexicon",
  candidates: "candidates",
  lesson: (homeworkId: string) => `lesson:${homeworkId}`,
  completion: (homeworkId: string) => `completion:${homeworkId}`,
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
