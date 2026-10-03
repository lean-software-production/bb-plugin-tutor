import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostLock } from "./lock.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("two adoptions of one workspace run one after the other, even when one fails", async () => {
  const lock = createHostLock();
  const log: string[] = [];
  const adoption = (name: string, fail = false) => async () => {
    log.push(`${name} start`);
    await tick();
    log.push(`${name} end`);
    if (fail) throw new Error(name);
    return name;
  };
  const results = await Promise.allSettled([
    lock.run("/w/repo", adoption("a")),
    lock.run("/w/repo", adoption("b", true)),
    lock.run("/w/repo", adoption("c")),
  ]);
  assert.deepEqual(log, ["a start", "a end", "b start", "b end", "c start", "c end"]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected", "fulfilled"]);
});

test("adoptions of different workspaces overlap", async () => {
  const lock = createHostLock();
  const log: string[] = [];
  const adoption = (name: string) => async () => {
    log.push(`${name} start`);
    await tick();
    log.push(`${name} end`);
  };
  await Promise.all([lock.run("/w/x", adoption("x")), lock.run("/w/y", adoption("y"))]);
  assert.deepEqual(log, ["x start", "y start", "x end", "y end"]);
});
