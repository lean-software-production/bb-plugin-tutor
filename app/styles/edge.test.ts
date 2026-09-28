// The welcome page's waver stands at the page's corner. The drawing must stay
// at least 24px inside the page at every width the page sets offsets for
// (plan Task 12; checked in the browser by scripts/tutor-dev/e2e/sketch-check.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const PAGES = readFileSync(new URL("./pages.css", import.meta.url), "utf8");
const MARGIN = 24;

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

test("the waver stays at least 24px inside the page at every width", () => {
  const all = placements(PAGES);
  const base = all.get("");
  assert.ok(base?.right !== undefined && base.bottom !== undefined && base.height !== undefined, "pages.css places the waver");
  for (const [media, own] of all) {
    const place = { ...base, ...own };
    assert.ok(place.height! > 0, `${media || "default"}: the waver has a height`);
    assert.ok(place.right! >= MARGIN, `${media || "default"}: the waver's right edge is ${place.right}px from the page's (want >= ${MARGIN})`);
    assert.ok(place.bottom! >= MARGIN, `${media || "default"}: the waver's bottom edge is ${place.bottom}px from the page's (want >= ${MARGIN})`);
  }
});

// BB home's explainer leans past the Continue panel's right edge
// (`right: -104px`, as in the mockup). The drawing must stay at least 16px
// inside BB's page column (plan Task 12; sketch-check.mjs measures it in the
// browser). BB caps the home page's content at 760px inside that column, and
// the column's width depends on BB's resizable sidebar, so only a query on
// BB's page container (`@container/page`) sees the room beside the panel.
// The explainer is hidden unless such a query shows it: were BB to rename its
// container, the explainer would stay hidden rather than hang off the page.
const HOME_MARGIN = 16;
/** The Continue panel's width (`.tp-hs-wrap`, BB's 760px content less its 16px padding). */
const PANEL = 728;

type Shown = { query: string; column: number | null };

test("the home explainer shows only where it stays at least 16px inside BB's page column", () => {
  let right: number | undefined;
  let height: number | undefined;
  let hiddenByDefault = false;
  const shown: Shown[] = [];
  postcss.parse(PAGES).walkRules((rule) => {
    const at = rule.parent?.type === "atrule" ? (rule.parent as postcss.AtRule) : null;
    const decl = (prop: string) => rule.nodes.find((n): n is postcss.Declaration => n.type === "decl" && n.prop === prop)?.value;
    for (const selector of rule.selectors) {
      if (/\.tp-edge--explainer img$/.test(selector) && at === null) height = Number(/^([\d.]+)px$/.exec(decl("height") ?? "")?.[1]);
      if (!/\.tp-edge--explainer$/.test(selector)) continue;
      if (at === null && decl("right") !== undefined) right = Number(/^(-?[\d.]+)px$/.exec(decl("right")!)?.[1]);
      const display = decl("display");
      if (display === undefined) continue;
      if (at === null) hiddenByDefault = display === "none";
      else if (display !== "none") {
        const min = /min-width:\s*([\d.]+)px/.exec(at.params);
        shown.push({ query: `@${at.name} ${at.params}`, column: at.name === "container" && min !== null ? Number(min[1]) : null });
      }
    }
  });
  assert.ok(right !== undefined && height !== undefined, "pages.css places the explainer");
  assert.ok(hiddenByDefault, "the explainer is hidden unless a query on BB's page column shows it");
  assert.ok(shown.length > 0, "a query on BB's page column shows the explainer where it has room");
  for (const { query, column } of shown) {
    assert.ok(column !== null, `${query}: only a min-width query on BB's page container knows the column's width`);
    const margin = (column - PANEL) / 2 + right;
    assert.ok(margin >= HOME_MARGIN, `${query}: in a ${column}px column the explainer is ${margin.toFixed(1)}px from the column's edge (want >= ${HOME_MARGIN})`);
  }
});
