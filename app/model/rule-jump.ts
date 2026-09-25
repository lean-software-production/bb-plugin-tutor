// Jumping to a Rule's section of the coach thread. BB's thread view loads
// history lazily: an early message is not in the DOM until the timeline has
// been scrolled up far enough for BB to load older pages. So the search polls
// for the Rule card's anchor and, while it is missing, scrolls the timeline to
// its top to make BB load more, until the anchor turns up, time runs out or
// it has asked for a bounded number of loads. An unchanged history height does
// not end it: BB can show its loading row for seconds before an older page
// arrives. The DOM work is injected (app/rule-jump.ts), so the loop itself is
// testable.

export interface JumpHooks<Anchor, Scroller> {
  /** The Rule card's anchor in the coach thread's timeline, or null while it is not rendered. */
  findAnchor(): Anchor | null;
  /** The coach thread's timeline scroller, or null while the thread has not rendered. */
  findScroller(): Scroller | null;
  /** Scrolls the timeline to its top, which makes BB load older history. */
  scrollToTop(scroller: Scroller): void;
  /** Scrolls the anchor to the top of the view and highlights it. */
  reveal(anchor: Anchor): void;
  /** False once the student has left the coach thread or scrolled it themselves. */
  stillWanted(): boolean;
  wait(ms: number): Promise<void>;
  now(): number;
}

export interface JumpOptions {
  /** Give up after this long. */
  timeoutMs: number;
  /** How often to look while the thread renders. */
  pollMs: number;
  /** How long to let BB load after each scroll to the top. */
  loadWaitMs: number;
  /** Looks before the first scroll to the top, so an anchor already loaded is found without one. */
  settlePolls: number;
  /** Scrolls to the top before the search stops, in case the clock never reaches the deadline. */
  maxLoads: number;
}

export const DEFAULT_JUMP_OPTIONS: JumpOptions = {
  timeoutMs: 20_000,
  pollMs: 150,
  loadWaitMs: 700,
  settlePolls: 4,
  // More than fit in timeoutMs, so the deadline is what normally ends a search.
  maxLoads: 40,
};

export type JumpResult = "found" | "cancelled" | "not-found";

export async function findRuleSection<Anchor, Scroller>(
  hooks: JumpHooks<Anchor, Scroller>,
  options: JumpOptions = DEFAULT_JUMP_OPTIONS,
): Promise<JumpResult> {
  const deadline = hooks.now() + options.timeoutMs;
  let settled = 0;
  let loads = 0;
  for (;;) {
    if (!hooks.stillWanted()) return "cancelled";
    const anchor = hooks.findAnchor();
    if (anchor !== null) {
      hooks.reveal(anchor);
      return "found";
    }
    if (hooks.now() >= deadline) return "not-found";
    const scroller = hooks.findScroller();
    if (scroller === null || settled < options.settlePolls) {
      if (scroller !== null) settled += 1;
      await hooks.wait(options.pollMs);
      continue;
    }
    if (loads >= options.maxLoads) return "not-found";
    loads += 1;
    hooks.scrollToTop(scroller);
    await hooks.wait(options.loadWaitMs);
  }
}
