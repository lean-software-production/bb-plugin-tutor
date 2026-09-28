import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import {
  KIT_CSS,
  TOKENS_CSS,
  VENDORED_KIT,
  renderKitCss,
  renderTokensCss,
  specificity,
  transformKit,
} from "./build-kit.ts";

const vendored = readFileSync(VENDORED_KIT, "utf8");

/** The transformed rules, as `selector { decls }` with whitespace squeezed, for readable asserts. */
function flat(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
}

test("the palette and light-role :root blocks move onto the Tutor root", () => {
  const out = flat(transformKit(":root { --sk-mustard: #EEA306; }\n:root { --sk-page: var(--sk-paper); }"));
  assert.equal(out, ".tutor-sk { --sk-mustard: #EEA306; } .tutor-sk { --sk-page: var(--sk-paper); }");
});

test("the transform refuses a dark-mode selector: Tutor is light mode only", () => {
  assert.throws(() => transformKit(".dark, .sk-dark { --sk-page: var(--sk-ink); }"), /light mode only/);
  assert.throws(() => transformKit(".sk-dark .sk-panel { color: red; }"), /\.sk-dark/);
  assert.throws(() => transformKit(":is(.dark, .x) .sk-deep-teal { color: red; }"), /\.dark/);
});

test("other selectors get the scope on their subject compound, before any pseudo-element", () => {
  const cases: [string, string][] = [
    [".sk-panel::before", ".sk-panel:where(.tutor-sk, .tutor-sk *)::before"],
    [".sk-hl.sk-sweep", ".sk-hl.sk-sweep:where(.tutor-sk, .tutor-sk *)"],
    [".sk-btn:hover::before", ".sk-btn:hover:where(.tutor-sk, .tutor-sk *)::before"],
    [".sk-panel > .sk-drawing > img", ".sk-panel > .sk-drawing > img:where(.tutor-sk, .tutor-sk *)"],
    [".sk-arrow :is(line, path)", ".sk-arrow :is(line, path):where(.tutor-sk, .tutor-sk *)"],
    [
      ":is(.sk-a, .sk-b) .sk-deep-teal, .sk-deep-teal:is(.sk-a, .sk-b)",
      ":is(.sk-a, .sk-b) .sk-deep-teal:where(.tutor-sk, .tutor-sk *), .sk-deep-teal:is(.sk-a, .sk-b):where(.tutor-sk, .tutor-sk *)",
    ],
  ];
  for (const [input, expected] of cases) {
    assert.equal(flat(transformKit(`${input} { color: red; }`)), `${expected} { color: red; }`, input);
  }
});

test("keyframes are renamed with every animation that names them, and keyframe steps are left alone", () => {
  const out = flat(
    transformKit(
      ".sk-hl.sk-sweep { animation: sk-sweep .9s ease .3s both; }\n@keyframes sk-sweep { from { background-size: 0% 100%; } to { background-size: 100% 100%; } }",
    ),
  );
  assert.equal(
    out,
    ".sk-hl.sk-sweep:where(.tutor-sk, .tutor-sk *) { animation: tutor-sk-sweep .9s ease .3s both; } @keyframes tutor-sk-sweep { from { background-size: 0% 100%; } to { background-size: 100% 100%; } }",
  );
});

test("the reduced-motion block keeps its query and scopes its rule", () => {
  const out = flat(transformKit("@media (prefers-reduced-motion: reduce) { .sk-hl.sk-sweep { animation: none; } }"));
  assert.equal(out, "@media (prefers-reduced-motion: reduce) { .sk-hl.sk-sweep:where(.tutor-sk, .tutor-sk *) { animation: none; } }");
});

