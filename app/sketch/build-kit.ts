// Generates the Sketchbook kit as Tutor ships it, and Tutor's own tokens.
// Regenerate: npm run build:assets
//
// app/sketch/kit.css is vendor/brand/kit/sketchbook.css (pinned by
// scripts/sync-brand.ts) put through transformKit, a mechanical rewrite that
// keeps the kit from reaching the rest of BB. Plugin CSS is global: it loads on
// every BB page, so the kit as-is would set --sk-* on :root and style .sk-*
// everywhere, and a second plugin vendoring another kit pin would collide with
// its classes, filter ids and keyframes. The transform:
//   1. drops the Google Fonts @import (the fonts are self-hosted, app/fonts);
//   2. moves the :root token blocks onto .tutor-sk, and the bare .dark of the
//      dark-role block to `.dark .tutor-sk` (BB puts .dark on <html>);
//   3. adds :where(.tutor-sk, .tutor-sk *) to the subject of every other
//      selector, before any pseudo-element, so a kit rule only matches inside a
//      Tutor root and keeps its specificity (:where counts for nothing);
//   4. renames the filter ids to tutor-sk-* in url(#…) and the keyframes to
//      tutor-sk-*, matching app/sketch/defs.ts;
//   5. names the self-hosted "Tutor …" families in the font stacks.
// A problem in the kit is fixed in the brand repo and re-pinned, never here.
//
// app/sketch/tokens.css holds Tutor's --tp-* tokens: thin aliases of the kit's
// roles (and of BB's muted text, as the mockup uses). Component CSS paints
// with these and never with a literal colour (app/styles/scope.test.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export const VENDORED_KIT = path("../../vendor/brand/kit/sketchbook.css");
export const KIT_CSS = path("./kit.css");
export const TOKENS_CSS = path("./tokens.css");
const BRAND_PIN = () => readFileSync(path("../../vendor/brand/PIN"), "utf8").trim();

/** The class every Tutor surface root carries. */
export const ROOT = "tutor-sk";
/** Kit ids (filters, marker) and keyframes get this prefix in place of `sk-`. */
export const ID_PREFIX = "tutor-sk-";

/** The brand families and their self-hosted names (app/fonts/embed.ts). */
export const FONT_NAMES: Readonly<Record<string, string>> = {
  "Luckiest Guy": "Tutor Luckiest Guy",
  "Patrick Hand": "Tutor Patrick Hand",
  "Patrick Hand SC": "Tutor Patrick Hand SC",
};
/** Fallbacks the kit may name that are not brand faces: left as they are. */
const SYSTEM_FONTS = new Set(["Comic Sans MS"]);

const isKeyframes = (node: postcss.Container | postcss.Document | undefined): boolean =>
  node?.type === "atrule" && /keyframes$/.test((node as postcss.AtRule).name);

function scopePseudo(): selectorParser.Pseudo {
  const where = selectorParser.pseudo({ value: ":where" });
  const self = selectorParser.selector({ value: "", nodes: [] });
  self.append(selectorParser.className({ value: ROOT }));
  const inside = selectorParser.selector({ value: "", nodes: [] });
  const insideRoot = selectorParser.className({ value: ROOT });
  insideRoot.spaces.before = " ";
  inside.append(insideRoot);
  inside.append(selectorParser.combinator({ value: " " }));
  inside.append(selectorParser.universal({ value: "*" }));
  where.append(self);
  where.append(inside);
  return where;
}

const isPseudoElement = (node: selectorParser.Node): boolean => node.type === "pseudo" && node.value.startsWith("::");

function scopeSelector(selector: string): string {
  return selectorParser((selectors) => {
    selectors.each((complex) => {
      const text = complex.toString().trim();
      if (text === ":root") {
        complex.replaceWith(selectorParser.selector({ value: "", nodes: [selectorParser.className({ value: ROOT })] }));
        return;
      }
      if (text === ".dark") {
        const scoped = selectorParser.selector({ value: "", nodes: [] });
        scoped.append(selectorParser.className({ value: "dark" }));
        scoped.append(selectorParser.combinator({ value: " " }));
        scoped.append(selectorParser.className({ value: ROOT }));
        scoped.spaces.before = complex.spaces.before;
        complex.replaceWith(scoped);
        return;
      }
      complex.walk((node) => {
        if (node.type === "tag" && ["html", "body"].includes(node.value)) throw new Error(`kit selector "${text}" names ${node.value}`);
        if (node.type === "pseudo" && node.value === ":root") throw new Error(`kit selector "${text}" uses :root beyond a token block`);
      });
      // The subject compound starts after the last top-level combinator.
      const nodes = complex.nodes;
      let start = 0;
      nodes.forEach((node, index) => {
        if (node.type === "combinator") start = index + 1;
      });
      const pseudoElement = nodes.slice(start).find(isPseudoElement);
      if (pseudoElement) complex.insertBefore(pseudoElement, scopePseudo());
      else complex.append(scopePseudo());
    });
  }).processSync(selector);
}

