// Checks for the Codespace polish build against the tutor-e2e container.
//   node polish.mjs first-start   agents + providers, theme, plugins switched off; re-enables automations by hand
//   node polish.mjs restart       after a container stop + up.sh: the hand re-enable and the theme survive
//   node polish.mjs ui            theme screenshots, simple navigation on/off, heartbeat + keep-alive, lost connection
// Exits non-zero on the first failed check.
import { readFileSync } from "node:fs";
import { BASE, bb, bbJson, openBrowser, sh, shot, sleep, until } from "./lib.mjs";

const STATE = "/workspaces/.bb-state/.tutor-feature";
// Feature 0.6 and earlier still default to the old id, which the manifest keeps as an alias of Sketchbook.
const THEME = "plugin:tutor:paper";
const SKETCHBOOK = "plugin:tutor:sketchbook";
// What the theme paints in light mode, read from the vendored brand theme rather than copied by hand.
const BRAND_THEME = readFileSync(new URL("../../../vendor/brand/bb-theme/sketchbook/theme.css", import.meta.url), "utf8");
const brandColour = (name) => {
  const value = BRAND_THEME.match(new RegExp(`^\\s*--sk-${name}:\\s*(#[0-9a-fA-F]{6});`, "m"))?.[1];
  if (!value) throw new Error(`no --sk-${name} in the vendored brand theme`);
  return value.toLowerCase();
};
const PAPER = brandColour("paper"); // --canvas in light mode
const DEEP_TEAL = brandColour("deep-teal"); // --primary in light mode
// The feature's default disablePlugins list (devcontainer-features src/tutor/devcontainer-feature.json).
const DISABLE = "automations,workflows,tasks,scheduled-send,github,browser-automation,agent-annotations,connect,plugin-api-docs,plugin-api-tester,theme-preview,keep-awake,account-pool,environment-modal-sandbox".split(",");
const REENABLE = "automations";
const LOST = "Lost the connection to your Codespace";

function check(cond, what, detail = "") {
  if (!cond) throw new Error(`CHECK FAILED: ${what}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ok  ${what}${detail ? ` (${detail})` : ""}`);
}
const plugins = () => Object.fromEntries(bbJson("plugin", "list").plugins.map((p) => [p.id, p.status]));
const themeId = () => bbJson("theme", "show").themeId;

function firstStart() {
  console.log("POLISH a: coding agents");
  for (const cli of ["claude", "codex", "pi"]) {
    // BB runs with a fixed system PATH, so the CLI must resolve there, not just in a login shell.
    const out = sh(`PATH=/usr/local/bin:/usr/bin:/bin; command -v ${cli} && ${cli} --version`).trim().split("\n");
    check(out[0] === `/usr/local/bin/${cli}`, `${cli} is on /usr/local/bin`, out.join(" · "));
  }
  const status = bbJson("updates", "status");
  const providers = status.machines[0].providerStatus;
  for (const id of ["claude-code", "codex", "pi"]) {
    check(providers[id]?.installed === true, `BB sees provider ${id} installed`, `${providers[id]?.currentVersion} at ${providers[id]?.executablePath}`);
  }
  const listed = bb("provider", "list");
  check(["claude-code", "codex", "pi"].every((id) => new RegExp(`^${id}\\s`, "m").test(listed)), "bb provider list names claude-code, codex and pi");
  const state = plugins();
  check(["provider-claude-code", "provider-codex", "provider-pi"].every((id) => state[id] === "running"), "the three provider plugins are running");

  console.log("POLISH b: theme after first start");
  check(themeId() === THEME, `BB's theme is ${THEME}`, themeId());

  console.log("POLISH c: plugins switched off after first start");
  for (const id of DISABLE) {
    check(state[id] === undefined || state[id] === "disabled", `${id} is off`, state[id] ?? "not installed");
  }
  check(state.tutor === "running" && state["thread-list"] === "running", "tutor and thread-list stay on");
  const marker = sh(`cat ${STATE}/plugins-disabled`).trim().split("\n");
  check(DISABLE.every((id) => marker.includes(id)), "every listed id is recorded as dealt with");
  bb("plugin", "enable", REENABLE);
  check(plugins()[REENABLE] !== "disabled", `${REENABLE} re-enabled by hand`, plugins()[REENABLE]);
  sh(`printf '%s\\n' "--- restart marker $(date -u +%FT%TZ)" >> ${STATE}/autostart.log`);
}

