// The lesson page (app/ui/Lesson.tsx, an <article class="tp-lesson">) and the
// course outline (app/ui/Outline.tsx, an <li class="tp-lesson"> per lesson)
// share the tp-lesson and tp-lesson-title hook classes. The lesson page's
// rules (styles/lesson.css) must not reach the outline: the page's 46px title
// once did, and every lesson in the sidebar was drawn at page-title size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

type El = { tag: string; classes: string[] };
const el = (tag: string, ...classes: string[]): El => ({ tag, classes });

/** The outline's lesson row, from the page root down to its title (Outline.tsx). */
const OUTLINE_ROW: El[] = [
  el("html"),
  el("body"),
  el("div"),
  el("nav", "tutor-sk", "tp-outline"),
  el("ul", "tp-tree"),
  el("li", "tp-lesson", "tp-lesson--current", "tp-lesson--viewed"),
  el("button", "tp-lesson-head"),
  el("span", "tp-lesson-title", "tp-ltitle"),
];
/** The lesson page's title, as the start page mounts it (StartPage.tsx, Lesson.tsx). */
const LESSON_TITLE: El[] = [
  el("html"),
  el("body"),
  el("div", "tutor-sk", "tp-lt"),
  el("div", "tutor-sk", "tp-lead"),
  el("article", "tp-lesson"),
  el("h1", "sk-title", "tp-page-title", "tp-lesson-title"),
];

type Compound = selectorParser.Node[];

/** Whether one compound selector (no combinators) matches an element. Pseudo-classes other than :where/:is/:not are taken to match. */
function compoundMatches(compound: Compound, element: El): boolean {
  return compound.every((node) => {
    if (node.type === "tag") return node.value.toLowerCase() === element.tag;
    if (node.type === "class") return element.classes.includes(node.value);
    if (node.type === "universal") return true;
    if (node.type === "attribute" || node.type === "id") return false;
    if (node.type === "pseudo") {
      if (node.value.startsWith("::")) return false; // styles a pseudo-element, not this element
      const inner = (node.nodes ?? []).map((s) => (s as selectorParser.Selector).nodes);
      if (node.value === ":where" || node.value === ":is") return inner.some((c) => !c.some((n) => n.type === "combinator") && compoundMatches(c, element));
      if (node.value === ":not") return !inner.some((c) => !c.some((n) => n.type === "combinator") && compoundMatches(c, element));
      return true;
    }
    return true;
  });
}

/** Whether a complex selector (descendant and child combinators) matches the last element of `chain`. */
function matches(selector: selectorParser.Selector, chain: El[]): boolean {
  const parts: { compound: Compound; combinator: string }[] = [];
  let current: Compound = [];
  for (const node of selector.nodes) {
    if (node.type === "combinator") {
      parts.push({ compound: current, combinator: node.value.trim() === "" ? " " : node.value.trim() });
      current = [];
    } else if (node.type !== "comment") current.push(node);
  }
  parts.push({ compound: current, combinator: "" });
  const match = (p: number, i: number): boolean => {
    const part = parts[p];
    const element = chain[i];
    if (part === undefined || element === undefined || !compoundMatches(part.compound, element)) return false;
    if (p === 0) return true;
    const combinator = parts[p - 1]?.combinator;
    if (combinator === ">") return i > 0 && match(p - 1, i - 1);
    if (combinator === " ") {
      for (let j = i - 1; j >= 0; j -= 1) if (match(p - 1, j)) return true;
      return false;
    }
    return false; // sibling combinators: no siblings are modelled
  };
  return match(parts.length - 1, chain.length - 1);
}

/** The lesson page's style rules that match some element of `chain` (each as "selector { props }"). */
function lessonRulesReaching(chain: El[]): string[] {
  const css = readFileSync(new URL("./lesson.css", import.meta.url), "utf8");
  const found: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test((rule.parent as postcss.AtRule).name)) return;
    const props = rule.nodes.filter((n) => n.type === "decl").map((n) => (n as postcss.Declaration).prop);
    selectorParser((root) => {
      root.each((selector) => {
        for (let end = 1; end <= chain.length; end += 1) {
          if (matches(selector, chain.slice(0, end))) {
            const reached = chain[end - 1]!;
            found.push(`${selector.toString().trim()} { ${props.join(", ")} } reaches <${reached.tag} class="${reached.classes.join(" ")}">`);
            break;
          }
        }
      });
    }).processSync(rule.selector);
  });
  return found;
}

test("no lesson-page rule reaches the course outline's lesson rows", () => {
  const reaching = lessonRulesReaching(OUTLINE_ROW);
  assert.deepEqual(reaching, [], `lesson.css rules reach the outline:\n${reaching.join("\n")}`);
});

test("the lesson page's own title still gets its page-title size", () => {
  const css = readFileSync(new URL("./lesson.css", import.meta.url), "utf8");
  const sizes: string[] = [];
  postcss.parse(css).walkDecls("font-size", (decl) => {
    const rule = decl.parent as postcss.Rule;
    if (rule.parent?.type === "atrule") return; // the base size, not a media override
    selectorParser((root) => {
      root.each((selector) => {
        if (matches(selector, LESSON_TITLE)) sizes.push(decl.value);
      });
    }).processSync(rule.selector);
  });
  assert.deepEqual(sizes, ["46px"]);
});
