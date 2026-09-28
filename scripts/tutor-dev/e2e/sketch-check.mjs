// Screenshots of every Tutor surface in the Sketchbook look against the
// tutor-e2e container, each followed by the geometry checks (plan Task 15):
//   node sketch-check.mjs [surface…] [--dark] [--size WxH] [--out DIR] [--tag TAG]
//                         [--browser chromium|firefox] [--reduced-motion]
// Surfaces (default: all): welcome start home outline lesson-card rule-card
// progress side-chat rule-tab lesson-complete completion appearance.
// Each shot is <out>/<surface>-<light|dark>[-<tag>].png (out defaults to $E2E_SHOTS).
// The checks, per page (sketchReport, also used by walk.mjs):
//   - every visible .sk-patch, its ::before overhang included, is at least 16px
//     inside the viewport (patches a scroller has scrolled partly away are skipped);
//   - the lesson-complete loop crosses no text and ends within 12px of What's next;
//   - in dark mode every kit drawing (a data: svg <img> in .tutor-sk) sits on a
//     .sk-patch (or on the paper ribbon);
//   - the wobble defs (#tutor-sk-defs) are in the document exactly once.
// It needs the walk to have run (coach threads for lessons 000 and 004).
// Exits non-zero when a surface fails to load or a check fails.
import { BASE, bb, bbJson, pw, sleep, until } from "./lib.mjs";
import { mkdirSync } from "node:fs";

/** Runs in the page. Returns the failed checks. */
export function sketchReportInPage({ dark, patchMargin = 16, loopReach = 12 }) {
  const fail = [];
  const px = (v) => parseFloat(v) || 0;
  const vw = window.innerWidth, vh = window.innerHeight;
  const roots = document.querySelectorAll(".tutor-sk");
  if (roots.length > 0) {
    const defs = document.querySelectorAll("#tutor-sk-defs").length;
    if (defs !== 1) fail.push(`#tutor-sk-defs is in the document ${defs} times (want 1)`);
  }
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
  };
  // A scroller between the element and the page: clipping by it is scroll state, not layout.
  const clippedByScroller = (el, box) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (!/(auto|scroll|hidden)/.test(s.overflowY + s.overflowX)) continue;
      if (a.scrollHeight <= a.clientHeight + 1 && a.scrollWidth <= a.clientWidth + 1) continue;
      const c = a.getBoundingClientRect();
      if (box.top < c.top || box.bottom > c.bottom || box.left < c.left || box.right > c.right) return true;
    }
    return false;
  };
  const name = (el) => (el.querySelector("img")?.getAttribute("alt") || el.className || el.tagName).toString().slice(0, 50);
  for (const patch of document.querySelectorAll(".sk-patch")) {
    if (!visible(patch)) continue;
    const r = patch.getBoundingClientRect();
    const b = getComputedStyle(patch, "::before");
    const outer = { left: r.left + px(b.left), top: r.top + px(b.top), right: r.right - px(b.right), bottom: r.bottom - px(b.bottom) };
    if (outer.bottom < 0 || outer.top > vh || outer.right < 0 || outer.left > vw) continue;
    if (clippedByScroller(patch, outer)) continue;
    const margin = Math.min(outer.left, outer.top, vw - outer.right, vh - outer.bottom);
    if (margin < patchMargin) fail.push(`patch ${name(patch)} (${patch.className}) is ${margin.toFixed(1)}px from the viewport's edge (want >= ${patchMargin})`);
  }
  for (const path of document.querySelectorAll(".tp-done .sk-loop path")) {
    const panel = path.closest(".tp-done");
    const r = path.getBoundingClientRect(), reachOut = 6;
    if (!r.width) continue;
    const box = { left: r.left - reachOut, top: r.top - reachOut, right: r.right + reachOut, bottom: r.bottom + reachOut };
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const t of range.getClientRects()) {
        const overlap = Math.min(box.right, t.right) - Math.max(box.left, t.left) > 0 && Math.min(box.bottom, t.bottom) - Math.max(box.top, t.top) > 0;
        if (overlap) fail.push(`loop box crosses text "${n.textContent.trim().slice(0, 40)}"`);
      }
    }
    const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM());
    const next = panel.querySelector(".tp-next").getBoundingClientRect();
    const reach = Math.hypot(Math.max(next.left - end.x, 0, end.x - next.right), Math.max(next.top - end.y, 0, end.y - next.bottom));
    if (reach > loopReach) fail.push(`loop ends ${reach.toFixed(1)}px from What's next (want <= ${loopReach})`);
  }
  if (dark) {
    for (const img of document.querySelectorAll('.tutor-sk img[src^="data:image/svg"]')) {
      if (!visible(img)) continue;
      if (!img.closest(".sk-patch, .sk-ribbon")) fail.push(`kit drawing ${img.alt || img.src.slice(0, 40)} in ${img.parentElement.className} has no paper patch`);
    }
  }
  return fail;
}

