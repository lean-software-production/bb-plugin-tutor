#!/usr/bin/env node
// Records app/theme/color-fixture.json: what Chromium makes of the colour
// expressions the theme's contrast test resolves, so app/theme/color.ts can be
// checked against a real browser rather than against itself.
//
//   node scripts/record-color-fixture.mjs
//
// For each case it sets the token set's custom properties on an element, sets
// `color: <expr>`, reads getComputedStyle().color, and paints that on a 1×1
// half-float canvas (over `over` when the colour is translucent) to read back
// sRGB without 8-bit rounding, scaled to 0–255.
//
// Env: PLAYWRIGHT_MODULE (path to the playwright package; defaults to
// ~/ensembleworks/node_modules/playwright, then a normal resolution).
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const OUT = new URL("../app/theme/color-fixture.json", import.meta.url);

// The brand palette (vendor/brand/bb-theme/sketchbook/theme.css) and each
// mode's anchors, as the theme sets them.
const PALETTE = {
  "--sk-mustard": "#eea306",
  "--sk-teal": "#039695",
  "--sk-forest": "#4a7d4b",
  "--sk-coral": "#f76c37",
  "--sk-blue": "#1f78a8",
  "--sk-rust": "#d6631c",
  "--sk-deep-teal": "#094854",
  "--sk-highlighter": "#ffeeb8",
  "--sk-paper": "#fcf9f3",
  "--sk-ink": "#2a2724",
};
const TOKEN_SETS = {
  none: {},
  light: { ...PALETTE, "--canvas": "var(--sk-paper)", "--ink": "var(--sk-ink)", "--primary": "var(--sk-deep-teal)" },
  dark: {
    ...PALETTE,
    "--canvas": "var(--sk-ink)",
    "--ink": "var(--sk-paper)",
    "--primary": "color-mix(in oklch, var(--sk-teal) 80%, var(--sk-paper))",
  },
};

