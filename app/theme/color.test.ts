import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contrast, luminance, over, resolveColor, toBytes, type Tokens } from "./color.ts";
import { BB_BASE_TOKENS } from "./bb-base-tokens.ts";

interface FixtureCase {
  expr: string;
  tokens: string;
  over?: string;
  computed: string;
  srgb: [number, number, number];
}
const fixture = JSON.parse(readFileSync(new URL("./color-fixture.json", import.meta.url), "utf8")) as {
  tokenSets: Record<string, Tokens>;
  cases: FixtureCase[];
};

test("the resolver matches Chromium's rendering of every fixture expression within 1/255 per channel", () => {
  assert.ok(fixture.cases.length >= 20);
  for (const c of fixture.cases) {
    const tokens = fixture.tokenSets[c.tokens];
    assert.ok(tokens, `token set ${c.tokens}`);
    let colour = resolveColor(c.expr, tokens);
    if (c.over !== undefined) colour = over(colour, resolveColor(c.over, tokens));
    const got = toBytes(colour);
    // The half-float canvas keeps out-of-gamut values; the screen clips them, as toBytes does.
    const chromium = c.srgb.map((v) => Math.min(255, Math.max(0, v)));
    const worst = Math.max(...got.map((v, i) => Math.abs(v - (chromium[i] ?? NaN))));
    assert.ok(worst <= 1, `${c.expr} [${c.tokens}]: got ${got.map((v) => v.toFixed(2)).join(", ")}, Chromium ${c.srgb.join(", ")} (${c.computed})`);
  }
});

test("WCAG contrast: black on white is 21:1, a colour on itself 1:1, #767676 on white just passes AA", () => {
  assert.equal(contrast("#000", "#fff"), 21);
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast("#2a2724", "#2a2724"), 1);
  const grey = contrast("#767676", "#ffffff");
  assert.ok(grey > 4.5 && grey < 4.6, grey.toFixed(3));
  assert.equal(luminance(resolveColor("#fff", {})), 1);
  assert.equal(luminance(resolveColor("#000", {})), 0);
});

test("contrast refuses a translucent colour: composite it with over() first", () => {
  assert.throws(() => contrast("color-mix(in oklab, #094854 16%, transparent)", "#fff"), /translucent/);
});

test("var() resolves through the token map, uses its fallback, and names a missing token", () => {
  const tokens = { "--a": "var(--b)", "--b": "#094854" };
  assert.deepEqual(toBytes(resolveColor("var(--a)", tokens)), [9, 72, 84]);
  assert.deepEqual(toBytes(resolveColor("var(--nope, var(--b))", tokens)), [9, 72, 84]);
  assert.throws(() => resolveColor("var(--nope)", tokens), /--nope/);
});

test("a var() cycle is an error, not a hang", () => {
  assert.throws(() => resolveColor("var(--a)", { "--a": "var(--b)", "--b": "color-mix(in oklch, var(--a) 50%, #fff)" }), /cycle/);
});

test("color-mix percentages normalise as CSS does", () => {
  const same = (a: string, b: string) => assert.deepEqual(toBytes(resolveColor(a, {})).map(Math.round), toBytes(resolveColor(b, {})).map(Math.round));
  same("color-mix(in oklab, #eea306, #1f78a8)", "color-mix(in oklab, #eea306 50%, #1f78a8 50%)");
  same("color-mix(in oklab, #eea306 25%, #1f78a8)", "color-mix(in oklab, #eea306 25%, #1f78a8 75%)");
  same("color-mix(in oklab, #eea306 60%, #1f78a8 60%)", "color-mix(in oklab, #eea306 50%, #1f78a8 50%)");
  assert.equal(resolveColor("color-mix(in oklab, #eea306 20%, #1f78a8 20%)", {}).alpha, 0.4);
});

test("unsupported syntax fails loudly", () => {
  assert.throws(() => resolveColor("hsl(10 20% 30%)", {}), /hsl/);
  assert.throws(() => resolveColor("color-mix(in hsl, #fff, #000)", {}), /hsl/);
  assert.throws(() => resolveColor("#12345", {}), /#12345/);
});

test("BB's base tokens cover both modes and every derived token the contrast test needs", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const name of ["--sidebar", "--secondary", "--muted", "--sidebar-accent", "--muted-foreground", "--surface-selected", "--sidebar-foreground", "--foreground"]) {
      assert.ok(BB_BASE_TOKENS[mode][name], `${mode} ${name}`);
    }
    // Every base token resolves once BB's own anchors are in place.
    for (const name of Object.keys(BB_BASE_TOKENS[mode])) {
      if (name === "--surface-selected") continue; // translucent; composited over the canvas by its users
      assert.doesNotThrow(() => resolveColor(`var(${name})`, BB_BASE_TOKENS[mode]), `${mode} ${name}`);
    }
  }
});
