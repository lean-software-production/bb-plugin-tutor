// Every animation and transition in Tutor's stylesheets stops for people who
// ask for less motion: a rule that animates has a twin in a
// prefers-reduced-motion block that sets it to none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const STYLES = readdirSync(`${APP_DIR}styles`)
  .filter((name) => name.endsWith(".css"))
  .map((name) => `${APP_DIR}styles/${name}`);

const REDUCED = /prefers-reduced-motion:\s*reduce/;

function inReducedMotion(node: postcss.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule" && (parent as postcss.AtRule).name === "media" && REDUCED.test((parent as postcss.AtRule).params)) return true;
  }
  return false;
}

/** For each file: the selectors that animate (by kind) and those the reduced-motion blocks stop. */
export function motion(css: string): { moving: Map<string, Set<string>>; stopped: Map<string, Set<string>> } {
  const moving = new Map<string, Set<string>>();
  const stopped = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, kind: string, selector: string) => {
    if (!map.has(kind)) map.set(kind, new Set());
    map.get(kind)!.add(selector);
  };
  postcss.parse(css).walkDecls(/^(animation|animation-name|transition|transition-property)$/, (decl) => {
    const rule = decl.parent;
    if (rule?.type !== "rule") return;
    if (rule.parent?.type === "atrule" && /keyframes$/.test((rule.parent as postcss.AtRule).name)) return;
    const kind = decl.prop.split("-")[0]!;
    const none = /^none$/i.test(decl.value.trim());
    for (const selector of (rule as postcss.Rule).selectors) {
      if (inReducedMotion(decl)) {
        if (none) add(stopped, kind, selector);
      } else if (!none) add(moving, kind, selector);
    }
  });
  return { moving, stopped };
}

test("the motion reader pairs a moving rule with its reduced-motion stop", () => {
  const { moving, stopped } = motion(
    ".a { animation: k 1s; } .b { transition: color .2s; } @media (prefers-reduced-motion: reduce) { .a { animation: none; } } @keyframes k { to { opacity: 1; } }",
  );
  assert.deepEqual([...(moving.get("animation") ?? [])], [".a"]);
  assert.deepEqual([...(moving.get("transition") ?? [])], [".b"]);
  assert.deepEqual([...(stopped.get("animation") ?? [])], [".a"]);
  assert.equal(stopped.get("transition"), undefined);
});

test("the motion stylesheet exists and animates the ribbon's unfurl", () => {
  const css = readFileSync(`${APP_DIR}styles/motion.css`, "utf8");
  assert.ok([...(motion(css).moving.get("animation") ?? [])].some((selector) => selector.includes(".tp-ribbon")));
});

test("every animation and transition in Tutor's stylesheets stops under prefers-reduced-motion", () => {
  for (const file of STYLES) {
    const { moving, stopped } = motion(readFileSync(file, "utf8"));
    for (const [kind, selectors] of moving) {
      for (const selector of selectors) {
        assert.ok(stopped.get(kind)?.has(selector), `${file}: "${selector}" has a ${kind} with no reduced-motion ${kind}: none`);
      }
    }
  }
});
