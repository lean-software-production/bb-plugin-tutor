// The welcome page's project picker (WelcomePage.tsx): each row is the radio,
// the project's name and path, and a verdict ("starter clone · factory in
// factory/ · ITERATION · 004 WIP"). On phones the verdict wraps onto its own
// line under the name, indented past the radio. It doesn't shrink (`flex:
// none`), so without a bound it keeps its one-line width and runs past the
// row's right edge (seen in real BB at 390x844).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const PAGES = readFileSync(new URL("./pages.css", import.meta.url), "utf8");
const PHONE = "(max-width: 640px)";

/** The verdict's declarations, with the phone layout's on top of the base ones. */
function verdict(media: string): Record<string, string> {
  const base: Record<string, string> = {};
  const phone: Record<string, string> = {};
  postcss.parse(PAGES).walkRules((rule) => {
    if (!rule.selectors.some((s) => /\.tp-pk \.tp-v$/.test(s))) return;
    const at = rule.parent?.type === "atrule" ? (rule.parent as postcss.AtRule).params : "";
    const into = at === "" ? base : at === media ? phone : null;
    if (into === null) return;
    rule.walkDecls((d) => void (into[d.prop] = d.value.trim()));
  });
  return { ...base, ...phone };
}

test("on phones the picker's verdict wraps inside its row, past the radio's indent", () => {
  const v = verdict(PHONE);
  const indent = Number(/^(\d+(?:\.\d+)?)px$/.exec(v["margin-left"] ?? "0px")?.[1] ?? 0);
  const shrinks = v.flex !== undefined && v.flex !== "none" && !/^\S+\s+0(\s|$)/.test(v.flex);
  const bound = /^calc\(100% - (\d+(?:\.\d+)?)px\)$/.exec(v["max-width"] ?? "");
  assert.ok(
    shrinks || (bound !== null && Number(bound[1]) >= indent),
    `on phones the verdict is flex: ${v.flex ?? "(unset)"}, max-width: ${v["max-width"] ?? "(unset)"} with a ${indent}px indent: it keeps its one-line width and runs past the row`,
  );
});
