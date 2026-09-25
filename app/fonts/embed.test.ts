import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FONTS_CSS, renderFontsCss } from "./embed.ts";

test("fonts.css is up to date with the .woff2 files (npm run fonts)", () => {
  assert.equal(readFileSync(FONTS_CSS, "utf8"), renderFontsCss());
});
