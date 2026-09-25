import { test } from "node:test";
import assert from "node:assert/strict";
import { findRuleSection, type JumpHooks, type JumpOptions } from "./rule-jump.ts";

const OPTIONS: JumpOptions = { timeoutMs: 10_000, pollMs: 100, loadWaitMs: 500, settlePolls: 2, stalledLoads: 3 };

/**
 * A fake thread view: `renderAt` is when the timeline appears; each scroll to
 * the top loads one more page of history (up to `pages`); the anchor sits on
 * page `anchorPage` (0 = already loaded), or nowhere when null.
 */
function fakeThread({
  renderAt = 0,
  pages = 5,
  anchorPage = 0 as number | null,
  wantedUntil = Number.POSITIVE_INFINITY,
} = {}) {
  let clock = 0;
  let loaded = 0;
  let pendingLoad = false;
  const log: string[] = [];
  const hooks: JumpHooks<string, string> = {
    findAnchor: () => (clock >= renderAt && anchorPage !== null && loaded >= anchorPage ? "anchor" : null),
    findScroller: () => (clock >= renderAt ? "scroller" : null),
    scrollToTop: () => {
      log.push(`top@${clock}`);
      pendingLoad = true;
    },
    historySize: () => 1000 + loaded * 800,
    reveal: (anchor) => log.push(`reveal ${anchor}`),
    stillWanted: () => clock < wantedUntil,
    wait: async (ms) => {
      clock += ms;
      if (pendingLoad && loaded < pages) loaded += 1;
      pendingLoad = false;
    },
    now: () => clock,
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

test("when the history stops growing and the anchor never appears, it reports not found", async () => {
  const thread = fakeThread({ anchorPage: null, pages: 2 });
  assert.equal(await findRuleSection(thread.hooks, OPTIONS), "not-found");
  assert.equal(thread.loaded(), 2);
  assert.ok(thread.log.filter((entry) => entry.startsWith("top@")).length <= 2 + OPTIONS.stalledLoads);
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
