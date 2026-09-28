#!/usr/bin/env node
// Screenshot every Sketchbook mockup screen (the brand is light mode only).
//
//   node docs/mockups-sketchbook/shoot.mjs [--out <dir>] [--only <screen>] [--check]
//
//   --out <dir>     where the PNGs go (default ../../../shots-sketchbook,
//                   i.e. next to the plugin checkout)
//   --only <id>     one screen only
//   --check         also print a WCAG contrast report: every text run whose
//                   colour against its composited background is under 4.5:1,
//                   and run the geometry checks, which fail the run (exit 1):
//                   every drawing (.tp-drawing) sits at least 16px inside
//                   the frame, and the lesson-complete
//                   loop crosses no text and ends within 12px of What's next
//   --min <ratio>   report threshold for --check (default 4.5)
//
// Writes <screen>.png. The page loads its fonts from Google
// Fonts (fonts.googleapis.com, fonts.gstatic.com), so those hosts must be
// reachable; each shot waits for document.fonts.ready and then finishes the
// highlighter sweep so the PNG shows its final state.
//
// Env: PLAYWRIGHT_MODULE (path to the playwright package; defaults to
// ~/ensembleworks/node_modules/playwright, then a normal resolution).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SCREENS = ["first-run", "outline", "lesson-card", "rule-cards", "side-chat", "lesson-complete", "home"];

const args = process.argv.slice(2);
const opts = { out: resolve(here, "../../../shots-sketchbook"), only: null, check: false, min: 4.5 };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") opts.out = resolve(args[++i]);
  else if (args[i] === "--only") opts.only = args[++i];
  else if (args[i] === "--check") opts.check = true;
  else if (args[i] === "--min") opts.min = Number(args[++i]);
  else { console.error(`shoot.mjs: unknown option ${args[i]}`); process.exit(2); }
}

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, resolve(homedir(), "ensembleworks/node_modules/playwright"), "playwright"].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* next */ } }
  console.error("shoot.mjs: playwright not found; set PLAYWRIGHT_MODULE"); process.exit(1);
}
const { chromium } = loadPlaywright();

// Runs in the page: walk visible text, composite its background, report < min.
function contrastReport(min) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    if (!css || css === "transparent") return [0, 0, 0, 0];
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  // Background layers from the element up: own background, ::before wash
  // (kit panels paint there), the highlighter swash (read as the kit's --sk-swash role).
  function layers(el) {
    const out = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage.includes("svg") && e.classList.contains("sk-hl")) {
        out.push(rgba(cs.getPropertyValue("--sk-swash").trim() || "#FFEEB8"));
      }
      out.push(rgba(cs.backgroundColor));
      const b = getComputedStyle(e, "::before");
      if (b.content && b.content !== "none" && b.position === "absolute") out.push(rgba(b.backgroundColor));
    }
    return out;
  }
  function bgOf(el) {
    let bg = [0, 0, 0, 0];
    const ls = layers(el).reverse();          // root first
    let acc = rgba(getComputedStyle(document.documentElement).backgroundColor);
    if (acc[3] === 0) acc = [255, 255, 255, 1];
    for (const l of ls) acc = over(l, acc);
    bg = acc; return bg;
  }

  const seen = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || !el.getClientRects().length) continue;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const fg = rgba(cs.color); const bg = bgOf(el); const r = ratio(over(fg, bg), bg);
    if (r >= min) continue;
    const size = parseFloat(cs.fontSize);
    const key = hex(over(fg, bg)) + " on " + hex(bg);
    const cur = seen.get(key) || { ratio: r.toFixed(2), size, samples: [] };
    if (cur.samples.length < 3) cur.samples.push(`${el.className || el.tagName}: "${t.slice(0, 40)}"`);
    seen.set(key, cur);
  }
  return [...seen.entries()].map(([k, v]) => `${v.ratio}  ${k}  (${v.size}px)  ${v.samples.join(" | ")}`);
}

// Runs in the page: the geometry rules for one screen. Returns the failures.
function geometryReport({ screen, drawingMargin, loopReach }) {
  const frame = document.querySelector(`.shot[data-screen="${screen}"] > .frame`);
  const fr = frame.getBoundingClientRect();
  const fail = [];
  const name = (el) => (el.querySelector("img")?.getAttribute("src") ?? el.className).split("/").pop();
  // (a) every drawing stays inside the frame.
  for (const drawing of frame.querySelectorAll(".tp-drawing")) {
    const r = drawing.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const margin = Math.min(r.left - fr.left, r.top - fr.top, fr.right - r.right, fr.bottom - r.bottom);
    if (margin < drawingMargin) fail.push(`drawing ${name(drawing)} is ${margin.toFixed(1)}px from the frame's edge (want >= ${drawingMargin})`);
  }
  // (b) the loop, with its stroke and arrowhead (reaching about 6px past the
  // path), crosses no text, and its end lands on What's next.
  const path = frame.querySelector(".tp-loop path, .tp-done .sk-loop path");
  if (path) {
    const r = path.getBoundingClientRect(), reachOut = 6;
    const box = { left: r.left - reachOut, top: r.top - reachOut, right: r.right + reachOut, bottom: r.bottom + reachOut };
    const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const t of range.getClientRects()) {
        const overlap = Math.min(box.right, t.right) - Math.max(box.left, t.left) > 0 && Math.min(box.bottom, t.bottom) - Math.max(box.top, t.top) > 0;
        if (overlap) fail.push(`loop box crosses text "${n.textContent.trim().slice(0, 40)}"`);
      }
    }
    const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM());
    const next = frame.querySelector(".tp-next").getBoundingClientRect();
    const dx = Math.max(next.left - end.x, 0, end.x - next.right);
    const dy = Math.max(next.top - end.y, 0, end.y - next.bottom);
    const reach = Math.hypot(dx, dy);
    if (reach > loopReach) fail.push(`loop ends ${reach.toFixed(1)}px from What's next (want <= ${loopReach})`);
  }
  return fail;
}

mkdirSync(opts.out, { recursive: true });
// Chromium ignores HTTPS_PROXY credentials; hand a proxy with auth to Playwright.
function proxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!raw) return undefined;
  const u = new URL(raw);
  return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username) || undefined,
    password: decodeURIComponent(u.password) || undefined, bypass: process.env.NO_PROXY || process.env.no_proxy };
}
const browser = await chromium.launch({ proxy: proxyFromEnv() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") console.error(`[console] ${m.text()}`); });
page.on("requestfailed", (r) => console.error(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const index = pathToFileURL(resolve(here, "index.html")).href;
for (const screen of SCREENS.filter((s) => !opts.only || s === opts.only)) {
  await page.goto(`${index}?screen=${screen}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await page.waitForTimeout(150);
  const file = resolve(opts.out, `${screen}.png`);
  await page.locator(`.shot[data-screen="${screen}"] > .frame`).screenshot({ path: file });
  console.log(file);
  if (opts.check) {
    const bad = await page.evaluate(contrastReport, opts.min);
    for (const line of bad) console.log(`  under ${opts.min}: ${line}`);
    const broken = await page.evaluate(geometryReport, { screen, drawingMargin: 16, loopReach: 12 });
    for (const line of broken) console.log(`  geometry: ${line}`);
    if (broken.length) process.exitCode = 1;
  }
}
await browser.close();
