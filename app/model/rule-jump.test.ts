import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_JUMP_OPTIONS, findRuleSection, type JumpHooks, type JumpOptions } from "./rule-jump.ts";

const OPTIONS: JumpOptions = { timeoutMs: 10_000, pollMs: 100, loadWaitMs: 500, settlePolls: 2, maxLoads: 40 };

/**
 * A fake thread view: `renderAt` is when the timeline appears; each scroll to
 * the top loads one more page of history (up to `pages`), `loadDelayMs` after
 * the scroll that asked for it (the height stays the same meanwhile); the
 * anchor sits on page `anchorPage` (0 = already loaded), or nowhere when null.
 * `frozenClock` makes `now()` stand still, as a clock that never reaches the
 * deadline.
 */
function fakeThread({
  renderAt = 0,
  pages = 5,
  anchorPage = 0 as number | null,
  wantedUntil = Number.POSITIVE_INFINITY,
  loadDelayMs = 0,
  frozenClock = false,
  maxScrolls = Number.POSITIVE_INFINITY,
} = {}) {
  let clock = 0;
  let loaded = 0;
  let pendingSince: number | null = null;
  let scrolls = 0;
  const log: string[] = [];
  const hooks: JumpHooks<string, string> = {
    findAnchor: () => (clock >= renderAt && anchorPage !== null && loaded >= anchorPage ? "anchor" : null),
    findScroller: () => (clock >= renderAt ? "scroller" : null),
    scrollToTop: () => {
      log.push(`top@${clock}`);
      scrolls += 1;
      pendingSince ??= clock;
    },
    reveal: (anchor) => log.push(`reveal ${anchor}`),
    // The test's own safety net: a search that never stops is cancelled here, and fails its assertions.
    stillWanted: () => clock < wantedUntil && scrolls < maxScrolls,
    wait: async (ms) => {
      clock += ms;
      if (pendingSince !== null && clock >= pendingSince + loadDelayMs) {
        if (loaded < pages) loaded += 1;
        pendingSince = null;
      }
    },
    now: () => (frozenClock ? 0 : clock),
  };
  return { hooks, log, loaded: () => loaded };
}

test("an anchor already on screen is revealed without loading anything", async () => {
  const thread = fakeThread({ renderAt: 300 });
  assert.equal(await findRuleSection(thread.hooks, OPTIONS), "found");
  assert.deepEqual(thread.log, ["reveal anchor"]);
});

test("an early Rule is found by scrolling up until BB has loaded its page", async () => {
  const thread = fakeThread({ anchorPage: 3 });
  assert.equal(await findRuleSection(thread.hooks, OPTIONS), "found");
  assert.equal(thread.loaded(), 3);
  assert.equal(thread.log.filter((entry) => entry.startsWith("top@")).length, 3);
  assert.equal(thread.log.at(-1), "reveal anchor");
});

test("the search waits a moment before scrolling, so a section being rendered is not overshot", async () => {
  const thread = fakeThread({ anchorPage: 1 });
  await findRuleSection(thread.hooks, OPTIONS);
  assert.equal(thread.log[0], "top@200", "two settle polls first");
});

test("a page BB is slow to load is still found: an unchanged height doesn't end the search before the deadline", async () => {
  // BB's spinner keeps the height the same for 3.5 s, longer than three load waits.
  const thread = fakeThread({ anchorPage: 1, loadDelayMs: 3500 });
  assert.equal(await findRuleSection(thread.hooks, DEFAULT_JUMP_OPTIONS), "found");
  assert.equal(thread.loaded(), 1);
  assert.equal(thread.log.at(-1), "reveal anchor");
});

test("when the anchor never appears, it keeps loading until the deadline, then reports not found", async () => {
  const thread = fakeThread({ anchorPage: null, pages: 2 });
  const { timeoutMs } = DEFAULT_JUMP_OPTIONS;
  assert.equal(await findRuleSection(thread.hooks, DEFAULT_JUMP_OPTIONS), "not-found");
  assert.equal(thread.loaded(), 2);
  assert.ok(thread.hooks.now() >= timeoutMs, `gave up at ${thread.hooks.now()} ms, before the ${timeoutMs} ms deadline`);
});

test("a bounded number of loads ends the search even if the deadline never comes", async () => {
  const thread = fakeThread({ anchorPage: null, pages: Number.POSITIVE_INFINITY, frozenClock: true, maxScrolls: 1000 });
  assert.equal(await findRuleSection(thread.hooks, OPTIONS), "not-found");
  assert.equal(thread.log.filter((entry) => entry.startsWith("top@")).length, OPTIONS.maxLoads);
});

test("a thread that never renders times out", async () => {
  const thread = fakeThread({ renderAt: Number.POSITIVE_INFINITY });
  assert.equal(await findRuleSection(thread.hooks, OPTIONS), "not-found");
  assert.deepEqual(thread.log, []);
});

test("leaving the thread or scrolling it by hand cancels the search", async () => {
  const thread = fakeThread({ anchorPage: 4, wantedUntil: 1200 });
  assert.equal(await findRuleSection(thread.hooks, OPTIONS), "cancelled");
  assert.ok(!thread.log.includes("reveal anchor"));
});
