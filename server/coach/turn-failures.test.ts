import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnFailures, failureText } from "./turn-failures.ts";

test("a failure is remembered until the thread's next good turn", () => {
  const failures = createTurnFailures();
  failures.record("thr_1", "403: OpenCode's free tier can only be used from within OpenCode");
  assert.equal(failures.get("thr_1"), failureText("403: OpenCode's free tier can only be used from within OpenCode"));
  failures.clear("thr_1");
  assert.equal(failures.get("thr_1"), null);
});

test("failureText puts the provider's message in Tutor's words, with what to do", () => {
  assert.equal(
    failureText("403: OpenCode's free tier can only be used from within OpenCode"),
    "Your coach stopped: its agent said \"403: OpenCode's free tier can only be used from within OpenCode\". Sign in to another agent in your Codespace (Claude Code: `claude`), or choose a model under Settings → Tutor → Coach model.",
  );
  assert.match(failureText(null), /^Your coach stopped\. /);
});
