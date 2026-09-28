// The Tutor's words follow the brand's voice (vendor/brand/VOICE.md). Every
// string the app could show, a string literal, template text or JSX text in
// app/**/*.{ts,tsx} and the entry app.tsx, is checked against the words VOICE.md avoids and its
// "at most one exclamation mark". Tests and comments are not shown, so they
// are skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const VOICE = fileURLToPath(new URL("../vendor/brand/VOICE.md", import.meta.url));
const ENTRY = fileURLToPath(new URL("../app.tsx", import.meta.url));

/**
 * The avoided words from VOICE.md's "Words we avoid" line: the plain list
 * before the first semicolon, then every quoted word or phrase after it.
 */
function avoidedWords(voice: string): string[] {
  const line = voice.split("\n").find((text) => text.startsWith("**Words we avoid:**"));
  if (line === undefined) throw new Error("VOICE.md has no **Words we avoid:** line");
  const body = line.slice("**Words we avoid:**".length);
  const plain = (body.split(";")[0] ?? "").split(",").map((word) => word.trim());
  const quoted = [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
  return [...plain, ...quoted].filter((word) => word !== "");
}

/** Every .ts/.tsx source under app/, tests left out. */
function sources(dir = APP_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return sources(`${path}/`);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** A path as the failure message shows it. */
const shortName = (path: string) => (path === ENTRY ? "app.tsx" : `app/${path.slice(APP_DIR.length)}`);

/** The text of every string literal, template piece and JSX text in a source. */
function visibleStrings(fileName: string, text: string): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    // Module specifiers name files, not words anyone reads.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push(node.text);
    } else if (ts.isJsxText(node) && node.text.trim() !== "") {
      found.push(node.text.trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The avoided words `text` uses, matched as whole words, any case. */
function avoidedIn(text: string, words: readonly string[]): string[] {
  return words.filter((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

test("VOICE.md's avoided words are read in full", () => {
  assert.deepEqual(avoidedWords(readFileSync(VOICE, "utf8")), [
    "leverage",
    "utilise",
    "synergy",
    "seamless",
    "robust",
    "revolutionary",
    "game-changing",
    "simply",
    "just",
    "easy",
    "obviously",
    "users",
    "please note",
  ]);
});

test("the checker finds string literals, template text and JSX text, and matches whole words", () => {
  const strings = visibleStrings(
    "x.tsx",
    'import "./just.css";\nconst a = "Simply click";\nconst b = `ready ${a} just now`;\n// just a comment\nconst c = <p>It is easy</p>;',
  );
  assert.deepEqual(strings, ["Simply click", "ready ", " just now", "It is easy"]);
  assert.deepEqual(avoidedIn("Adjusting robustness", ["just", "robust"]), [], "only whole words count");
  assert.deepEqual(avoidedIn("Please note: it's easy", ["easy", "please note"]), ["easy", "please note"]);
});

test("no string the app shows uses a word VOICE.md avoids, or more than one exclamation mark", () => {
  const words = avoidedWords(readFileSync(VOICE, "utf8"));
  const problems: string[] = [];
  for (const path of [ENTRY, ...sources()]) {
    for (const text of visibleStrings(path, readFileSync(path, "utf8"))) {
      const used = avoidedIn(text, words);
      if (used.length > 0) problems.push(`${shortName(path)}: "${text}" uses ${used.join(", ")}`);
      if ((text.match(/!/g) ?? []).length > 1 && /[a-z]/i.test(text)) {
        problems.push(`${shortName(path)}: "${text}" has more than one exclamation mark`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
