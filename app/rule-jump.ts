// The DOM side of jumping to a Rule's section (model/rule-jump.ts holds the
// loop). It opens the coach thread in BB's thread view, finds the timeline by
// what BB renders (timeline rows whose id starts with the thread's id, and
// their scrollable ancestor), never by BB's hashed class names, and brings the
// Rule card into view. One jump at a time: a new one cancels the last.
import { toast } from "sonner";
import { RULE_ANCHOR_ATTRIBUTE, ruleAnchor } from "../shared/directives.ts";
import { findRuleSection } from "./model/rule-jump.ts";

export const NOT_FOUND_MESSAGE = "Couldn't find where your coach started this Rule.";
const HIGHLIGHT_CLASS = "tp-anchor-flash";
const HIGHLIGHT_MS = 1800;
/** How long navigation may take to reach the coach thread before the jump counts as abandoned. */
const ARRIVAL_GRACE_MS = 4000;

export interface RuleTarget {
  coachThreadId: string;
  lessonId: string;
  ruleKey: string;
}

let current: { cancel: () => void } | null = null;

function scrollable(element: Element): boolean {
  const style = getComputedStyle(element);
  return (style.overflowY === "auto" || style.overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1;
}

/** The scroller holding the coach thread's timeline rows. */
export function timelineScroller(coachThreadId: string): HTMLElement | null {
  const rows = document.querySelectorAll(`[data-timeline-row-id^="${CSS.escape(`${coachThreadId}:`)}"]`);
  for (const row of rows) {
    for (let element = row.parentElement; element !== null; element = element.parentElement) {
      if (scrollable(element)) return element;
    }
  }
  return null;
}

function onCoachThread(coachThreadId: string): boolean {
  return window.location.pathname.split("/").includes(coachThreadId);
}

/**
 * Opens the coach thread (with `open`, BB's navigate.toThread) and scrolls to
 * where the coach started the Rule, loading older history on the way. Never
 * throws: a section that can't be found is a toast.
 */
export function jumpToRuleSection(target: RuleTarget, open: (threadId: string) => void): void {
  const anchor = ruleAnchor(target.coachThreadId, target.lessonId, target.ruleKey);
  if (anchor === null) return;
  current?.cancel();
  let cancelled = false;
  let arrived = onCoachThread(target.coachThreadId);
  const startedAt = Date.now();
  const cancelOnInput = (event: Event) => {
    if (event instanceof KeyboardEvent && !["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    cancelled = true;
  };
  const inputs = ["wheel", "touchmove", "keydown"] as const;
  for (const type of inputs) window.addEventListener(type, cancelOnInput, { capture: true, passive: true });
  const job = {
    cancel: () => {
      cancelled = true;
    },
  };
  current = job;
  if (!arrived) open(target.coachThreadId);

  const selector = `[${RULE_ANCHOR_ATTRIBUTE}="${CSS.escape(anchor)}"]`;
  void findRuleSection<HTMLElement, HTMLElement>({
    findAnchor: () => {
      // Only the coach thread's own timeline: a side chat panel can show the same messages.
      return timelineScroller(target.coachThreadId)?.querySelector<HTMLElement>(selector) ?? null;
    },
    findScroller: () => timelineScroller(target.coachThreadId),
    scrollToTop: (scroller) => {
      scroller.scrollTop = 0;
    },
    reveal: (element) => {
      element.scrollIntoView({ block: "start" });
      // BB may still be laying out the page it just loaded above; settle once more.
      window.setTimeout(() => {
        if (!cancelled) element.scrollIntoView({ block: "start" });
      }, 500);
      element.classList.add(HIGHLIGHT_CLASS);
      window.setTimeout(() => element.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
    },
    stillWanted: () => {
      if (cancelled || current !== job) return false;
      if (onCoachThread(target.coachThreadId)) arrived = true;
      else if (arrived || Date.now() - startedAt > ARRIVAL_GRACE_MS) return false;
      return true;
    },
    wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    now: () => Date.now(),
  })
    .then((result) => {
      if (result === "not-found") toast.error(NOT_FOUND_MESSAGE);
    })
    .catch(() => toast.error(NOT_FOUND_MESSAGE))
    .finally(() => {
      for (const type of inputs) window.removeEventListener(type, cancelOnInput, { capture: true });
      if (current === job) current = null;
    });
}