const CASES = [
  // Literals
  { expr: "#fcf9f3", tokens: "none" },
  { expr: "#abc", tokens: "none" },
  { expr: "rgb(10 20 30)", tokens: "none" },
  { expr: "rgb(200, 100, 50)", tokens: "none" },
  { expr: "oklch(44% 0 0)", tokens: "none" },
  { expr: "oklch(72% .09 250)", tokens: "none" },
  { expr: "oklch(45% .19 25.8625)", tokens: "none" },
  { expr: "oklab(0.5 0.1 -0.1)", tokens: "none" },
  // The theme's own mixes
  { expr: "color-mix(in oklch, var(--ink) 70%, var(--canvas))", tokens: "light" },
  { expr: "color-mix(in oklch, var(--ink) 70%, var(--canvas))", tokens: "dark" },
  { expr: "color-mix(in oklch, var(--ink) 58%, var(--canvas))", tokens: "light" },
  { expr: "color-mix(in oklch, var(--sk-teal) 80%, var(--sk-ink))", tokens: "light" },
  { expr: "color-mix(in oklch, var(--sk-rust) 75%, var(--sk-ink))", tokens: "light" },
  { expr: "color-mix(in oklch, var(--sk-mustard) 55%, var(--sk-ink))", tokens: "light" },
  { expr: "var(--primary)", tokens: "dark" },
  { expr: "color-mix(in oklch, var(--sk-coral) 80%, var(--sk-paper))", tokens: "dark" },
  { expr: "color-mix(in oklch, var(--sk-forest) 70%, var(--sk-paper))", tokens: "dark" },
  // Kit roles in other spaces
  { expr: "color-mix(in oklab, var(--sk-paper) 85%, var(--sk-ink))", tokens: "dark" },
  { expr: "color-mix(in srgb, var(--primary) 32%, var(--sk-ink))", tokens: "dark" },
  // BB's derivations over the theme's anchors
  { expr: "color-mix(in oklch, var(--ink) 2.2%, var(--canvas))", tokens: "light" },
  { expr: "color-mix(in oklch, var(--ink) 4.3%, var(--canvas))", tokens: "dark" },
  { expr: "color-mix(in oklch, var(--ink) 11%, var(--canvas))", tokens: "light" },
  { expr: "color-mix(in oklab, var(--primary) 16%, transparent)", tokens: "light", over: "var(--canvas)" },
  { expr: "color-mix(in oklab, var(--primary) 12%, transparent)", tokens: "dark", over: "var(--canvas)" },
  // Percentage normalisation and hue interpolation
  { expr: "color-mix(in oklch, #eea306, #1f78a8)", tokens: "none" },
  { expr: "color-mix(in oklch, #eea306, #1f78a8 25%)", tokens: "none" },
  { expr: "color-mix(in oklab, #eea306 80%, #1f78a8 40%)", tokens: "none" },
  { expr: "color-mix(in oklch, #eea306 30%, #1f78a8 30%)", tokens: "none", over: "#fcf9f3" },
  { expr: "color-mix(in oklch, oklch(60% 0.12 350), oklch(60% 0.12 30))", tokens: "none" },
  { expr: "color-mix(in oklch, 30% #f76c37, #039695)", tokens: "none" },
  // Chromium drops the hue of a colour converted into oklch with chroma <= 0.02
  // (it becomes `none`, then renders as 0), which is why ink and paper mixes
  // come out a touch pink. Explicit oklch() hues are kept.
  { expr: "color-mix(in oklch, oklab(0.6 0 0.0195), oklab(0.6 0 0.0195))", tokens: "none" },
  { expr: "color-mix(in oklch, oklab(0.6 0 0.0205), oklab(0.6 0 0.0205))", tokens: "none" },
  { expr: "color-mix(in oklch, oklch(0.6 0.01 90), oklch(0.6 0.01 90))", tokens: "none" },
  { expr: "var(--missing, #094854)", tokens: "none" },
];

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, resolve(homedir(), "ensembleworks/node_modules/playwright"), "playwright"].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      /* next */
    }
  }
  console.error("record-color-fixture.mjs: playwright not found; set PLAYWRIGHT_MODULE");
  process.exit(1);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><div id=probe></div><div id=under></div>");
  const results = await page.evaluate(
    ({ cases, sets }) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      // A float16 canvas, so neither the fill nor the compositing is rounded to 8 bits.
      const cx = cv.getContext("2d", { willReadFrequently: true, colorType: "float16" });
      const computed = (id, expr, tokens) => {
        const el = document.getElementById(id);
        el.removeAttribute("style");
        for (const [name, value] of Object.entries(tokens)) el.style.setProperty(name, value);
        el.style.setProperty("color", expr);
        return getComputedStyle(el).color;
      };
      return cases.map((c) => {
        const tokens = sets[c.tokens];
        const value = computed("probe", c.expr, tokens);
        cx.clearRect(0, 0, 1, 1);
        let under;
        if (c.over) {
          under = computed("under", c.over, tokens);
          cx.fillStyle = under;
          cx.fillRect(0, 0, 1, 1);
        }
        cx.fillStyle = value;
        cx.fillRect(0, 0, 1, 1);
        const d = Array.from(cx.getImageData(0, 0, 1, 1, { pixelFormat: "rgba-float16" }).data, (v) => Math.round(v * 255 * 1000) / 1000);
        return { ...c, computed: value, ...(under ? { overComputed: under } : {}), srgb: [d[0], d[1], d[2]], alpha: d[3] / 255 };
      });
    },
    { cases: CASES, sets: TOKEN_SETS },
  );
  const fixture = {
    comment: "Generated by scripts/record-color-fixture.mjs. srgb is Chromium's float16 canvas readback, times 255, of `computed` (over `over` when set).",
    browser: `chromium ${browser.version()}`,
    tokenSets: TOKEN_SETS,
    cases: results,
  };
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${results.length} cases to app/theme/color-fixture.json (chromium ${browser.version()})`);
} finally {
  await browser.close();
}
