import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage } from "../state/query-cache.ts";
import {
  CONNECTION_LOST_MESSAGE,
  ConnectionLostError,
  classifyRpcFailure,
  isConnectionLost,
  withConnectionLossDetection,
} from "./rpc-errors.ts";

/** What BB's frontend RPC client throws when the body is not one of BB's JSON errors. */
function bodylessFailure(method: string, status: number): Error {
  return new Error(`rpc "${method}" failed (HTTP ${status})`);
}

test("a response without a BB JSON error body means the proxy in front of BB answered: connection lost", () => {
  for (const status of [401, 403, 404, 407, 500, 502, 503, 504, 200]) {
    const classified = classifyRpcFailure(bodylessFailure("openCoach", status));
    assert.ok(classified instanceof ConnectionLostError, `HTTP ${status}`);
    assert.equal(classified.message, CONNECTION_LOST_MESSAGE);
  }
});

test("fetch's network TypeError (Chrome, Firefox, Safari wording) is a lost connection", () => {
  for (const message of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
    assert.ok(classifyRpcFailure(new TypeError(message)) instanceof ConnectionLostError, message);
  }
});

test("BB and Tutor errors carried in a JSON body are passed through unchanged", () => {
  const tutor = new Error("No factory project is set up yet. Confirm it on the Course page.");
  assert.equal(classifyRpcFailure(tutor), tutor);

  // BB's own JSON 401 (an expired BB session) keeps its message and code.
  const bb = Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
  assert.equal(classifyRpcFailure(bb), bb);

  // A handler message that merely looks like the generic one still carries a code from BB.
  const coded = Object.assign(bodylessFailure("openCoach", 500), { code: "INTERNAL" });
  assert.equal(classifyRpcFailure(coded), coded);

  const validation = Object.assign(new Error("Invalid input"), { code: "BAD_REQUEST", issues: [] });
  assert.equal(classifyRpcFailure(validation), validation);
  assert.equal(classifyRpcFailure("plain string"), "plain string");
});

test("the student sees the reload advice, never the raw HTTP status", () => {
  const message = errorMessage(classifyRpcFailure(bodylessFailure("openCoach", 401)));
  assert.equal(message, CONNECTION_LOST_MESSAGE);
  assert.doesNotMatch(message, /HTTP|401/);
  assert.match(message, /Reload this page/);
  assert.ok(isConnectionLost(message));
  assert.ok(!isConnectionLost("No factory project is set up yet."));
});

test("the wrapped client rethrows lost connections as ConnectionLostError and passes results and other errors through", async () => {
  const calls: unknown[][] = [];
  const outcomes: (() => Promise<unknown>)[] = [
    async () => ({ threadId: "thr_1" }),
    async () => {
      throw bodylessFailure("openCoach", 401);
    },
    async () => {
      throw new Error("Homework 004 has not started yet.");
    },
  ];
  const client = withConnectionLossDetection({
    call: (...args: unknown[]) => {
      calls.push(args);
      return outcomes.shift()!();
    },
  });

  assert.deepEqual(await client.call("openCoach", { homeworkId: "003" }), { threadId: "thr_1" });
  await assert.rejects(client.call("openCoach", { homeworkId: "003" }), ConnectionLostError);
  await assert.rejects(client.call("openCoach", { homeworkId: "004" }), /has not started yet/);
  assert.deepEqual(calls[0], ["openCoach", { homeworkId: "003" }]);
});