/** The report for the page as it is now. */
export async function sketchReport(page, opts) {
  return page.evaluate(sketchReportInPage, opts);
}

/** Runs in the page: whether the kit's wobble outlines draw (Firefox drops an element whose filter is missing). */
export function outlineReportInPage() {
  const fail = [];
  if (!document.getElementById("tutor-sk-wobble")) fail.push("the tutor-sk-wobble filter is missing");
  const panel = document.querySelector(".tutor-sk .sk-panel");
  if (!panel) return [...fail, "no .sk-panel on the page"];
  const b = getComputedStyle(panel, "::before");
  if (!b.filter || b.filter === "none") fail.push(`.sk-panel::before has no filter (${b.filter})`);
  const r = panel.getBoundingClientRect();
  const w = r.width - (parseFloat(b.left) || 0) - (parseFloat(b.right) || 0);
  const h = r.height - (parseFloat(b.top) || 0) - (parseFloat(b.bottom) || 0);
  if (!(w > 0 && h > 0) || b.content === "none") fail.push(`.sk-panel::before draws no box (${w}x${h}, content ${b.content})`);
  return fail;
}

// ---- CLI ----------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opts = { dark: false, width: 1280, height: 800, out: process.env.E2E_SHOTS, tag: "", browser: "chromium", reducedMotion: false, surfaces: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dark") opts.dark = true;
    else if (a === "--reduced-motion") opts.reducedMotion = true;
    else if (a === "--size") [opts.width, opts.height] = args[++i].split("x").map(Number);
    else if (a === "--out") opts.out = args[++i];
    else if (a === "--tag") opts.tag = args[++i];
    else if (a === "--browser") opts.browser = args[++i];
    else opts.surfaces.push(a);
  }
  if (!opts.out) throw new Error("set --out or E2E_SHOTS");
  mkdirSync(opts.out, { recursive: true });
  const coaches = bbJson("thread", "list").filter((t) => /^Coach · Lesson \d{3}$/.test(t.title ?? ""));
  const coach = (id) => coaches.find((t) => t.title === `Coach · Lesson ${id}`)?.id;
  const current = coaches.map((t) => t.title.slice(-3)).sort().at(-1);
  const coachNow = current ? coach(current) : undefined;
  const mobile = opts.width < 600;
  const scrollTo = async (page, selector, block = "center") => {
    const el = page.locator(selector).last();
    await el.waitFor({ timeout: 30000 });
    await el.evaluate((e, b) => e.scrollIntoView({ block: b }), block);
    await sleep(1500);
  };
  const openThread = async (page, id) => {
    await page.goto(`${BASE}/threads/${id}`, { waitUntil: "load" });
    await page.locator(`[data-timeline-row-id^="${id}:"]`).first().waitFor({ timeout: 30000 });
    await sleep(2500);
  };
  /** Loads older history until the selector is in the DOM. */
  const loadUntil = async (page, selector) => {
    await until(selector, async () => {
      if ((await page.locator(selector).count()) > 0) return true;
      await page.locator(`[data-timeline-row-id]`).first().evaluate((e) => e.scrollIntoView({ block: "start" }));
      return false;
    }, { timeout: 60000, every: 1500 });
  };
  const openTab = async (page, threadId, match, add) => {
    const tabs = JSON.parse(bb("--exec", "bash", "-c", `curl -fsS "$BB_SERVER_URL/api/v1/threads/${threadId}/tabs"`));
    if (!tabs.tabs.some(match)) {
      const body = JSON.stringify({ expectedRevision: tabs.revision, tabs: [...tabs.tabs, add] }).replace(/'/g, "'\\''");
      bb("--exec", "bash", "-c", `curl -fsS -X PUT -H 'content-type: application/json' "$BB_SERVER_URL/api/v1/threads/${threadId}/tabs" -d '${body}' >/dev/null`);
    }
  };
  const showRight = async (page, tabTitle) => {
    const show = page.getByRole("button", { name: /Show right panel/ });
    if (await show.isVisible().catch(() => false)) {
      await show.click();
      await sleep(1200);
    }
    await page.getByText(tabTitle, { exact: true }).last().click();
    await sleep(2500);
  };
  const SURFACES = {
    welcome: async (page) => {
      await page.goto(`${BASE}/plugins/tutor/course`, { waitUntil: "load" });
      await page.getByText("Start the course →").waitFor({ timeout: 30000 });
      await sleep(2000);
    },
    start: async (page) => {
      await page.goto(`${BASE}/plugins/tutor/course/start/006`, { waitUntil: "load" });
      await page.getByText(/Start with your coach/).first().waitFor({ timeout: 30000 });
      await sleep(2000);
    },
    home: async (page) => {
      await page.goto(`${BASE}/`, { waitUntil: "load" });
      await page.getByText(/Continue with your coach/).first().waitFor({ timeout: 30000 });
      await sleep(2000);
    },
    outline: async (page) => {
      await openThread(page, coachNow);
      if (mobile) {
        const toggle = page.getByRole("button", { name: /Toggle sidebar|Open sidebar|sidebar/i }).first();
        if (await toggle.isVisible().catch(() => false)) await toggle.click();
      }
      await page.locator("nav.tp-outline li.tp-lesson").first().waitFor({ timeout: 20000 });
      await sleep(1500);
    },
    "lesson-card": async (page) => {
      await openThread(page, coachNow);
      await loadUntil(page, "[data-tutor-lesson]");
      await scrollTo(page, "[data-tutor-lesson]", "start");
    },
    "rule-card": async (page) => {
      await openThread(page, coachNow);
      await scrollTo(page, ".tp-rcard");
    },
    progress: async (page) => {
      await openThread(page, coachNow);
      await scrollTo(page, ".tp-pcard--rule-passing, .tp-pcard--not-yet, .tp-pcard");
    },
    "side-chat": async (page) => {
      await openThread(page, coachNow);
      await showRight(page, "Side chat");
    },
    "rule-tab": async (page) => {
      await openTab(page, coachNow, (t) => t.pluginId === "tutor" && t.title === "Rule", {
        kind: "plugin-panel", pluginId: "tutor", actionId: "rule-tab", title: "Rule", paramsJson: "{}",
      });
      await openThread(page, coachNow);
      await showRight(page, "Rule");
    },
    "lesson-complete": async (page) => {
      await openThread(page, coach("000"));
      await loadUntil(page, ".tp-done");
      await scrollTo(page, ".tp-done");
      await sleep(1500);
    },
    completion: async (page) => {
      await page.goto(`${BASE}/plugins/tutor/course/complete/000`, { waitUntil: "load" });
      await page.locator(".tp-done-panel").waitFor({ timeout: 30000 });
      await sleep(2000);
    },
    appearance: async (page) => {
      await page.goto(`${BASE}/settings/appearance`, { waitUntil: "load" });
      await page.getByText("Tutor paper (now Sketchbook)", { exact: true }).first().waitFor({ timeout: 30000 });
      await page.getByText("Sketchbook", { exact: true }).first().evaluate((e) => e.scrollIntoView({ block: "center" }));
      await sleep(1500);
    },
  };
  const list = opts.surfaces.length ? opts.surfaces : Object.keys(SURFACES);
  const browser = await pw[opts.browser].launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
    reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
    ...(mobile ? { isMobile: opts.browser !== "firefox", hasTouch: true } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  let failed = 0;
  for (const s of list) {
    const file = `${opts.out}/${s}-${opts.dark ? "dark" : "light"}${opts.tag ? `-${opts.tag}` : ""}.png`;
    try {
      if (!SURFACES[s]) throw new Error(`unknown surface ${s}`);
      await SURFACES[s](page);
      const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      if (isDark !== opts.dark) throw new Error(`BB is ${isDark ? "dark" : "light"}, want ${opts.dark ? "dark" : "light"}`);
      await page.screenshot({ path: file });
      const report = await sketchReport(page, { dark: opts.dark });
      if (opts.browser === "firefox") report.push(...(await page.evaluate(outlineReportInPage)));
      if (report.length) {
        failed++;
        console.log(`FAIL ${s}: ${file}\n    ${report.join("\n    ")}`);
      } else console.log(`ok   ${s}: ${file}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${s}: ${e.message.split("\n")[0]}`);
      await page.screenshot({ path: file.replace(/\.png$/, ".failed.png") }).catch(() => {});
    }
  }
  if (errors.length) console.log(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`);
  await browser.close();
  console.log(`${list.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
