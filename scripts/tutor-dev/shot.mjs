#!/usr/bin/env node
// Screenshot a route of the harness BB with host-side Playwright chromium.
//
//   node scripts/tutor-dev/shot.mjs <route> <out.png> [options]
//
//   <route>                 path on the harness BB, e.g. "/" or "/settings"
//                           (a full http://127.0.0.1:<port>/... URL is accepted too)
//   --wait-for <selector>   wait for this selector to be visible before the shot
//   --settle <ms>           extra wait after load / selector (default 1500)
//   --size <W>x<H>          viewport (default 1440x900)
//   --full-page             capture the full scrollable page
//   --timeout <ms>          navigation / selector timeout (default 30000)
//   --dark                  prefers-color-scheme: dark (default light)
//   --verbose               also echo the expected host-daemon probe failures
//
// Env: TUTOR_DEV_PORT (default 47886), PLAYWRIGHT_MODULE (path to the
// playwright package; defaults to ~/ensembleworks/node_modules/playwright,
// then a normal `playwright` resolution).
//
// Browser console errors and failed requests are echoed to stderr. Exit code
// is non-zero if navigation or --wait-for fails (a failure screenshot is still
// written next to <out.png> as <out>.failed.png).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

function usage(msg) {
  if (msg) console.error(`shot.mjs: ${msg}`);
  console.error("usage: shot.mjs <route> <out.png> [--wait-for <selector>] [--settle ms] [--size WxH] [--full-page] [--timeout ms] [--dark]");
  process.exit(2);
}

const args = process.argv.slice(2);
const positional = [];
const opts = { waitFor: null, settle: 1500, width: 1440, height: 900, fullPage: false, timeout: 30000, dark: false, verbose: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => { if (i + 1 >= args.length) usage(`${a} needs a value`); return args[++i]; };
  if (a === "--wait-for") opts.waitFor = next();
  else if (a === "--settle") opts.settle = Number(next());
  else if (a === "--timeout") opts.timeout = Number(next());
  else if (a === "--full-page") opts.fullPage = true;
  else if (a === "--dark") opts.dark = true;
  else if (a === "--verbose") opts.verbose = true;
  else if (a === "--size") {
    const m = /^(\d+)x(\d+)$/.exec(next());
    if (!m) usage("--size must be WxH");
    opts.width = Number(m[1]); opts.height = Number(m[2]);
  } else if (a === "-h" || a === "--help") usage();
  else if (a.startsWith("--")) usage(`unknown option ${a}`);
  else positional.push(a);
}
if (positional.length !== 2) usage();
const [route, outArg] = positional;

const port = Number(process.env.TUTOR_DEV_PORT || 47886);
if (port === 38886 || port === 38887) usage("refusing to target the host BB's reserved ports 38886/38887");
const base = `http://127.0.0.1:${port}`;
// The BB web app probes the host daemon at http://127.0.0.1:<daemonPort>/status
// from the browser. The harness (like a Codespace) never forwards that port,
// so those probes fail by design; hide them unless --verbose.
const daemonPort = Number(process.env.TUTOR_DEV_DAEMON_PORT || port + 1);
const daemonPrefix = `http://127.0.0.1:${daemonPort}/`;
let hiddenDaemonProbes = 0;
let url;
if (/^https?:\/\//.test(route)) {
  url = new URL(route);
  if (url.origin !== base) usage(`URL must be on the harness origin ${base}`);
} else {
  url = new URL(route.startsWith("/") ? route : `/${route}`, base);
}

const require = createRequire(import.meta.url);
const candidates = [
  process.env.PLAYWRIGHT_MODULE,
  resolve(homedir(), "ensembleworks/node_modules/playwright"),
  "playwright",
].filter(Boolean);
let playwright;
for (const c of candidates) {
  try { playwright = require(c); break; } catch { /* try next */ }
}
if (!playwright) usage(`cannot load playwright (tried ${candidates.join(", ")}); set PLAYWRIGHT_MODULE`);

const out = resolve(outArg);
mkdirSync(dirname(out), { recursive: true });

const browser = await playwright.chromium.launch({ headless: true });
let failed = false;
try {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const at = m.location()?.url ?? "";
    if (!opts.verbose && at.startsWith(daemonPrefix)) return;
    console.error(`[console.error] ${m.text()}${at ? ` (${at})` : ""}`);
  });
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  page.on("requestfailed", (r) => {
    if (!opts.verbose && r.url().startsWith(daemonPrefix)) { hiddenDaemonProbes++; return; }
    console.error(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ""}`);
  });
  page.on("response", (r) => { if (r.status() >= 400) console.error(`[http ${r.status()}] ${r.url()}`); });
  try {
    // BB keeps a WebSocket open, so "networkidle" is not a reliable signal.
    await page.goto(url.href, { waitUntil: "load", timeout: opts.timeout });
    if (opts.waitFor) await page.locator(opts.waitFor).first().waitFor({ state: "visible", timeout: opts.timeout });
    if (opts.settle > 0) await page.waitForTimeout(opts.settle);
    await page.screenshot({ path: out, fullPage: opts.fullPage });
    console.log(out);
  } catch (err) {
    failed = true;
    const failShot = out.replace(/\.png$/i, "") + ".failed.png";
    await page.screenshot({ path: failShot, fullPage: opts.fullPage }).catch(() => {});
    console.error(`shot.mjs: ${err.message}\nfailure screenshot: ${failShot}`);
  }
} finally {
  await browser.close();
}
if (hiddenDaemonProbes) console.error(`(hid ${hiddenDaemonProbes} expected host-daemon probe failure(s); --verbose shows them)`);
process.exit(failed ? 1 : 0);
