import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { FACES, FONTS_CSS, LATIN, renderFontFaces, renderFontsCss } from "./embed.ts";

const FAMILIES = ["Tutor Luckiest Guy", "Tutor Patrick Hand", "Tutor Patrick Hand SC"];

function faces(css: string): string[] {
  return css.split("@font-face").slice(1);
}

test("fonts.css is up to date with the .woff2 files (npm run fonts)", () => {
  assert.equal(readFileSync(FONTS_CSS, "utf8"), renderFontsCss());
});

test("each brand family is registered once, at 400, as an inlined woff2 limited to the Latin range", () => {
  const all = faces(renderFontsCss());
  assert.equal(all.length, FAMILIES.length);
  for (const family of FAMILIES) {
    const matching = all.filter((face) => face.includes(`font-family: "${family}";`));
    assert.equal(matching.length, 1, family);
    const face = matching[0] ?? "";
    assert.match(face, /src: url\("data:font\/woff2;base64,[A-Za-z0-9+/=]+"\) format\("woff2"\);/);
    assert.match(face, /font-weight: 400;/);
    assert.match(face, /font-display: swap;/);
    assert.ok(face.includes(`unicode-range: ${LATIN};`), family);
  }
});

test("the old workbook families are gone: code uses BB's mono", () => {
  const css = renderFontsCss();
  for (const old of ["Archivo", "Spectral", "JetBrains"]) assert.doesNotMatch(css, new RegExp(old));
  assert.deepEqual(readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".woff2")).sort(), FACES.map((f) => f.file).sort());
});

test("renderFontFaces refuses a family it does not know rather than rendering nothing", () => {
  assert.throws(() => renderFontFaces("Tutor Archivo"), /Tutor Archivo/);
  assert.match(renderFontFaces("Tutor Patrick Hand"), /font-family: "Tutor Patrick Hand";/);
});

test("the README records every font file's sha256, and they match the files", () => {
  const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
  for (const face of FACES) {
    const sha = createHash("sha256").update(readFileSync(new URL(`./${face.file}`, import.meta.url))).digest("hex");
    const row = readme.split("\n").find((line) => line.includes(`\`${face.file}\``));
    assert.ok(row, `${face.file} has a README row`);
    assert.ok(row.includes(sha), `${face.file}: README sha256 is not ${sha}`);
  }
});
