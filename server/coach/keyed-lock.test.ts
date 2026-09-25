import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeyedLock } from "./keyed-lock.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("tasks for one key run one at a time, in order, even when one fails", async () => {
  const lock = createKeyedLock();
  const log: string[] = [];
  const task = (name: string, fail = false) => async () => {
    log.push(`${name} start`);
    await tick();
    log.push(`${name} end`);
    if (fail) throw new Error(name);
    return name;
  };
  const results = await Promise.allSettled([lock.run("k", task("a")), lock.run("k", task("b", true)), lock.run("k", task("c"))]);
  assert.deepEqual(log, ["a start", "a end", "b start", "b end", "c start", "c end"]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected", "fulfilled"]);
});

test("tasks for different keys overlap", async () => {
  const lock = createKeyedLock();
  const log: string[] = [];
  const task = (name: string) => async () => {
    log.push(`${name} start`);
    await tick();
    log.push(`${name} end`);
  };
  await Promise.all([lock.run("x", task("x")), lock.run("y", task("y"))]);
  assert.deepEqual(log, ["x start", "y start", "x end", "y end"]);
});