test("filter references are renamed; data URLs, whose ids are their own, are not", () => {
  const out = flat(
    transformKit('.sk-num::before { filter: url(#sk-wobble); background: url("data:image/svg+xml,%3Cpath%20filter%3D%22url%28%23f%29%22%2F%3E"); }'),
  );
  assert.match(out, /filter: url\(#tutor-sk-wobble\);/);
  assert.match(out, /url%28%23f%29/);
});

test("the remote font @import goes and the font stacks name the self-hosted Tutor families", () => {
  const out = flat(
    transformKit(
      `@import url("https://fonts.googleapis.com/css2?family=Luckiest+Guy");\n:root { --sk-font-title: 'Luckiest Guy', 'Patrick Hand SC', cursive; --sk-font-body: 'Patrick Hand', 'Comic Sans MS', cursive; }`,
    ),
  );
  assert.equal(
    out,
    `.tutor-sk { --sk-font-title: "Tutor Luckiest Guy", "Tutor Patrick Hand SC", cursive; --sk-font-body: "Tutor Patrick Hand", 'Comic Sans MS', cursive; }`,
  );
});

test("the transform refuses kit shapes it does not know how to scope", () => {
  assert.throws(() => transformKit("html .sk-panel { color: red; }"), /html/);
  assert.throws(() => transformKit(":root .sk-panel { color: red; }"), /:root/);
  assert.throws(() => transformKit(".sk-x { font-family: 'Some Other Face'; }"), /Some Other Face/);
});

test("specificity is computed the CSS way: :where adds nothing, :is takes its heaviest argument", () => {
  assert.deepEqual(specificity(".a:where(.b, .b *)::before"), [0, 1, 1]);
  assert.deepEqual(specificity(":is(.b, #x) .a"), [1, 1, 0]);
  assert.deepEqual(specificity(":root"), [0, 1, 0]);
  assert.deepEqual(specificity(".a > img"), [0, 1, 1]);
});

test("every transformed kit selector keeps its specificity", () => {
  const before = postcss.parse(vendored);
  const after = postcss.parse(transformKit(vendored));
  const rules = (root: postcss.Root) => {
    const found: postcss.Rule[] = [];
    root.walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/.test((rule.parent as postcss.AtRule).name)) return;
      found.push(rule);
    });
    return found;
  };
  const was = rules(before);
  const now = rules(after);
  assert.equal(now.length, was.length);
  was.forEach((rule, i) => {
    const original = rule.selectors;
    const scoped = now[i]!.selectors;
    assert.equal(scoped.length, original.length, rule.selector);
    original.forEach((selector, j) => {
      const [a, b, c] = specificity(selector);
      assert.deepEqual(specificity(scoped[j]!), [a, b, c], `${selector} -> ${scoped[j]}`);
      assert.ok(scoped[j]!.includes(".tutor-sk"), `${scoped[j]} is not scoped`);
    });
  });
});

test("app/sketch/kit.css is the transformed vendored kit (npm run build:assets)", () => {
  assert.equal(readFileSync(KIT_CSS, "utf8"), renderKitCss(vendored));
  const kit = readFileSync(KIT_CSS, "utf8");
  assert.doesNotMatch(kit, /googleapis|@import/);
  assert.doesNotMatch(kit, /url\(#sk-/);
  assert.match(kit, /@keyframes tutor-sk-sweep/);
});

test("app/sketch/tokens.css is generated (npm run build:assets) and aliases only kit roles the kit declares", () => {
  const tokens = readFileSync(TOKENS_CSS, "utf8");
  assert.equal(tokens, renderTokensCss());
  const declared = new Set(readFileSync(KIT_CSS, "utf8").match(/--sk-[\w-]+(?=\s*:)/g));
  for (const used of tokens.match(/var\(--sk-[\w-]+/g) ?? []) {
    assert.ok(declared.has(used.slice(4)), `${used.slice(4)} is not a kit token`);
  }
  for (const n of [1, 2, 3, 4, 5]) assert.match(tokens, new RegExp(`--tp-step-${n}: var\\(--sk-`));
  for (const name of ["title", "label", "body"]) assert.match(tokens, new RegExp(`--tp-font-${name}: var\\(--sk-font-${name}\\)`));
});
