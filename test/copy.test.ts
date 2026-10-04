// Tutor's own text is course-agnostic, and nothing a student reads names BB.
// Lesson 0 assumes no Codespace either; Tutor's pages may (the hosted design
// talks about the student's Codespace by design).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const LESSON_0 = ["server/course/builtin/lesson-0/README.md", "server/course/builtin/lesson-0/features/tutor.feature"];

test("Lesson 0 doesn't assume the capstone, a Codespace or BB", async () => {
  for (const path of LESSON_0) {
    const text = await readFile(path, "utf8");
    assert.doesNotMatch(text, /\bfactory\b|lesson 1 is ready|Codespace/i, path);
    assert.doesNotMatch(text.replace(/@get-bb|bb\.(\w+)/g, ""), /\bBB\b/, path);
  }
});

test("the welcome page doesn't assume the capstone factory or name BB", async () => {
  const text = await readFile("app/ui/WelcomePage.tsx", "utf8");
  assert.doesNotMatch(text, /\bfactory\b|lesson 1 is ready/i);
  assert.doesNotMatch(text.replace(/@get-bb|bb\.(\w+)/g, ""), /\bBB\b/);
});

/** Pages any course shows: they talk about the workspace, never a factory. */
const OWN_PAGES = ["app/ui/StartPage.tsx", "app/ui/CompletionPage.tsx", "app/ui/Home.tsx", "app/ui/Outline.tsx"];

test("Lesson 0 doesn't send the student to an Add row: a Tutor set up with its course (the Codespace) has none", async () => {
  const readme = await readFile("server/course/builtin/lesson-0/README.md", "utf8");
  assert.doesNotMatch(readme, /add (?:a|the) course/i);
});

test("the start, completion, home and outline pages talk about the workspace, not a factory", async () => {
  for (const path of OWN_PAGES) {
    assert.doesNotMatch(await readFile(path, "utf8"), /\bfactory\b/i, path);
  }
});

test("the coach skill keeps factory instructions inside the capstone-factory section", async () => {
  const skill = await readFile("skills/tutor/SKILL.md", "utf8");
  const heading = /^## When the course uses the capstone-factory layout$/m;
  const [before = "", rest = ""] = skill.split(heading);
  assert.ok(rest.length > 0, "the capstone-factory section exists");
  // The section runs to the next "## " heading; everything else is the general part.
  const after = rest.slice(rest.search(/^## /m));
  const general = `${before}\n${after}`;
  assert.doesNotMatch(general, /tetris|\.factory|fetch\.sh/);
  // Progress-card examples quote a capstone lesson verbatim; the prose around them does not assume one.
  const prose = general.split("\n").filter((line) => !line.startsWith("::")).join("\n");
  assert.doesNotMatch(prose, /\b(?:the|their|your) (?:software )?factory\b/i);
});
