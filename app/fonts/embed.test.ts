import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FONTS_CSS, renderFontsCss } from "./embed.ts";

test("fonts.css is up to date with the .woff2 files (npm run fonts)", () => {
  assert.equal(readFileSync(FONTS_CSS, "utf8"), renderFontsCss());
});

test("Archivo leaves word spaces to the fallback face, whose wider space keeps words apart at small sizes", () => {
  const archivo = renderFontsCss()
    .split("@font-face")
    .find((face) => face.includes('"Tutor Archivo"'));
  assert.match(archivo ?? "", /unicode-range: U\+0-1F, U\+21-9F, U\+A1-10FFFF;/);
  const others = renderFontsCss()
    .split("@font-face")
    .filter((face) => face.includes("font-family") && !face.includes('"Tutor Archivo"'));
  for (const face of others) assert.doesNotMatch(face, /unicode-range/);
});
