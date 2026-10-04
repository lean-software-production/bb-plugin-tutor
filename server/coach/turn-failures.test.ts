import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnFailures, failureText, MAX_QUOTED_FAILURE } from "./turn-failures.ts";

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
    "Your coach stopped: its agent said \"403: OpenCode's free tier can only be used from within OpenCode\". Sign in to another agent in your Codespace (Claude Code: `claude`), or choose a model under Settings → Plugins → Tutor → Coach model.",
  );
  assert.match(failureText(null), /^Your coach stopped\. /);
});

test("a long provider message is cut to MAX_QUOTED_FAILURE characters, with an ellipsis", () => {
  const long = `403: ${"x".repeat(1000)}`;
  const text = failureText(long);
  const quoted = /its agent said "([^"]*)"/.exec(text)?.[1] ?? "";
  assert.equal(quoted, `${long.slice(0, MAX_QUOTED_FAILURE)}…`);
  assert.equal(MAX_QUOTED_FAILURE, 300);
  const exact = "y".repeat(MAX_QUOTED_FAILURE);
  assert.match(failureText(exact), new RegExp(`said "${exact}"\\.`), "a message at the limit is quoted whole");
});
