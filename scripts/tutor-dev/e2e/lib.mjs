// Shared helpers for the e2e walk against the tutor-e2e container (BB on 127.0.0.1:48886).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const pw = require(process.env.PLAYWRIGHT_MODULE || resolve(homedir(), "ensembleworks/node_modules/playwright"));
export const BASE = "http://127.0.0.1:48886";
// Screenshots go to $E2E_SHOTS, else $E2E_HOME/shots, else <repo>/.tutor-e2e/shots (as env.sh).
const E2E_HOME = process.env.E2E_HOME || fileURLToPath(new URL("../../../.tutor-e2e", import.meta.url));
export const SHOTS = process.env.E2E_SHOTS || resolve(E2E_HOME, "shots");
mkdirSync(SHOTS, { recursive: true });
const BB_SH = new URL("./bb.sh", import.meta.url).pathname;

/** Runs `bb <args>` inside the container and returns stdout. */
export function bb(...args) {
  return execFileSync(BB_SH, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
export function bbJson(...args) {
  return JSON.parse(bb(...args, "--json"));
}
/** Runs a shell command inside the container. */
export function sh(script) {
  return execFileSync(BB_SH, ["--exec", "bash", "-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export async function openBrowser({ width = 1440, height = 900 } = {}) {
  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    // The web app probes the host daemon port from the browser; it is never published.
    if (m.type() === "error" && !m.text().includes("48887") && !(m.location()?.url ?? "").includes(":48887")) {
      errors.push(`[console.error] ${m.text().slice(0, 300)}`);
    }
  });
  return { browser, context, page, errors };
}

export async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  console.log(`  shot ${path}`);
  return path;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(what, fn, { timeout = 60000, every = 1000 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`);
}
