// Decision 6: paper CSS must never reach BB's own UI. Every selector in the
// plugin's stylesheets starts at a Tutor root class and names only tp-* classes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
// .tutor-nav is the sidebar navigation, drawn with BB's tokens (styles/nav.css).
const ROOTS = [".tutor-paper", ".tutor-grid", ".tutor-nav"];

function stylesheets(): string[] {
  const styles = readdirSync(`${APP_DIR}styles`)
    .filter((name) => name.endsWith(".css"))
    .map((name) => `${APP_DIR}styles/${name}`);
  return [`${APP_DIR}paper.css`, ...styles];
}

/** Selectors of style rules, skipping at-rule preludes and keyframe steps. */
function selectors(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  const stack: ("keyframes" | "group" | "rule")[] = [];
  let prelude = "";
  for (const char of source) {
    if (char === "{") {
      const head = prelude.trim();
      if (head.startsWith("@")) stack.push(/^@(-\w+-)?keyframes/.test(head) ? "keyframes" : "group");
      else {
        if (!stack.includes("keyframes")) found.push(...head.split(",").map((part) => part.trim()));
        stack.push("rule");
      }
      prelude = "";
    } else if (char === "}") {
      stack.pop();
      prelude = "";
    } else if (char === ";" && stack.at(-1) !== "rule") {
      prelude = "";
    } else {
      prelude += char;
    }
  }
  return found;
}

test("the selector reader sees rules inside media queries and skips keyframes", () => {
  assert.deepEqual(
    selectors("@import 'x.css'; .a, .b > i { x: 1 } @media (w) { .c { y: 2 } } @keyframes k { 50% { z: 3 } }"),
    [".a", ".b > i", ".c"],
  );
});

test("every Tutor selector is scoped under a Tutor root and uses tp-* classes", () => {
  for (const file of stylesheets()) {
    for (const selector of selectors(readFileSync(file, "utf8"))) {
      assert.ok(
        ROOTS.some((root) => selector.startsWith(root)),
        `${file}: "${selector}" must start with ${ROOTS.join(" or ")}`,
      );
      for (const className of selector.match(/\.[\w-]+/g) ?? []) {
        assert.ok(
          ROOTS.includes(className) || className.startsWith(".tp-"),
          `${file}: "${selector}" uses ${className}; plugin classes are tp-*`,
        );
      }
    }
  }
});

test("custom properties are --tp-* so BB's own tokens are never shadowed", () => {
  for (const file of stylesheets()) {
    const declared = readFileSync(file, "utf8").match(/(?<![\w-])--[\w-]+(?=\s*:)/g) ?? [];
    for (const name of declared) assert.ok(name.startsWith("--tp-"), `${file}: ${name} must be --tp-*`);
  }
});
