// The welcome page's waver stands at the page's corner on a paper patch. The
// patch reaches past the drawing (the kit's `.sk-patch::before` is inset
// -5% -7%), and all of it must stay at least 24px inside the page at every
// width the page sets offsets for (plan Task 12; checked in the browser by
// scripts/tutor-dev/e2e/sketch-check.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const PAGES = readFileSync(new URL("./pages.css", import.meta.url), "utf8");
const MARGIN = 24;
/** The patch's overhang past its drawing, from the kit: 7% of its width, 5% of its height. */
const OVERHANG_X = 0.07;
const OVERHANG_Y = 0.05;

type Placement = { right?: number; bottom?: number; height?: number };

/** The waver's offsets and drawing height, per media context ("" is no media query). */
function placements(css: string): Map<string, Placement> {
  const byMedia = new Map<string, Placement>();
  postcss.parse(css).walkRules((rule) => {
    const media = rule.parent?.type === "atrule" ? (rule.parent as postcss.AtRule).params : "";
    for (const selector of rule.selectors) {
      const target = /\.tp-edge--waver img$/.test(selector) ? "img" : /\.tp-edge--waver$/.test(selector) ? "edge" : null;
      if (target === null) continue;
      const place = byMedia.get(media) ?? {};
      rule.walkDecls((decl) => {
        const px = /^(-?\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
        if (px === null) return;
        if (target === "edge" && (decl.prop === "right" || decl.prop === "bottom")) place[decl.prop] = Number(px[1]);
        if (target === "img" && decl.prop === "height") place.height = Number(px[1]);
      });
      byMedia.set(media, place);
    }
  });
  return byMedia;
}

test("the waver's patch stays at least 24px inside the page at every width", () => {
  const all = placements(PAGES);
  const base = all.get("");
  assert.ok(base?.right !== undefined && base.bottom !== undefined && base.height !== undefined, "pages.css places the waver");
  for (const [media, own] of all) {
    const place = { ...base, ...own };
    // The waver is taller than it is wide, so its height bounds the patch's width.
    const right = place.right! - OVERHANG_X * place.height!;
    const bottom = place.bottom! - OVERHANG_Y * place.height!;
    assert.ok(right >= MARGIN, `${media || "default"}: the patch's right edge is ${right.toFixed(1)}px from the page's (want >= ${MARGIN})`);
    assert.ok(bottom >= MARGIN, `${media || "default"}: the patch's bottom edge is ${bottom.toFixed(1)}px from the page's (want >= ${MARGIN})`);
  }
});
