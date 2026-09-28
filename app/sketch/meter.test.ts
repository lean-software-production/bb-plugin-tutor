import { test } from "node:test";
import assert from "node:assert/strict";
import { meterCount, meterPercent } from "./meter.ts";

test("the meter fill is the share done, clamped to the bar", () => {
  assert.equal(meterPercent(3, 10), 30);
  assert.equal(meterPercent(1, 22), 5);
  assert.equal(meterPercent(0, 10), 0);
  assert.equal(meterPercent(12, 10), 100);
  assert.equal(meterPercent(-1, 10), 0);
  assert.equal(meterPercent(0, 0), 0);
});

test("the meter says its count in words, with the unit when there is one", () => {
  assert.equal(meterCount(3, 10), "3 of 10");
  assert.equal(meterCount(0, 10, "Examples hold"), "0 of 10 Examples hold");
});
