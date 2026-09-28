import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHARACTERS,
  DEFS_TS,
  DRAWINGS_TS,
  ICONS,
  VENDORED_JS,
  drawingPath,
  extractDefs,
  renameDefs,
  renderDefsModule,
  renderDrawingsModule,
} from "./build-assets.ts";
import { DEFS_HTML, DEFS_ID } from "./defs.ts";
import { characters, icons } from "./drawings.ts";

test("the defs string is read out of the kit's script as the string it holds", () => {
  const js = 'x();\n  var defs = "<svg id=\\"sk-defs\\"><defs><filter id=\\"sk-wobble\\"/></defs></svg>";\n  go();';
  assert.equal(extractDefs(js), '<svg id="sk-defs"><defs><filter id="sk-wobble"/></defs></svg>');
  assert.throws(() => extractDefs("var other = 1;"), /var defs/);
});

test("renaming moves every kit id to tutor-sk-* and leaves other text alone", () => {
  assert.equal(
    renameDefs('<svg id="sk-defs"><filter id="sk-wobble-soft"/><path marker-end="url(#sk-head)" class="sk-x"/></svg>'),
    '<svg id="tutor-sk-defs"><filter id="tutor-sk-wobble-soft"/><path marker-end="url(#tutor-sk-head)" class="sk-x"/></svg>',
  );
});

test("the shipped defs hold the three wobble filters and the arrowhead, renamed, in a zero-size absolute svg", () => {
  assert.equal(DEFS_ID, "tutor-sk-defs");
  for (const id of ["tutor-sk-wobble", "tutor-sk-wobble-soft", "tutor-sk-wobble-line"]) {
    assert.match(DEFS_HTML, new RegExp(`<filter id="${id}"`));
  }
  assert.match(DEFS_HTML, /<marker id="tutor-sk-head"/);
  assert.match(DEFS_HTML, /^<svg id="tutor-sk-defs" width="0" height="0" style="position:absolute" aria-hidden="true">/);
  assert.doesNotMatch(DEFS_HTML, /id="sk-|#sk-/);
  // Firefox drops filters that live inside display:none.
  assert.doesNotMatch(DEFS_HTML, /display\s*:\s*none/);
});

test("app/sketch/defs.ts is generated from the vendored kit script (npm run build:assets)", () => {
  assert.equal(readFileSync(DEFS_TS, "utf8"), renderDefsModule(readFileSync(VENDORED_JS, "utf8")));
});

test("app/sketch/drawings.ts is generated from the vendored drawings (npm run build:assets)", () => {
  assert.equal(readFileSync(DRAWINGS_TS, "utf8"), renderDrawingsModule());
});

test("every drawing decodes byte for byte to its vendored file", () => {
  const cases: [string, string, Record<string, string>][] = [
    ...ICONS.map((name): [string, string, Record<string, string>] => ["icons", name, icons]),
    ...CHARACTERS.map((name): [string, string, Record<string, string>] => ["characters", name, characters]),
  ];
  assert.equal(cases.length, 7);
  for (const [kind, name, map] of cases) {
    const url = map[name];
    assert.ok(url, `${kind}/${name} is shipped`);
    const prefix = "data:image/svg+xml;base64,";
    assert.ok(url.startsWith(prefix), `${kind}/${name} is a base64 svg data URL`);
    const bytes = Buffer.from(url.slice(prefix.length), "base64");
    assert.ok(bytes.equals(readFileSync(drawingPath(kind as "icons" | "characters", name))), `${kind}/${name}`);
  }
});
