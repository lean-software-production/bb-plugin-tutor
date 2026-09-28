import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS, stepColour, stepTone } from "./step-colour.ts";

test("steps take the kit accents in list order, starting at mustard, and wrap after five", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map(stepColour),
    ["sk-mustard", "sk-teal", "sk-forest", "sk-coral", "sk-blue", "sk-mustard", "sk-teal"],
  );
  assert.deepEqual(STEPS, ["mustard", "teal", "forest", "coral", "blue"]);
});

test("a step's tone is the accent behind its class, for a panel in that step's colour", () => {
  assert.deepEqual([0, 3, 9].map(stepTone), ["mustard", "coral", "blue"]);
});
