import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  STUDENT_INPUT_EVENTS,
  createHeartbeatTracker,
  shouldSendHeartbeat,
} from "./heartbeat.ts";

const T0 = 1_000_000;

test("a heartbeat goes out only while the page is visible and the student interacted in the last 60 s", () => {
  assert.equal(ACTIVE_WINDOW_MS, 60_000);
  const base = { visible: true, lastInteractionAt: T0, lastSentAt: null };
  assert.ok(shouldSendHeartbeat(base, T0));
  assert.ok(shouldSendHeartbeat(base, T0 + 60_000));
  assert.ok(!shouldSendHeartbeat(base, T0 + 60_001), "idle for more than 60 s");
  assert.ok(!shouldSendHeartbeat({ ...base, visible: false }, T0), "hidden tab");
  assert.ok(!shouldSendHeartbeat({ ...base, lastInteractionAt: null }, T0), "no interaction yet");
});

test("heartbeats are at most one every 45 s", () => {
  assert.equal(HEARTBEAT_INTERVAL_MS, 45_000);
  const state = { visible: true, lastInteractionAt: T0 + 44_000, lastSentAt: T0 };
  assert.ok(!shouldSendHeartbeat(state, T0 + 44_999));
  assert.ok(shouldSendHeartbeat({ ...state, lastInteractionAt: T0 + 45_000 }, T0 + 45_000));
});

test("the tracker sends on interaction, throttles, and resumes after the next interaction", () => {
  let now = T0;
  const sent: number[] = [];
  const tracker = createHeartbeatTracker({ now: () => now, visible: () => true, send: () => sent.push(now) });

  tracker.tick();
  assert.deepEqual(sent, [], "nothing before the first interaction");

  tracker.interacted();
  assert.deepEqual(sent, [T0]);

  now = T0 + 10_000;
  tracker.interacted();
  tracker.tick();
  assert.deepEqual(sent, [T0], "throttled within 45 s");

  now = T0 + 45_000;
  tracker.tick();
  assert.deepEqual(sent, [T0, T0 + 45_000], "the timer sends once the interval passes, since the student was active 35 s ago");

  now = T0 + 45_000 + 70_000;
  tracker.tick();
  assert.equal(sent.length, 2, "no heartbeat after 60 s without interaction");

  tracker.interacted();
  assert.deepEqual(sent.at(-1), now, "an interaction after a quiet spell sends at once");
});

test("a hidden page never sends, even right after an interaction", () => {
  let visible = false;
  const sent: number[] = [];
  const tracker = createHeartbeatTracker({ now: () => T0, visible: () => visible, send: () => sent.push(T0) });
  tracker.interacted();
  tracker.tick();
  assert.deepEqual(sent, []);
  visible = true;
  tracker.tick();
  assert.deepEqual(sent, [T0], "becoming visible within the active window sends");
});

test("a failed send still counts toward the throttle, so a lost connection is not hammered", () => {
  let now = T0;
  let attempts = 0;
  const tracker = createHeartbeatTracker({
    now: () => now,
    visible: () => true,
    send: () => {
      attempts += 1;
      throw new Error("Failed to fetch");
    },
  });
  tracker.interacted();
  now += 1_000;
  tracker.interacted();
  assert.equal(attempts, 1);
});

test("only the student's own input counts, not focus or scrolling the page does by itself", () => {
  // BB autofocuses its composer on every page load, and the lesson scrolls
  // itself to the latest message while the coach writes: both fire trusted
  // focusin/scroll events with nobody at the keyboard. Scrolling by hand
  // arrives as wheel, touch, key or pointer input, which do count.
  assert.deepEqual([...STUDENT_INPUT_EVENTS].sort(), ["keydown", "pointerdown", "pointermove", "touchstart", "wheel"]);
  for (const type of ["focus", "focusin", "scroll"]) {
    assert.ok(!(STUDENT_INPUT_EVENTS as readonly string[]).includes(type), `${type} is not student input`);
  }
});
