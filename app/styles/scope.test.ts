// Plugin CSS is global: it loads on every BB page. So nothing here may reach
// BB's own UI. Tutor's stylesheets start every selector at a Tutor root and
// name only tp-* classes; the generated kit (app/sketch/kit.css) may use its
// sk-* classes and --sk-* tokens, but only inside a .tutor-sk root. Component
// CSS paints with --tp-* tokens (app/sketch/tokens.css), never literal colours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
// .tutor-sk is every Tutor surface; .tutor-nav is the sidebar navigation, drawn with BB's tokens (styles/nav.css).
const ROOTS = [".tutor-sk", ".tutor-nav"];
const KIT = `${APP_DIR}sketch/kit.css`;
const TOKENS = `${APP_DIR}sketch/tokens.css`;
// BB's dark-mode class on <html>: a Tutor selector may start with it.
const MODE_PREFIX = /^\.dark\s+/;
/** A root written as `:where(.root)` (no specificity) counts as the root. */
const unwrapRoot = (selector: string) => selector.replace(/^:where\((\.[\w-]+)\)/, "$1");

/** Tutor's own stylesheets: the entry, the generated tokens and the component styles. */
function stylesheets(): string[] {
  const styles = readdirSync(`${APP_DIR}styles`)
    .filter((name) => name.endsWith(".css"))
    .map((name) => `${APP_DIR}styles/${name}`);
  return [`${APP_DIR}sketchbook.css`, TOKENS, ...styles];
}

/** Selectors of style rules, skipping keyframe steps. */
function selectors(css: string): string[] {
  const found: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    const parent = rule.parent;
    if (parent?.type === "atrule" && /keyframes$/.test((parent as postcss.AtRule).name)) return;
    found.push(...rule.selectors);
  });
  return found;
}

/** Declared custom properties. */
function customProperties(css: string): string[] {
  const found: string[] = [];
  postcss.parse(css).walkDecls(/^--/, (decl) => {
    found.push(decl.prop);
  });
  return found;
}

// The CSS named colours (CSS Color 4), minus transparent and currentColor, which carry no colour of their own.
const NAMED = "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ");
const NAMED_COLOUR = new RegExp(`(?<![\\w-])(${NAMED.join("|")})(?![\\w-])`, "i");
const COLOUR_FUNCTION = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX = /#[0-9a-f]{3,8}(?![\w-])/i;

/** The literal colours a declaration value holds, ignoring custom-property names and strings. */
export function literalColours(value: string): string[] {
  const bare = value.replace(/--[\w-]+/g, "").replace(/(["'])(?:(?!\1).)*\1/g, "");
  return [HEX, COLOUR_FUNCTION, NAMED_COLOUR].flatMap((pattern) => bare.match(pattern)?.[0] ?? []);
}

test("the rule reader sees rules inside media queries and skips keyframe steps", () => {
  assert.deepEqual(
    selectors("@import 'x.css'; .a, .b > i { x: 1 } @media (w) { .c { y: 2 } } @keyframes k { 50% { z: 3 } }"),
    [".a", ".b > i", ".c"],
  );
});

test("the literal-colour finder catches hex, colour functions and names, and not token names or keywords", () => {
  assert.deepEqual(literalColours("1px solid #fff"), ["#fff"]);
  assert.deepEqual(literalColours("0 1px 2px rgb(0 0 0 / 0.1)"), ["rgb("]);
  assert.deepEqual(literalColours("color-mix(in oklab, var(--tp-rule) 40%, white)"), ["white"]);
  assert.deepEqual(literalColours("oklch(0.5 0.1 200)"), ["oklch("]);
  assert.deepEqual(literalColours("var(--tp-green) var(--sk-teal)"), []);
  assert.deepEqual(literalColours("color-mix(in oklab, var(--tp-page) 60%, transparent)"), []);
  assert.deepEqual(literalColours("currentColor"), []);
  assert.deepEqual(literalColours('"Comic Sans MS", cursive'), []);
});

test("every Tutor selector is scoped under a Tutor root and uses tp-* classes", () => {
  for (const file of stylesheets()) {
    for (const selector of selectors(readFileSync(file, "utf8"))) {
      const unprefixed = unwrapRoot(selector.replace(MODE_PREFIX, ""));
      assert.ok(
        ROOTS.some((root) => unprefixed.startsWith(root)),
        `${file}: "${selector}" must start with ${ROOTS.join(" or ")} (optionally after .dark)`,
      );
      for (const className of unprefixed.match(/\.[\w-]+/g) ?? []) {
        assert.ok(
          ROOTS.includes(className) || className.startsWith(".tp-"),
          `${file}: "${selector}" uses ${className}; plugin classes are tp-*`,
        );
      }
    }
  }
});

test("every kit selector matches only inside a .tutor-sk root and names only kit classes", () => {
  const css = readFileSync(KIT, "utf8");
  const found = selectors(css);
  assert.ok(found.length > 50, "the kit has its rules");
  for (const selector of found) {
    assert.ok(selector.includes(".tutor-sk"), `kit.css: "${selector}" is not scoped to .tutor-sk`);
    for (const className of selector.match(/\.[\w-]+/g) ?? []) {
      assert.ok(
        [".tutor-sk", ".dark"].includes(className) || className.startsWith(".sk-"),
        `kit.css: "${selector}" uses ${className}`,
      );
    }
  }
  for (const name of customProperties(css)) assert.ok(name.startsWith("--sk-"), `kit.css: ${name} must be --sk-*`);
});

test("Tutor's custom properties are --tp-* so BB's own tokens and the kit's are never shadowed", () => {
  for (const file of stylesheets()) {
    for (const name of customProperties(readFileSync(file, "utf8"))) {
      assert.ok(name.startsWith("--tp-"), `${file}: ${name} must be --tp-*`);
    }
  }
});

test("Tutor's stylesheets hold no literal colours: they paint with the --tp-* tokens", () => {
  for (const file of stylesheets()) {
    postcss.parse(readFileSync(file, "utf8")).walkDecls((decl) => {
      const found = literalColours(decl.value);
      assert.deepEqual(found, [], `${file}: ${decl.parent && "selector" in decl.parent ? decl.parent.selector : ""} { ${decl.prop}: ${decl.value} }`);
    });
  }
});

/** Every className string literal in the app's TSX. */
function classNames(): { file: string; value: string }[] {
  const found: { file: string; value: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) {
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
          found.push({ file: full, value: match[1] ?? match[2] ?? "" });
        }
      }
    }
  };
  walk(`${REPO_DIR}app`);
  return found;
}

test("no Tutor root carries a kit colour modifier: `.dark .tutor-sk` would beat it", () => {
  const MODIFIER = /(?<![\w-])sk-(mustard|teal|forest|coral|blue|rust|deep-teal)(?![\w-])/;
  const roots = classNames().filter(({ value }) => /(?<![\w-])tutor-sk(?![\w-])/.test(value));
  assert.ok(roots.length > 5, "the app's surfaces carry .tutor-sk");
  for (const { file, value } of roots) assert.doesNotMatch(value, MODIFIER, `${file}: className "${value}"`);
});

test("the paper-era roots are gone from the app", () => {
  for (const { file, value } of classNames()) {
    assert.doesNotMatch(value, /(?<![\w-])tutor-(paper|grid)(?![\w-])/, `${file}: className "${value}"`);
  }
});
