import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline } from "./inline.ts";

test("plain text is one token", () => {
  assert.deepEqual(parseInline("A doer attempts a task."), [{ kind: "text", text: "A doer attempts a task." }]);
  assert.deepEqual(parseInline(""), []);
});

test("code, strong and emphasis", () => {
  assert.deepEqual(parseInline("Run `./factory` on a **seed**, not a *plan* or _spec_."), [
    { kind: "text", text: "Run " },
    { kind: "code", text: "./factory" },
    { kind: "text", text: " on a " },
    { kind: "strong", text: "seed" },
    { kind: "text", text: ", not a " },
    { kind: "em", text: "plan" },
    { kind: "text", text: " or " },
    { kind: "em", text: "spec" },
    { kind: "text", text: "." },
  ]);
});

test("links keep their text and lose their target", () => {
  assert.deepEqual(parseInline("See [→ harnesses](building-blocks/harnesses.md), [tools](x.md)"), [
    { kind: "text", text: "See → harnesses, tools" },
  ]);
});

test("snake_case words are not emphasis, and markup stays text", () => {
  assert.deepEqual(parseInline("plan_complete and <b>bold</b>"), [
    { kind: "text", text: "plan_complete and <b>bold</b>" },
  ]);
});