function afterRestart() {
  console.log("POLISH c: after a container restart");
  const log = sh(`cat ${STATE}/autostart.log`);
  const since = log.slice(log.lastIndexOf("--- restart marker"));
  check(/plugin already installed/.test(since), "autostart ran again on this start", since.split("\n").find((l) => /plugin already installed/.test(l)));
  const state = plugins();
  check(state[REENABLE] === "running", `${REENABLE} is still on after the restart`, state[REENABLE]);
  check(!new RegExp(`disabled the plugin '${REENABLE}'`).test(since), `autostart did not disable ${REENABLE} again`);
  check(themeId() === THEME, `BB's theme is still ${THEME}`);
  // Back to the student-facing default for the rest of the run.
  bb("plugin", "disable", REENABLE);
}

async function ui() {
  // POLISH_ONLY=bdef (any subset) runs just those sections.
  const only = (section) => !process.env.POLISH_ONLY || process.env.POLISH_ONLY.includes(section);
  const coach = bbJson("thread", "list").find((t) => /^Coach · /.test(t.title ?? ""));
  check(Boolean(coach), "a coach thread exists to show", coach?.id);
  const { browser, page, errors } = await openBrowser();
  try {
    if (only("b")) {
    console.log("POLISH b: the Sketchbook theme in the browser");
    await page.goto(`${BASE}/`);
    await page.getByText("Continue your course").waitFor({ timeout: 30000 });
    await sleep(1500);
    const look = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return { canvas: root.getPropertyValue("--canvas").trim(), primary: root.getPropertyValue("--primary").trim(), font: getComputedStyle(document.body).fontFamily };
    });
    check(look.canvas.toLowerCase() === PAPER && look.primary.toLowerCase() === DEEP_TEAL, `BB's tokens are Sketchbook's paper (${PAPER}) and deep teal (${DEEP_TEAL})`, JSON.stringify(look));
    check(/Tutor Patrick Hand/.test(look.font), "BB's UI font is Tutor Patrick Hand", look.font);
    let resolveError = "";
    try {
      bb("theme", "show", SKETCHBOOK);
    } catch (error) {
      resolveError = String(error.stderr || error.message).trim();
    }
    check(resolveError === "", `bb resolves ${SKETCHBOOK}`, resolveError);
    await page.goto(`${BASE}/settings/appearance`);
    await page.getByText("Sketchbook", { exact: true }).first().waitFor({ timeout: 30000 });
    check(await page.getByText("Tutor paper (now Sketchbook)", { exact: true }).count() > 0, "Settings › Appearance offers Sketchbook and the Tutor paper alias");
    await shot(page, "polish-e2e-theme-settings");
    await shot(page, "polish-e2e-theme-home");
    await page.goto(`${BASE}/threads/${coach.id}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(3000);
    await shot(page, "polish-e2e-theme-thread");
    await page.goto(`${BASE}/plugins/tutor/course`);
    await page.locator(".tutor-paper, .tp-course, main").first().waitFor({ timeout: 30000 });
    await sleep(2000);
    await shot(page, "polish-e2e-theme-course");

    }
    if (only("d")) {
    console.log("POLISH d: simple navigation");
    const navText = async () => {
      await page.goto(`${BASE}/`);
      await page.getByText("Continue your course").waitFor({ timeout: 30000 });
      await sleep(2000);
      return page.locator("aside, nav, [data-sidebar]").first().innerText();
    };
    const rows = async () => {
      const on = await page.locator("ul.tutor-nav").count();
      const plugins = await page.getByRole("button", { name: /^Plugins/ }).count() + (await page.getByRole("link", { name: /^Plugins/ }).count());
      const skills = await page.getByRole("button", { name: /^Skills/ }).count() + (await page.getByRole("link", { name: /^Skills/ }).count());
      return { on, plugins, skills };
    };
    check(bbJson("plugin", "config", "tutor").values.simpleNavigation === true, "simpleNavigation is on by default");
    await navText();
    let r = await rows();
    check(r.on === 1 && r.plugins === 0 && r.skills === 0, "with simpleNavigation on, Plugins and Skills are not in the sidebar", JSON.stringify(r));
    check(await page.locator("ul.tutor-nav").getByText("Course").first().isVisible(), "the Course row is in Tutor's navigation");
    await shot(page, "polish-e2e-nav-simple");
    bb("plugin", "config", "tutor", "set", "simpleNavigation", "false");
    try {
      await navText();
      r = await rows();
      check(r.on === 0 && r.plugins >= 1 && r.skills >= 1, "with simpleNavigation off, BB's Plugins and Skills rows are back", JSON.stringify(r));
      await shot(page, "polish-e2e-nav-original");
    } finally {
      bb("plugin", "config", "tutor", "set", "simpleNavigation", "true");
    }
    await navText();
    r = await rows();
    check(r.on === 1 && r.plugins === 0 && r.skills === 0, "switching simpleNavigation back on hides them again", JSON.stringify(r));

    }
    if (only("e")) {
    console.log("POLISH e: heartbeat and keep-alive");
    const stamp = () => sh(`cat ${STATE}/activity 2>/dev/null || true`).trim();
    const beats = [];
    page.on("request", (req) => req.url().endsWith("/rpc/heartbeat") && beats.push(Date.now()));
    // Page loads with no input: BB autofocuses its composer and the lesson
    // scrolls itself to the latest message; neither is the student.
    for (const path of ["/", "/plugins/tutor/course", `/threads/${coach.id}`]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(6000);
      check(beats.length === 0, `no heartbeat from loading ${path} without input`, `${beats.length} sent`);
    }
    await page.goto(`${BASE}/`);
    await page.getByText("Continue your course").waitFor({ timeout: 30000 });
    await sleep(4000);
    check(beats.length === 0, "no heartbeat while the page is idle", `${beats.length} sent`);
    const s0 = stamp();
    await page.mouse.move(600, 400);
    await page.mouse.move(640, 430);
    const s1 = await until("the activity stamp to change", () => { const s = stamp(); return s !== s0 && s; }, { timeout: 15000 });
    check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(s1) && Math.abs(Date.now() - Date.parse(s1)) < 15000, "input stamps a fresh ISO-8601 UTC time", `${s0 || "(none)"} -> ${s1}`);
    const perms = sh(`stat -c '%a %U' ${STATE} ${STATE}/activity`).trim().split("\n");
    check(perms[0].startsWith("700 "), "the .tutor-feature directory is 0700", perms.join(" · "));
    const keepActive = sh(`TUTOR_KEEPALIVE_FORCE=1 TUTOR_KEEPALIVE_INTERVAL=2 timeout 7 script -qec tutor-keepalive /dev/null; true`);
    const activeLines = keepActive.split(/\r?\n/).filter((l) => /you're active in BB/.test(l));
    console.log(keepActive.trim().replace(/^/gm, "    | "));
    check(activeLines.length >= 2, "tutor-keepalive prints a line each interval while BB is in use", `${activeLines.length} lines in 7 s at 2 s`);
    // Keep interacting past the page's 45 s send interval and the server's 30 s write interval.
    const until50 = Date.now() + 50000;
    for (let i = 0; Date.now() < until50; i++) {
      await page.mouse.move(500 + (i % 7) * 20, 350 + (i % 5) * 15);
      if (i % 5 === 0) await page.mouse.wheel(0, i % 2 ? 80 : -80);
      await sleep(2000);
    }
    await sleep(2000);
    const s2 = stamp();
    check(Date.parse(s2) > Date.parse(s1), "continued interaction updates the stamp again", `${s1} -> ${s2}; ${beats.length} heartbeats`);
    // Now leave the page alone. The page may send one trailing heartbeat within
    // 60 s of the last input (ACTIVE_WINDOW_MS), then nothing; the keep-alive
    // goes quiet once the last stamp is 120 s old.
    const lastInputAt = Date.now();
    console.log("    idle for 190 s ...");
    await sleep(190000);
    const late = beats.filter((t) => t > lastInputAt + 61000);
    check(late.length === 0, "no heartbeat more than 60 s after the student's last input", `${beats.filter((t) => t > lastInputAt).length} trailing, ${late.length} late`);
    const s3 = stamp();
    check(Date.now() - Date.parse(s3) > 120000, "the stamp is older than the keep-alive's 120 s window", s3);
    const keepIdle = sh(`TUTOR_KEEPALIVE_FORCE=1 TUTOR_KEEPALIVE_INTERVAL=2 timeout 7 script -qec tutor-keepalive /dev/null; true`);
    console.log(keepIdle.trim().replace(/^/gm, "    | "));
    check(!/you're active in BB/.test(keepIdle) && /keep-alive is on/.test(keepIdle), "once idle, tutor-keepalive prints nothing after its start line");
    check(sh("tutor-keepalive --once").trim() === "", "tutor-keepalive --once is silent once idle");

    }
    if (only("f")) {
    console.log("POLISH f: lost connection versus a genuine error");
    await page.route("**/api/v1/plugins/tutor/rpc/getOverview", (route) => route.fulfill({ status: 401, body: "" }));
    await page.goto(`${BASE}/`);
    await page.getByText(LOST).first().waitFor({ timeout: 20000 });
    check((await page.getByText(/HTTP \d{3}/).count()) === 0, "home: an empty 401 shows the lost-connection message, not HTTP 401");
    check((await page.getByRole("button", { name: "Reload" }).count()) >= 1, "home: the message offers Reload");
    await shot(page, "polish-e2e-connection-lost-home");
    await page.unroute("**/api/v1/plugins/tutor/rpc/getOverview");

    // Home's "Continue with your coach" only calls openCoach while no coach
    // thread is known; hide the known one so the click goes through the RPC
    // that failed in the owner's Codespace.
    const noKnownCoach = async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const strip = (v) => {
        if (v && typeof v === "object") {
          if (v.current && typeof v.current === "object" && "coachThreadId" in v.current) v.current.coachThreadId = null;
          Object.values(v).forEach(strip);
        }
      };
      strip(body);
      await route.fulfill({ response, json: body });
    };
    const openCoachCalls = [];
    page.on("request", (req) => req.url().endsWith("/rpc/openCoach") && openCoachCalls.push(req.url()));
    await page.route("**/api/v1/plugins/tutor/rpc/getOverview", noKnownCoach);
    await page.route("**/api/v1/plugins/tutor/rpc/openCoach", (route) => route.fulfill({ status: 401, body: "" }));
    await page.goto(`${BASE}/`);
    await page.getByText(/Continue with your coach/).first().waitFor({ timeout: 30000 });
    await page.getByText(/Continue with your coach/).first().click();
    await page.getByText(LOST).first().waitFor({ timeout: 20000 });
    check((await page.getByText(/rpc "openCoach" failed|HTTP 401/).count()) === 0, "openCoach through an empty 401 shows the lost-connection message, not 'rpc \"openCoach\" failed (HTTP 401)'");
    check(openCoachCalls.length >= 1, "the click really called openCoach", `${openCoachCalls.length} calls`);
    await shot(page, "polish-e2e-connection-lost-opencoach");
    await page.unroute("**/api/v1/plugins/tutor/rpc/openCoach");

    const genuine = "Homework 000 has no coach thread yet (e2e).";
    await page.route("**/api/v1/plugins/tutor/rpc/openCoach", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "INTERNAL", message: genuine } }) }),
    );
    await page.goto(`${BASE}/`);
    await page.getByText(/Continue with your coach/).first().waitFor({ timeout: 30000 });
    await page.getByText(/Continue with your coach/).first().click();
    await page.getByText(genuine).first().waitFor({ timeout: 20000 });
    check((await page.getByText(LOST).count()) === 0 && (await page.getByRole("button", { name: "Reload" }).count()) === 0, "a genuine JSON error still shows its own message, without Reload");
    await shot(page, "polish-e2e-genuine-error");
    await page.unroute("**/api/v1/plugins/tutor/rpc/openCoach");
    await page.unroute("**/api/v1/plugins/tutor/rpc/getOverview");
    }

    const relevant = errors.filter((e) => !/401|500|Failed to load resource/.test(e));
    if (relevant.length) console.log(`  page errors:\n    ${relevant.join("\n    ")}`);
  } finally {
    await browser.close();
  }
}

const phase = process.argv[2];
if (phase === "first-start") firstStart();
else if (phase === "restart") afterRestart();
else if (phase === "ui") await ui();
else {
  console.error("usage: node polish.mjs first-start|restart|ui");
  process.exit(2);
}
console.log(`POLISH ${phase} passed`);
