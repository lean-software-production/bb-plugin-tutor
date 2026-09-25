import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PALETTE_CSS, THEME_CSS, contrast, paletteBlock, renderThemeCss } from "./build.ts";

test("themes/paper.css is up to date with the palette and the Archivo font (npm run fonts)", () => {
  assert.equal(readFileSync(THEME_CSS, "utf8"), renderThemeCss());
});

test("the theme is under BB's 256 KB theme cap and embeds Archivo as the UI font, keeping BB's mono", () => {
  const css = renderThemeCss();
  assert.ok(Buffer.byteLength(css) < 200 * 1024, `${Buffer.byteLength(css)} bytes`);
  assert.match(css, /@font-face \{\n {2}font-family: "Tutor Archivo";\n {2}src: url\("data:font\/woff2;base64,/);
  assert.match(css, /--font-sans: "Tutor Archivo", /);
  assert.doesNotMatch(css, /--font-mono/);
  // Only an @import may come before other rules, and a theme has none.
  assert.doesNotMatch(css, /@import/);
});

test("the light block maps the tutorial-engine palette onto BB's tokens", () => {
  const light = paletteBlock(readFileSync(PALETTE_CSS, "utf8"), ":root,\n.light");
  assert.equal(light["--canvas"], "#fbfaf6");
  assert.equal(light["--ink"], "#1f2933");
  assert.equal(light["--primary"], "#2459a8");
  assert.equal(light["--sidebar"], "#e8e5db");
  assert.equal(light["--success"], "#1f735b");
  assert.equal(light["--warning-text"], "#8b5a00");
  assert.equal(light["--destructive"], "#b43b3b");
});

test("text colours keep WCAG AA contrast on the surfaces they are painted on, in both modes", () => {
  const source = readFileSync(PALETTE_CSS, "utf8");
  for (const selector of [":root,\n.light", ".dark"]) {
    const t = paletteBlock(source, selector);
    const pairs: [string, string][] = [
      ["--ink", "--canvas"],
      ["--ink", "--sidebar"],
      ["--sidebar-foreground", "--sidebar"],
      ["--muted-foreground", "--canvas"],
      ["--muted-foreground", "--sidebar"],
      ["--readback-foreground", "--canvas"],
      ["--primary", "--canvas"],
      ["--primary-foreground", "--primary"],
      ["--destructive-text", "--canvas"],
      ["--destructive-foreground", "--destructive"],
      ["--warning-text", "--canvas"],
      ["--success", "--canvas"],
      ["--file-accent", "--canvas"],
    ];
    for (const [fg, bg] of pairs) {
      const fgValue = t[fg];
      const bgValue = t[bg];
      assert.ok(fgValue !== undefined && bgValue !== undefined, `${selector}: ${fg} and ${bg} are set`);
      const ratio = contrast(fgValue, bgValue);
      assert.ok(ratio >= 4.5, `${selector}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
    // Captions and placeholders: large-text / UI-component floor.
    const subtle = t["--subtle-foreground"];
    const canvas = t["--canvas"];
    assert.ok(subtle !== undefined && canvas !== undefined);
    assert.ok(contrast(subtle, canvas) >= 3, `${selector}: --subtle-foreground is ${contrast(subtle, canvas).toFixed(2)}:1`);
  }
});

test("the light code theme sits on the paper and keeps every token colour readable", () => {
  const code = JSON.parse(readFileSync(new URL("../../themes/paper-code.json", import.meta.url), "utf8")) as {
    type: string;
    colors: Record<string, string>;
    tokenColors: { scope: string[]; settings: { foreground?: string } }[];
  };
  assert.equal(code.type, "light");
  const background = code.colors["editor.background"];
  assert.equal(background, "#fbfaf6");
  for (const rule of code.tokenColors) {
    const foreground = rule.settings.foreground;
    if (foreground === undefined) continue;
    assert.ok(contrast(foreground, background) >= 4.5, `${rule.scope.join(", ")}: ${contrast(foreground, background).toFixed(2)}:1`);
  }
});
