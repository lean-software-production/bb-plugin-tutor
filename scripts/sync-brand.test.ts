import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANIFEST, VENDOR_DIR, checkBrand, extractVoice, rawUrl, syncBrand, type Fetcher } from "./sync-brand.ts";

const SHA = "6790d6583f0c3eb27cea9b13a637400fe96bbf3d";

const README = [
  "# Brand",
  "",
  "Intro.",
  "",
  "## Voice and tone",
  "",
  "We sound like a friendly colleague.",
  "",
  "### Headlines",
  "",
  "Short statements.",
  "",
  "## What's in this repo",
  "",
  "- a deck",
  "",
].join("\n");

/** A fake raw.githubusercontent.com: every manifest path at SHA, plus README.md. */
function fakeFetcher(overrides: Record<string, string> = {}): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  const fetcher = async (url: string): Promise<Uint8Array> => {
    urls.push(url);
    const prefix = rawUrl(SHA, "");
    if (!url.startsWith(prefix)) throw new Error(`unexpected url ${url}`);
    const path = url.slice(prefix.length);
    if (path in overrides) return Buffer.from(overrides[path] ?? "");
    if (path === "README.md") return Buffer.from(README);
    if (!MANIFEST.includes(path)) throw new Error(`404 ${url}`);
    return Buffer.from(`contents of ${path}\r\n`);
  };
  return Object.assign(fetcher, { urls });
}

async function tempRoot(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sync-brand-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("the manifest vendors the theme, the kit and only the drawings Tutor uses", () => {
  assert.ok(MANIFEST.includes("bb-theme/sketchbook/theme.css"));
  assert.ok(MANIFEST.includes("kit/tokens.json"));
  assert.ok(MANIFEST.includes("kit/sketchbook.css"));
  assert.ok(MANIFEST.includes("kit/sketchbook.js"));
  for (const icon of ["checklist", "chat", "books", "robot"]) assert.ok(MANIFEST.includes(`kit/icons/${icon}.svg`), icon);
  for (const character of ["waver", "explainer", "group"]) assert.ok(MANIFEST.includes(`kit/characters/${character}.svg`), character);
  assert.equal(new Set(MANIFEST).size, MANIFEST.length);
  assert.equal(VENDOR_DIR, "vendor/brand");
});

test("raw URLs point at the brand repo at the pinned commit", () => {
  assert.equal(
    rawUrl(SHA, "kit/tokens.json"),
    `https://raw.githubusercontent.com/lean-software-production/brand/${SHA}/kit/tokens.json`,
  );
});

test("the voice extraction takes the Voice and tone section, subheadings included, up to the next ## heading", () => {
  const voice = extractVoice(README);
  assert.match(voice, /^## Voice and tone\n/m);
  assert.match(voice, /friendly colleague/);
  assert.match(voice, /### Headlines/);
  assert.doesNotMatch(voice, /What's in this repo/);
  assert.doesNotMatch(voice, /Intro\./);
});

test("the voice extraction fails loudly when the heading is missing", () => {
  assert.throws(() => extractVoice("# Brand\n\n## Tone\n\nHi.\n"), /Voice and tone/);
});

test("sync writes every manifest file byte for byte, VOICE.md and the full sha in PIN", async (t) => {
  const root = await tempRoot(t);
  await syncBrand(root, SHA, fakeFetcher());
  for (const path of MANIFEST) {
    assert.equal(await readFile(join(root, VENDOR_DIR, path), "utf8"), `contents of ${path}\r\n`, path);
  }
  assert.equal(await readFile(join(root, VENDOR_DIR, "PIN"), "utf8"), `${SHA}\n`);
  const voice = await readFile(join(root, VENDOR_DIR, "VOICE.md"), "utf8");
  assert.match(voice, /## Voice and tone/);
  assert.match(voice, new RegExp(SHA));
});

test("sync wipes files that are no longer in the manifest", async (t) => {
  const root = await tempRoot(t);
  await mkdir(join(root, VENDOR_DIR, "kit/icons"), { recursive: true });
  await writeFile(join(root, VENDOR_DIR, "kit/icons/owl.svg"), "old");
  await syncBrand(root, SHA, fakeFetcher());
  await assert.rejects(readFile(join(root, VENDOR_DIR, "kit/icons/owl.svg")), /ENOENT/);
});

test("sync refuses anything but a full 40-hex sha", async (t) => {
  const root = await tempRoot(t);
  await assert.rejects(syncBrand(root, "6790d65", fakeFetcher()), /full 40-character/);
});

test("--check passes on a tree that matches its PIN", async (t) => {
  const root = await tempRoot(t);
  await syncBrand(root, SHA, fakeFetcher());
  assert.deepEqual(await checkBrand(root, fakeFetcher()), []);
});

test("--check names a vendored file that differs by one byte", async (t) => {
  const root = await tempRoot(t);
  await syncBrand(root, SHA, fakeFetcher());
  const theme = join(root, VENDOR_DIR, "bb-theme/sketchbook/theme.css");
  const bytes = await readFile(theme);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  await writeFile(theme, bytes);
  assert.deepEqual(await checkBrand(root, fakeFetcher()), ["differs: vendor/brand/bb-theme/sketchbook/theme.css"]);
});

test("--check names a missing file and an extra file", async (t) => {
  const root = await tempRoot(t);
  await syncBrand(root, SHA, fakeFetcher());
  await unlink(join(root, VENDOR_DIR, "kit/sketchbook.js"));
  await writeFile(join(root, VENDOR_DIR, "kit/extra.css"), "x");
  assert.deepEqual(await checkBrand(root, fakeFetcher()), [
    "missing: vendor/brand/kit/sketchbook.js",
    "extra: vendor/brand/kit/extra.css",
  ]);
});

test("--check fetches at the sha in PIN", async (t) => {
  const root = await tempRoot(t);
  await syncBrand(root, SHA, fakeFetcher());
  const fetcher = fakeFetcher();
  await checkBrand(root, fetcher);
  assert.ok(fetcher.urls.length > 0);
  for (const url of fetcher.urls) assert.ok(url.includes(`/${SHA}/`), url);
});

test("--check reports a missing PIN rather than guessing a commit", async (t) => {
  const root = await tempRoot(t);
  await assert.rejects(checkBrand(root, fakeFetcher()), /PIN/);
});
