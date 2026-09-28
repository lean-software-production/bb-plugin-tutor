// The Sketchbook code themes (VS Code format, `bb.themes[].codeTheme`), built
// from the vendored kit tokens (vendor/brand/kit/tokens.json) so they follow
// the brand when the pin moves. Written by app/theme/build.ts.
//
// Both modes share one scope map; only the colours differ. The background is
// the mode's page (the theme's --canvas), and every foreground must read at
// 4.5:1 on it (theme.test.ts). Palette colours are not text colours on paper
// (mustard, coral and teal fail), so the choices are:
//   comment      ink tint at 62% (the theme's --subtle-foreground share), italic
//   keyword      deep-teal-text (the theme's --primary)
//   string       forest-text
//   number       rust-text (constants too)
//   function     blue-text
//   type         mustard-text (the theme's --warning-text)
//   variable     text (body text; paper in dark mode)
//   punctuation  ink tint at 70% (the theme's --muted-foreground share)
//   invalid      coral-text (removed lines too)
// The -text roles are the kit's text-safe variants: mixed with ink in light
// mode and with paper in dark mode. The ink tints mix the mode's text anchor
// into its page, as the theme does.
import { readFileSync } from "node:fs";
import { resolveColor, toBytes, type Tokens } from "./color.ts";

type Mode = "light" | "dark";

interface KitTokens {
  color: Record<string, string>;
  role: Record<string, { light: string; dark: string; use: string }>;
}

export interface CodeTheme {
  name: string;
  type: Mode;
  colors: Record<string, string>;
  tokenColors: { name: string; scope: string[]; settings: { foreground?: string; fontStyle?: string } }[];
}

const KIT_TOKENS = new URL("../../vendor/brand/kit/tokens.json", import.meta.url);

/** The kit's palette and each role's value in `mode`, as the kit's `--sk-*` custom properties. */
export function kitTokens(mode: Mode, kit: KitTokens = JSON.parse(readFileSync(KIT_TOKENS, "utf8")) as KitTokens): Tokens {
  const tokens: Record<string, string> = {};
  for (const [name, value] of Object.entries(kit.color)) tokens[`--sk-${name}`] = value;
  for (const [name, role] of Object.entries(kit.role)) tokens[`--sk-${name}`] = role[mode];
  // The anchor text colour of each mode: ink on paper, paper on ink.
  tokens["--tutor-anchor"] = mode === "light" ? "var(--sk-ink)" : "var(--sk-paper)";
  return tokens;
}

const hex = (expr: string, tokens: Tokens, alpha?: string): string => {
  const colour = resolveColor(expr, tokens);
  if (colour.alpha !== 1) throw new Error(`${expr} is translucent; code theme colours are solid`);
  return `#${toBytes(colour).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}${alpha ?? ""}`;
};

// Mixed in oklab, not oklch: Chromium drops the hue of a near-grey colour in
// oklch, which tints ink-into-paper mixes pink. A code theme holds fixed hex
// values, so it can take the warm grey the mix is meant to be.
const inkTint = (percent: number) => `color-mix(in oklab, var(--tutor-anchor) ${percent}%, var(--sk-page))`;

/** The one scope map, category by category, with the kit expression each category is painted with. */
const SCOPES: { name: string; scope: string[]; colour: string; fontStyle?: string }[] = [
  { name: "comment", scope: ["comment", "punctuation.definition.comment"], colour: inkTint(62), fontStyle: "italic" },
  {
    name: "keyword",
    scope: ["keyword", "keyword.control", "keyword.operator.new", "storage", "storage.type", "storage.modifier", "entity.name.tag"],
    colour: "var(--sk-deep-teal-text)",
  },
  { name: "string", scope: ["string", "string.template", "punctuation.definition.string", "markup.inserted"], colour: "var(--sk-forest-text)" },
  { name: "number", scope: ["constant.numeric", "constant.language", "constant.character", "constant.other"], colour: "var(--sk-rust-text)" },
  { name: "function", scope: ["entity.name.function", "support.function", "meta.function-call"], colour: "var(--sk-blue-text)" },
  {
    name: "type",
    scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class", "entity.other.attribute-name"],
    colour: "var(--sk-mustard-text)",
  },
  { name: "variable", scope: ["variable", "variable.parameter", "meta.object-literal.key", "support.variable.property"], colour: "var(--sk-text)" },
  { name: "punctuation", scope: ["punctuation", "meta.brace", "keyword.operator"], colour: inkTint(70) },
  { name: "invalid", scope: ["invalid", "markup.deleted"], colour: "var(--sk-coral-text)" },
];

export function codeTheme(mode: Mode, tokens: Tokens = kitTokens(mode)): CodeTheme {
  return {
    name: `tutor-sketchbook-${mode}`,
    type: mode,
    colors: {
      "editor.background": hex("var(--sk-page)", tokens),
      "editor.foreground": hex("var(--sk-text)", tokens),
      "editorLineNumber.foreground": hex(inkTint(62), tokens),
      "editorLineNumber.activeForeground": hex("var(--sk-text)", tokens),
      "editor.selectionBackground": hex("var(--sk-swash)", tokens),
      "editor.lineHighlightBackground": hex(inkTint(5), tokens),
      "diffEditor.insertedTextBackground": hex("var(--sk-forest-text)", tokens, "26"),
      "diffEditor.removedTextBackground": hex("var(--sk-coral-text)", tokens, "26"),
      "diffEditor.insertedLineBackground": hex("var(--sk-forest-text)", tokens, "14"),
      "diffEditor.removedLineBackground": hex("var(--sk-coral-text)", tokens, "14"),
    },
    tokenColors: [
      ...SCOPES.map(({ name, scope, colour, fontStyle }) => ({
        name,
        scope,
        settings: { foreground: hex(colour, tokens), ...(fontStyle ? { fontStyle } : {}) },
      })),
      { name: "heading", scope: ["markup.heading"], settings: { fontStyle: "bold" } },
      { name: "bold", scope: ["markup.bold"], settings: { fontStyle: "bold" } },
      { name: "italic", scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    ],
  };
}

export function renderCodeTheme(mode: Mode): string {
  return `${JSON.stringify(codeTheme(mode), null, 2)}\n`;
}
