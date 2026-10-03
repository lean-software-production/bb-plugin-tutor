// Tutor's own text is course-agnostic and never names BB or a Codespace.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const OWN_TEXT = [
  "server/course/builtin/lesson-0/README.md",
  "server/course/builtin/lesson-0/features/tutor.feature",
  "app/ui/WelcomePage.tsx",
];

test("Lesson 0 and the welcome page don't assume the capstone, a Codespace or BB", async () => {
  for (const path of OWN_TEXT) {
    const text = await readFile(path, "utf8");
    assert.doesNotMatch(text, /\bfactory\b|lesson 1 is ready|Codespace/i, path);
    assert.doesNotMatch(text.replace(/@get-bb|bb\.(\w+)/g, ""), /\bBB\b/, path);
  }
});

test("the coach skill keeps factory instructions inside the capstone-factory section", async () => {
  const skill = await readFile("skills/tutor/SKILL.md", "utf8");
  const [general = "", capstone = ""] = skill.split(/^## When the course uses the capstone-factory layout$/m);
  assert.ok(capstone.length > 0, "the capstone-factory section exists");
  assert.doesNotMatch(general, /tetris|\.factory|fetch\.sh/);
});
