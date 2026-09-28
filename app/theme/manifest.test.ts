import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { LEGACY_THEME_ID, THEME_ID } from "../../shared/constants.ts";
import { CODE_THEME_FILES, THEME_CSS } from "./build.ts";

interface ThemeEntry {
  id: string;
  name: string;
  description?: string;
  css: string;
  codeTheme?: { light?: string; dark?: string };
}
const ROOT = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as { bb: { themes?: ThemeEntry[] } };
const themes = manifest.bb.themes ?? [];
const entry = (id: string) => {
  const found = themes.find((theme) => theme.id === id);
  assert.ok(found, `bb.themes has ${id}`);
  return found;
};
const resolved = (file: string) => new URL(file, ROOT).pathname;

test("the manifest contributes the Sketchbook theme with light and dark code themes", () => {
  const sketchbook = entry(THEME_ID);
  assert.equal(THEME_ID, "sketchbook");
  assert.equal(sketchbook.name, "Sketchbook");
  assert.ok(sketchbook.description);
  assert.equal(resolved(sketchbook.css), THEME_CSS);
  assert.equal(resolved(sketchbook.codeTheme?.light ?? ""), CODE_THEME_FILES.light);
  assert.equal(resolved(sketchbook.codeTheme?.dark ?? ""), CODE_THEME_FILES.dark);
});

test("`paper` stays as an alias of Sketchbook for one release, so a student who chose it keeps a theme", () => {
  const paper = entry(LEGACY_THEME_ID);
  assert.equal(LEGACY_THEME_ID, "paper");
  assert.equal(paper.name, "Tutor paper (now Sketchbook)");
  assert.match(paper.description ?? "", /next release/);
  const sketchbook = entry(THEME_ID);
  assert.equal(paper.css, sketchbook.css);
  assert.deepEqual(paper.codeTheme, sketchbook.codeTheme);
});

test("bb.themes holds just those two, and every file they name exists", () => {
  assert.deepEqual(themes.map((theme) => theme.id).sort(), [LEGACY_THEME_ID, THEME_ID].sort());
  for (const theme of themes) {
    for (const file of [theme.css, theme.codeTheme?.light, theme.codeTheme?.dark]) {
      assert.ok(file, `${theme.id} names its css and both code themes`);
      assert.ok(file.startsWith("./themes/"), `${theme.id}: ${file} ships in themes/`);
      assert.ok(existsSync(resolved(file)), `${theme.id}: ${file} exists`);
    }
  }
});