function renameFonts(value: string): string {
  return value.replace(/(["'])([^"']+)\1/g, (whole, _quote: string, family: string) => {
    const renamed = FONT_NAMES[family];
    if (renamed !== undefined) return `"${renamed}"`;
    if (SYSTEM_FONTS.has(family)) return whole;
    throw new Error(`the kit names a font Tutor does not self-host: ${family}`);
  });
}

/** The kit, scoped under .tutor-sk. Pure: the same input always gives the same output. */
export function transformKit(css: string): string {
  const root = postcss.parse(css);
  root.walkAtRules("import", (rule) => {
    rule.remove();
  });
  const keyframes = new Map<string, string>();
  root.walkAtRules(/keyframes$/, (rule) => {
    const renamed = rule.params.replace(/^sk-/, ID_PREFIX);
    keyframes.set(rule.params, renamed);
    rule.params = renamed;
  });
  root.walkRules((rule) => {
    if (isKeyframes(rule.parent)) return;
    rule.selector = scopeSelector(rule.selector);
  });
  root.walkDecls((decl) => {
    decl.value = decl.value.replace(/url\(#sk-/g, `url(#${ID_PREFIX}`);
    if (/^(-webkit-)?animation(-name)?$/.test(decl.prop)) {
      decl.value = decl.value.replace(/[\w-]+/g, (word) => keyframes.get(word) ?? word);
    }
    if (decl.prop.startsWith("--sk-font-") || decl.prop === "font-family" || decl.prop === "font") {
      decl.value = renameFonts(decl.value);
    }
  });
  return root.toString();
}

export function renderKitCss(vendored: string = readFileSync(VENDORED_KIT, "utf8")): string {
  const header = `/* Generated by app/sketch/build-kit.ts from vendor/brand/kit/sketchbook.css (brand ${BRAND_PIN()}). Do not edit. */\n`;
  return header + transformKit(vendored).replace(/^\n+/, "");
}

/** [name, value] per token, in groups. Values are var() aliases or mixes of them, never literals. */
export const TOKENS: readonly { comment: string; tokens: readonly [string, string][] }[] = [
  {
    comment: "Step colours, in list order (app/sketch/step-colour.ts): lesson n is step n % 5 + 1.",
    tokens: [
      ["--tp-step-1", "var(--sk-mustard)"],
      ["--tp-step-2", "var(--sk-teal)"],
      ["--tp-step-3", "var(--sk-forest)"],
      ["--tp-step-4", "var(--sk-coral)"],
      ["--tp-step-5", "var(--sk-blue)"],
    ],
  },
  {
    comment: "Surfaces and text. Muted text is BB's, as on the rest of the page.",
    tokens: [
      ["--tp-page", "var(--sk-page)"],
      ["--tp-page-veil", "color-mix(in oklab, var(--sk-page) 60%, transparent)"],
      ["--tp-text", "var(--sk-text)"],
      ["--tp-title", "var(--sk-title-text)"],
      ["--tp-muted", "var(--muted-foreground, var(--sk-text))"],
      ["--tp-faint", "color-mix(in oklab, var(--sk-text) 45%, var(--sk-page))"],
      ["--tp-line", "var(--sk-line)"],
      ["--tp-rule", "color-mix(in oklab, var(--sk-line) 18%, var(--sk-page))"],
      ["--tp-rule-soft", "color-mix(in oklab, var(--sk-line) 9%, var(--sk-page))"],
      ["--tp-hover", "color-mix(in oklab, var(--sk-line) 7%, var(--sk-page))"],
      ["--tp-code-bg", "color-mix(in oklab, var(--sk-line) 5%, var(--sk-page))"],
      ["--tp-track", "var(--sk-track)"],
      ["--tp-bubble", "var(--sk-bubble-fill)"],
      ["--tp-swash", "var(--sk-swash)"],
      ["--tp-loop", "var(--sk-loop)"],
      ["--tp-shadow", "0 1px 2px color-mix(in oklab, var(--sk-line) 8%, transparent), 0 10px 30px color-mix(in oklab, var(--sk-line) 6%, transparent)"],
    ],
  },
  {
    comment: "Heading teal: links, focus, the primary action.",
    tokens: [
      ["--tp-heading", "var(--sk-heading)"],
      ["--tp-on-heading", "var(--sk-on-heading)"],
      ["--tp-heading-wash", "color-mix(in oklab, var(--sk-heading) var(--sk-wash-amount), var(--sk-page))"],
      ["--tp-heading-line", "color-mix(in oklab, var(--sk-heading) 40%, var(--sk-page))"],
    ],
  },
  {
    comment: "States: holds (forest), not yet (rust), new (mustard), broken (coral), real run (blue).",
    tokens: [
      ["--tp-good", "var(--sk-forest-text)"],
      ["--tp-good-fill", "var(--sk-forest)"],
      ["--tp-on-good", "var(--sk-paper)"],
      ["--tp-good-wash", "color-mix(in oklab, var(--sk-forest) var(--sk-wash-amount), var(--sk-page))"],
      ["--tp-good-line", "color-mix(in oklab, var(--sk-forest) 40%, var(--sk-page))"],
      ["--tp-warn", "var(--sk-rust-text)"],
      ["--tp-warn-wash", "color-mix(in oklab, var(--sk-rust) var(--sk-wash-amount), var(--sk-page))"],
      ["--tp-warn-line", "color-mix(in oklab, var(--sk-rust) 40%, var(--sk-page))"],
      ["--tp-new", "var(--sk-mustard-text)"],
      ["--tp-bad", "var(--sk-coral-text)"],
      ["--tp-bad-wash", "color-mix(in oklab, var(--sk-coral) var(--sk-wash-amount), var(--sk-page))"],
      ["--tp-bad-line", "color-mix(in oklab, var(--sk-coral) 40%, var(--sk-page))"],
      ["--tp-other", "var(--sk-blue-text)"],
      ["--tp-other-wash", "color-mix(in oklab, var(--sk-blue) var(--sk-wash-amount), var(--sk-page))"],
      ["--tp-other-line", "color-mix(in oklab, var(--sk-blue) 40%, var(--sk-page))"],
    ],
  },
  {
    comment: "Type: the kit's three hands (self-hosted), and BB's mono for code.",
    tokens: [
      ["--tp-font-title", "var(--sk-font-title)"],
      ["--tp-font-label", "var(--sk-font-label)"],
      ["--tp-font-body", "var(--sk-font-body)"],
      ["--tp-font-mono", "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)"],
    ],
  },
];

export function renderTokensCss(): string {
  const lines = [
    `/* Generated by app/sketch/build-kit.ts: Tutor's tokens, aliases of the kit's roles. Do not edit. */`,
    `.${ROOT} {`,
  ];
  TOKENS.forEach((group, index) => {
    if (index > 0) lines.push("");
    lines.push(`  /* ${group.comment} */`);
    for (const [name, value] of group.tokens) lines.push(`  ${name}: ${value};`);
  });
  lines.push("}", "");
  return lines.join("\n");
}

/** CSS specificity as [ids, classes, types], with :where, :is, :not and :has as the spec has them. */
export function specificity(selector: string): [number, number, number] {
  const ast = selectorParser().astSync(selector);
  const ofSelector = (sel: selectorParser.Selector): [number, number, number] => {
    const total: [number, number, number] = [0, 0, 0];
    for (const node of sel.nodes) {
      const add = ofNode(node);
      total[0] += add[0];
      total[1] += add[1];
      total[2] += add[2];
    }
    return total;
  };
  const heaviest = (list: selectorParser.Selector[]): [number, number, number] =>
    list.map(ofSelector).reduce<[number, number, number]>(
      (best, next) => (next[0] > best[0] || (next[0] === best[0] && (next[1] > best[1] || (next[1] === best[1] && next[2] > best[2]))) ? next : best),
      [0, 0, 0],
    );
  const ofNode = (node: selectorParser.Node): [number, number, number] => {
    switch (node.type) {
      case "id":
        return [1, 0, 0];
      case "class":
      case "attribute":
        return [0, 1, 0];
      case "tag":
        return [0, 0, 1];
      case "pseudo": {
        if (node.value.startsWith("::")) return [0, 0, 1];
        if (node.value === ":where") return [0, 0, 0];
        if ([":is", ":not", ":has", ":matches"].includes(node.value)) return heaviest(node.nodes);
        return [0, 1, 0];
      }
      default:
        return [0, 0, 0];
    }
  };
  if (ast.nodes.length !== 1) throw new Error(`specificity takes one selector, got "${selector}"`);
  return ofSelector(ast.nodes[0]!);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(KIT_CSS, renderKitCss());
  writeFileSync(TOKENS_CSS, renderTokensCss());
}
