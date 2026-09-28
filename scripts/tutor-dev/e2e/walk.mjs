// End-to-end walk of Tutor against the tutor-e2e container: the course outline
// (one tree), the coach in BB's own thread view with the lesson card and Rule
// cards, jumping to a Rule's section (through lazily loaded history), and BB
// side chats (Tutor's "Ask a side question" and BB's "Reply in side chat").
//   node walk.mjs [step-prefix…]
// Screenshots: $E2E_SHOTS (default <repo>/.tutor-e2e/shots)/e2e-NN-*.png and tree-*.png. Exits non-zero on the first failed check.
// PROJECT (set by run-all.sh from the checkout's devcontainer.json; FACTORY before it) picks the layout:
//   /workspaces/my-factory (default; tutor/mvp): spec/ITERATION, the factory is its own repo;
//   <starter>/tetris/.factory (tutor/starter-layout, plugin 0.1.0): ITERATION at the factory
//   root, the seed in ../seeds/tetris.md, stand-ins/ refreshed from the course;
//   <starter> (plugin 0.2.0): the clone's top folder is the project, the factory is
//   tetris/.factory through lesson 003 and factory/ from 004 (step 16 walks there and checks
//   the move against a second clone run through the starter's fetch.sh).
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { BASE, SHOTS, bb, bbJson, openBrowser, sh, shot, sleep, until } from "./lib.mjs";

const PROJECT = process.env.PROJECT || process.env.FACTORY || "/workspaces/my-factory";
/** The project is a starter clone's top folder (plugin 0.2.0), not a factory. */
const REPO_LAYOUT = !PROJECT.endsWith("/.factory") && PROJECT !== "/workspaces/my-factory" && sh(`test -d '${PROJECT}/tetris/.factory' && echo yes || true`).trim() === "yes";
/** Where the factory is: moves to factory/ when step 16 adopts lesson 004. */
let FACTORY = REPO_LAYOUT ? `${PROJECT}/tetris/.factory` : PROJECT;
const STARTER_LAYOUT = REPO_LAYOUT || PROJECT.endsWith("/.factory");
const CODEBASE = REPO_LAYOUT ? `${PROJECT}/tetris` : dirname(FACTORY); // the starter's tetris/
const PROJECT_NAME = REPO_LAYOUT ? PROJECT.split("/").pop() : STARTER_LAYOUT ? `${CODEBASE.split("/").pop()}/.factory` : FACTORY.split("/").pop();
const COURSE = "/workspaces/tutorial";
const BB_SH = new URL("./bb.sh", import.meta.url).pathname;
const TURNS = "/workspaces/.bb-state/plugins/scripted-provider/bridge-data/turns.ndjson";
const FILLER_TURNS = 40;

function check(cond, what) {
  if (!cond) throw new Error(`CHECK FAILED: ${what}`);
  console.log(`  ok  ${what}`);
}

function tell(threadId, lines) {
  execFileSync(BB_SH, ["thread", "tell", threadId, "--message-file", "-"], { input: lines.join("\n") + "\n", encoding: "utf8" });
}
function waitIdle(threadId) {
  bb("thread", "wait", threadId, "--timeout", "120");
}
function turns(threadId) {
  const text = sh(`cat ${TURNS} 2>/dev/null || true`);
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.event === "turn" && e.threadId === threadId);
}
/** Tells the thread, waits for the turn, and returns that turn's tool report. */
async function turn(threadId, lines) {
  const before = turns(threadId).length;
  tell(threadId, lines);
  const t = await until(`turn ${before + 1} of ${threadId}`, () => turns(threadId)[before], { timeout: 120000 });
  waitIdle(threadId);
  return t;
}
/** The full result of the thread's latest call of `tool` (the tool report is truncated). */
function lastToolResult(threadId, tool) {
  const items = bbJson("thread", "log", threadId, "--all")
    .filter((e) => e.type === "item/completed" && e.data?.item?.type === "toolCall" && e.data.item.tool === tool);
  const item = items.at(-1)?.data.item;
  if (!item) throw new Error(`no ${tool} call in ${threadId}`);
  return String(item.result ?? item.error ?? "");
}
/** The `::tutor-progress{…}` card a tool returned, as the coach would echo it. */
function cardFrom(threadId, tool) {
  const result = lastToolResult(threadId, tool);
  const m = /(::tutor-progress\{[^\n]*\})/.exec(result);
  if (!m) throw new Error(`no progress card in ${tool} result: ${result}`);
  return m[1];
}
function tutorThreads() {
  return bbJson("thread", "list").filter((t) => /^Coach · /.test(t.title ?? ""));
}
function api(path) {
  return JSON.parse(sh(`curl -fsS "$BB_SERVER_URL/api/v1/${path}"`));
}
function sideChatsOf(coach) {
  return api(`threads?includeHidden=true&sourceThreadId=${coach}`).filter((t) => t.visibility === "hidden" && t.archivedAt === null);
}
function sideChatTabs(coach) {
  return api(`threads/${coach}/tabs`).tabs.filter((tab) => tab.kind === "plugin-panel" && tab.pluginId === "side-chat");
}
function readFactory(path) {
  return sh(`cat ${FACTORY}/${path} 2>/dev/null || true`);
}
/** Whether a path exists (a file, folder or dangling symlink). */
function exists(path) {
  return sh(`if [ -e '${path}' ] || [ -L '${path}' ]; then echo yes; else echo no; fi`).trim() === "yes";
}
/** Rule and Example keys, in file order, from the coach's tutor_status result. */
function keysFrom(status) {
  const rules = [...status.matchAll(/^[● ] (\S+) — /gm)].map((m) => m[1]);
  const examples = [...status.matchAll(/^ {4}\S (\S+\/\S+\/\S+) — /gm)].map((m) => m[1]);
  return { rules, examples };
}
const anchorOf = (coach, rule) => `${coach}|000/${rule}`;
const anchorSelector = (coach, rule) => `[data-tutor-rule-anchor="${anchorOf(coach, rule)}"]`;

const { browser, context, page, errors } = await openBrowser();
const steps = [];
const outline = () => page.locator("nav.tp-outline");
const lessonRow = (id) => outline().locator(`li.tp-lesson[data-lesson-id="${id}"]`);
async function openThread(threadId) {
  if (!page.url().endsWith(`/threads/${threadId}`)) {
    await page.goto(`${BASE}/threads/${threadId}`, { waitUntil: "load" });
    await outline().waitFor({ timeout: 30000 });
  }
  await page.locator(`[data-timeline-row-id^="${threadId}:"]`).first().waitFor({ timeout: 30000 });
  await sleep(1500);
}
/** Scrolls BB's timeline to the newest message. */
async function showLatest() {
  const latest = page.getByRole("button", { name: "Scroll to latest event" });
  if (await latest.isVisible().catch(() => false)) await latest.click();
  await sleep(1200);
}
async function showRightPanel() {
  const show = page.getByRole("button", { name: /Show right panel/ });
  if (await show.isVisible().catch(() => false)) {
    await show.click();
    await sleep(1200);
  }
}
async function inViewport(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }, selector);
}
const step = (name, fn) => steps.push({ name, fn });
const ctx = JSON.parse(process.env.E2E_CTX ?? "{}");

step("01 first run asks to confirm the detected factory", async () => {
  await page.goto(`${BASE}/plugins/tutor/course`, { waitUntil: "load" });
  await page.getByText("Start the course →").waitFor({ timeout: 30000 });
  check(await page.getByText(PROJECT_NAME, { exact: true }).first().isVisible(), `detected factory ${PROJECT_NAME} is offered`);
  check(await outline().getByText("Using your tutor").first().isVisible(), "the course outline lists Lesson 0");
  await sleep(1000);
  await shot(page, "e2e-01-first-run");
});

step("02 confirm lands on Lesson 0's start page; the outline is one tree of lessons", async () => {
  await page.getByText("Start the course →").click();
  await page.waitForURL(/\/plugins\/tutor\/course\/start\/000/, { timeout: 30000 });
  await page.getByText("Start with your coach →").waitFor({ timeout: 30000 });
  const config = JSON.parse(bb("plugin", "config", "tutor", "--json"));
  check(/^proj_/.test(config.values.factoryProject ?? ""), `factoryProject is set (${config.values.factoryProject})`);
  await outline().locator("li.tp-lesson").first().waitFor({ timeout: 30000 });
  const ids = await outline().locator("li.tp-lesson").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-lesson-id")));
  const badges = await outline().locator("li.tp-lesson .tp-lesson-head .tp-n").allInnerTexts();
  check(badges[0] === "0", `each lesson's step badge shows its number (${badges.join(" ")})`);
  check(["000", "001", "002", "003", "007"].every((id) => ids.includes(id)), `the outline lists every lesson as a row (${ids.join(" ")})`);
  const zero = lessonRow("000");
  check((await zero.locator(".tp-lesson-head").getAttribute("aria-expanded")) === "true", "the lesson you are on is expanded");
  check((await lessonRow("001").locator(".tp-lesson-head").getAttribute("aria-expanded")) === "false", "other lessons are collapsed");
  check((await zero.innerText()).includes("0/10"), "Lesson 0 counts 0/10 examples");
  check(await zero.getByRole("button", { name: /Start with your coach/ }).isVisible(), "no coach thread yet: the outline offers Start with your coach");
  check((await outline().getByText(/Homework|Course rail|Conversations/).count()) === 0, "no rail-era words or sections remain");
  await sleep(800);
  await shot(page, "e2e-02-start-page-outline");
});

step("03 Start with your coach opens the coach thread in BB's own thread view, led by the lesson card", async () => {
  await page.getByText("Start with your coach →").click();
  const thread = await until("coach thread for 000", () => tutorThreads().find((t) => t.title === "Coach · Lesson 000"));
  ctx.coach0 = thread.id;
  await page.waitForURL(new RegExp(`/threads/${ctx.coach0}$`), { timeout: 30000 });
  check(true, `coach thread ${thread.id} opened in the native thread view`);
  await until("first coach turn", () => turns(ctx.coach0)[0], { timeout: 120000 });
  waitIdle(ctx.coach0);
  const first = turns(ctx.coach0)[0];
  check(first.tools.includes("tutor_mark_example") && first.tools.includes("tutor_side_chat"), "the coach thread is offered the tutor tools");
  check((first.skills ?? []).includes("tutor"), "the coach thread is offered the tutor skill");
  check(first.directives[0] === '::tutor-lesson{lesson="000"}', "the first reply opens with the lesson card line");
  const card = page.locator('[data-tutor-lesson="000"]');
  await card.waitFor({ timeout: 30000 });
  check((await card.innerText()).includes("Using your tutor"), "the lesson card renders in the first coach reply");
  check((await card.locator(".tp-lcard-rule").count()) === 5, "the lesson card lists Lesson 0's five Rules");
  const coachRow = lessonRow("000").locator("a.tp-th--coach");
  await coachRow.waitFor({ timeout: 20000 });
  check((await coachRow.innerText()).includes("Coach · Lesson 000"), "the outline shows the coach thread under Lesson 0");
  check((await coachRow.getAttribute("data-sidebar-thread-id")) === ctx.coach0, "the coach row carries BB's sidebar thread attributes");
  await sleep(1500);
  await shot(page, "e2e-03-coach-thread-lesson-card");
});

step("04 the coach adopts Lesson 0; every Rule is greyed until the coach reaches it", async () => {
  await openThread(ctx.coach0);
  const t = await turn(ctx.coach0, ["CALL tutor_adopt_iteration {\"iteration\":\"000\"}", "CALL tutor_status {}", "::term{id=\"doer-validator-loop\"}"]);
  check(t.toolReport.every((r) => r.includes(": ok →")), "adopt and status succeeded");
  ctx.keys = keysFrom(lastToolResult(ctx.coach0, "tutor_status"));
  check(ctx.keys.rules.length === 5 && ctx.keys.examples.length === 10, `tutor_status lists 5 Rules and 10 Examples`);
  check(/iteration: "000"/.test(readFactory("spec/PROGRESS.yaml")), "spec/PROGRESS.yaml records iteration \"000\"");
  if (STARTER_LAYOUT) {
    check(!exists(`${FACTORY}/ITERATION`) && !exists(`${FACTORY}/spec/ITERATION`), "neither ITERATION nor spec/ITERATION is written for Lesson 0");
  } else {
    check(!exists(`${FACTORY}/spec/ITERATION`), "spec/ITERATION is not written for Lesson 0");
  }
  await sleep(1500);
  const rows = lessonRow("000").locator(".tp-rrow");
  check((await rows.count()) === 5, "the coach thread's Rules sit under it in the outline, grouped by Feature");
  check((await lessonRow("000").locator(".tp-rrow--unreached").count()) === 5, "every Rule is greyed before the coach reaches it");
  check((await rows.first().getAttribute("title")) === "Your coach hasn't reached this Rule yet", "a greyed Rule says why");
  await showLatest();
  const chip = page.locator(".tp-term-line button").last();
  check(await chip.isVisible(), "the ::term chip renders in the coach's reply");
  await chip.hover();
  await page.locator(".tp-termpop").waitFor({ timeout: 10000 });
  check(true, "hovering the term chip pops up its lexicon definition");
  await shot(page, "e2e-04-adopted-term");
  await page.mouse.move(700, 450);
});

step("05 the coach reaches the first Rule: its Rule card starts its section, and the outline links it", async () => {
  ctx.ruleA = ctx.keys.rules[0];
  const t = await turn(ctx.coach0, [`CALL tutor_focus_rule {"rule":"${ctx.ruleA}"}`]);
  check(t.toolReport[0].includes(": ok →"), "tutor_focus_rule succeeded in the coach thread");
  check(t.directives[0]?.startsWith('::tutor-progress{kind="focus"'), "the reply turning to the Rule opens with its Rule card");
  await openThread(ctx.coach0);
  await showLatest();
  const card = page.locator(anchorSelector(ctx.coach0, ctx.ruleA));
  await card.waitFor({ timeout: 20000 });
  check((await card.locator(".tp-anno").count()) === 2, "the Rule card shows its Examples as annotated Gherkin");
  check(await card.getByRole("button", { name: /Ask a side question/ }).isVisible(), "the Rule card offers a side question");
  await until("the outline to link the reached Rule", async () => (await lessonRow("000").locator(`a.tp-rrow[data-rule-key="${ctx.ruleA}"]`).count()) === 1, { timeout: 20000 });
  check((await lessonRow("000").locator(".tp-rrow--unreached").count()) === 4, "the other four Rules stay greyed");
  const t2 = await turn(ctx.coach0, [
    `CALL tutor_mark_example {"example":"${ctx.keys.examples[0]}","status":"passing","evidence":"Student: Lesson 0 is open in the outline, 0/10."}`,
  ]);
  check(t2.toolReport[0].includes(": ok →"), "tutor_mark_example succeeded");
  await until("the outline to count 1/10", async () => (await lessonRow("000").innerText()).includes("1/10"), { timeout: 20000 });
  check(true, "the outline counts 1/10, live");
  await showLatest();
  await shot(page, "e2e-05-rule-card");
});

step(`06 ${FILLER_TURNS} more turns, then a second Rule far below the first`, async () => {
  for (let i = 1; i <= FILLER_TURNS; i += 1) await turn(ctx.coach0, [`Filler turn ${i}: keep going.`]);
  ctx.ruleB = ctx.keys.rules.find((key) => /side-chat/.test(key)) ?? ctx.keys.rules[3];
  const t = await turn(ctx.coach0, [`CALL tutor_focus_rule {"rule":"${ctx.ruleB}"}`]);
  check(t.toolReport[0].includes(": ok →"), "the coach moves the focus to a second Rule");
  const ruleBExample = ctx.keys.examples.find((key) => key.startsWith(`${ctx.ruleB}/`));
  const n = await turn(ctx.coach0, [`CALL tutor_mark_example {"example":"${ruleBExample}","status":"not-yet","note":"The side chat was not in the outline yet."}`]);
  check(n.toolReport[0].includes(": ok →"), "a not-yet note is recorded");
  await openThread(ctx.coach0);
  await showLatest();
  check((await page.locator(".tp-rrow--focus").innerText()).length > 0, "the outline marks the Rule in focus");
  await shot(page, "e2e-06-second-rule");
});

step("07 clicking an early Rule loads older history and scrolls to its Rule card", async () => {
  await page.goto(`${BASE}/threads/${ctx.coach0}`, { waitUntil: "load" });
  await page.locator(`[data-timeline-row-id^="${ctx.coach0}:"]`).first().waitFor({ timeout: 30000 });
  await sleep(2500);
  const early = anchorSelector(ctx.coach0, ctx.ruleA);
  check((await page.locator(early).count()) === 0, "the first Rule's card is not in the DOM at first (BB lazy-loads history)");
  await lessonRow("000").locator(`a.tp-rrow[data-rule-key="${ctx.ruleA}"]`).click();
  await until("the early Rule card to scroll into view", () => inViewport(early), { timeout: 30000, every: 500 });
  check(true, "the jump loaded older history and brought the first Rule's card into view");
  await sleep(600);
  await shot(page, "e2e-07-jumped-to-early-rule");
  await lessonRow("000").locator(`a.tp-rrow[data-rule-key="${ctx.ruleB}"]`).click();
  await until("the recent Rule card to scroll into view", () => inViewport(anchorSelector(ctx.coach0, ctx.ruleB)), { timeout: 20000, every: 500 });
  check(true, "a recent Rule jumps to its section too");
});

step("08 Ask a side question makes a hidden fork and puts BB's Side chat tab in the coach thread's right panel", async () => {
  await openThread(ctx.coach0);
  const before = sideChatsOf(ctx.coach0).length;
  await lessonRow("000").getByRole("button", { name: "Ask a side question" }).click();
  const fork = await until("a hidden fork of the coach thread", () => sideChatsOf(ctx.coach0).find((t) => t.originPluginId === "tutor"), { timeout: 30000 });
  ctx.sideChat = fork.id;
  check(sideChatsOf(ctx.coach0).length === before + 1 && fork.originKind === "fork" && fork.visibility === "hidden", `side chat ${fork.id} is a hidden fork of the coach thread`);
  const tabs = sideChatTabs(ctx.coach0);
  check(tabs.some((tab) => JSON.parse(tab.paramsJson).threadId === fork.id && tab.actionId === "side-chat" && tab.title === "Side chat"), "BB's Side chat tab for it is in the coach thread's tabs");
  await page.getByText(/“Side chat” tab/).first().waitFor({ timeout: 10000 });
  check(true, "a toast points to the Side chat tab");
  await showRightPanel();
  const tab = page.getByText("Side chat", { exact: true }).last();
  await tab.waitFor({ timeout: 20000 });
  await tab.click();
  await sleep(2000);
  check(await page.getByText(/A side question about the Rule/).first().isVisible(), "the Side chat tab renders the side chat, replying to the Rule");
  const side = lessonRow("000").locator(`a[data-side-kind="side-chat"]`);
  await side.first().waitFor({ timeout: 20000 });
  check((await side.first().innerText()).includes("from: "), "the side chat is listed under the lesson, from its Rule");
  await shot(page, "e2e-08-side-chat-tab");
});

step("08b the side chat can mark Examples and read status but not move the focus", async () => {
  const t = await turn(ctx.sideChat, ["CALL tutor_status {}", `FORCECALL tutor_focus_rule {"rule":"${ctx.ruleA}"}`]);
  console.log(t.toolReport.join("\n").slice(0, 500));
  check(t.tools.includes("tutor_status"), "the side chat is offered the tutor tools");
  check(t.toolReport[0].includes(": ok →"), "tutor_status works in the side chat");
  check(t.toolReport[1].includes("ERROR") && t.toolReport[1].includes("Only the coach thread moves the focus"), "the side chat's tutor_focus_rule is refused");
});

step("09 BB's own Reply in side chat also lands in the outline", async () => {
  await openThread(ctx.coach0);
  await showLatest();
  const before = new Set(sideChatsOf(ctx.coach0).map((t) => t.id));
  const rowsBefore = await lessonRow("000").locator(`a[data-side-kind="side-chat"]`).count();
  const message = page.locator(`[data-timeline-row-id^="${ctx.coach0}:assistant"]`).last();
  await message.hover();
  await sleep(500);
  await page.getByRole("button", { name: "Reply in side chat" }).last().click();
  const fork = await until("BB's side chat fork", () => sideChatsOf(ctx.coach0).find((t) => !before.has(t.id)), { timeout: 30000 });
  ctx.bbSideChat = fork.id;
  check(fork.originPluginId === "side-chat", `BB made side chat ${fork.id}`);
  await until("BB's side chat in the outline", async () => (await lessonRow("000").locator(`a[data-side-kind="side-chat"]`).count()) === rowsBefore + 1, { timeout: 20000 });
  check(true, "BB's side chat is listed under the lesson too");
  const t = await turn(ctx.bbSideChat, ["CALL tutor_status {}"]);
  check(t.toolReport[0]?.includes(": ok →"), "a side chat BB made of the coach thread can use Tutor's tools");
  await sleep(1000);
  await shot(page, "tree-desktop-thread");
  await page.locator("nav.tp-outline").screenshot({ path: `${SHOTS}/tree-desktop.png` });
  console.log("  shot tree-desktop.png");
});

step("09b closing a side chat's tab and choosing it in the outline puts the tab back", async () => {
  const tabs = api(`threads/${ctx.coach0}/tabs`);
  const kept = tabs.tabs.filter((tab) => !(tab.kind === "plugin-panel" && tab.pluginId === "side-chat" && JSON.parse(tab.paramsJson).threadId === ctx.sideChat));
  sh(`curl -fsS -X PUT -H 'content-type: application/json' "$BB_SERVER_URL/api/v1/threads/${ctx.coach0}/tabs" -d '${JSON.stringify({ expectedRevision: tabs.revision, tabs: kept }).replace(/'/g, "'\\''")}' >/dev/null`);
  check(!sideChatTabs(ctx.coach0).some((tab) => JSON.parse(tab.paramsJson).threadId === ctx.sideChat), "the side chat's tab is closed");
  await lessonRow("000").locator(`a[data-side-kind="side-chat"]`).filter({ hasText: "from: " }).first().click();
  await until("the tab to come back", () => sideChatTabs(ctx.coach0).some((tab) => JSON.parse(tab.paramsJson).threadId === ctx.sideChat), { timeout: 20000 });
  check(page.url().endsWith(`/threads/${ctx.coach0}`), "choosing the side chat opens its coach thread with the tab back");
});

step("10 narrow screen: the outline in BB's drawer", async () => {
  const mobile = await context.browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await mobile.newPage();
  await phone.goto(`${BASE}/threads/${ctx.coach0}`, { waitUntil: "load" });
  await sleep(3000);
  await shot(phone, "tree-mobile-thread");
  const toggle = phone.getByRole("button", { name: /Toggle sidebar|Open sidebar|sidebar/i }).first();
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await phone.locator("nav.tp-outline").waitFor({ timeout: 20000 });
  await sleep(1500);
  await shot(phone, "tree-mobile");
  check(await phone.locator("nav.tp-outline li.tp-lesson").first().isVisible(), "the outline opens in the mobile drawer");
  const rule = phone.locator(`nav.tp-outline a.tp-rrow[data-rule-key="${ctx.ruleB}"]`);
  await rule.click();
  await until("the drawer to close on navigation", async () => !(await phone.locator("nav.tp-outline").isVisible().catch(() => false)), { timeout: 10000 }).catch(() => {});
  await mobile.close();
});

step("11 every Example passes; the coach completes Lesson 0", async () => {
  for (const [i, key] of ctx.keys.examples.entries()) {
    if (i === 0) continue;
    const t = await turn(ctx.coach0, [`CALL tutor_mark_example {"example":"${key}","status":"passing","evidence":"Student reported what they saw for example ${i + 1}."}`]);
    check(t.toolReport[0].includes(": ok →"), `${key.split("/").pop()} passing`);
  }
  const t = await turn(ctx.coach0, [
    "CALL tutor_complete_iteration {\"iteration\":\"000\",\"summary\":\"You know your way around the tutor: the outline, the cards and side chats.\"}",
  ]);
  check(t.toolReport[0].includes(": ok →"), "tutor_complete_iteration succeeded");
  await openThread(ctx.coach0);
  await showLatest();
  await shot(page, "e2e-11-lesson-complete");
});

step("12 the completion page starts Lesson 1, which opens its coach thread", async () => {
  await page.goto(`${BASE}/plugins/tutor/course/complete/000`, { waitUntil: "load" });
  const start = page.getByText(/Start lesson 1 with your coach/).first();
  await start.waitFor({ timeout: 30000 });
  const text = await page.locator(".tp-done-panel").innerText();
  const sideChats = sideChatsOf(ctx.coach0).length;
  check(text.includes("10/10") && new RegExp(`${sideChats}\\s*side chats`).test(text), `the completion page counts 10/10 and the ${sideChats} side chats, BB's included`);
  await shot(page, "e2e-12-between-lessons");
  await start.click();
  const thread = await until("coach thread for 001", () => tutorThreads().find((t) => t.title === "Coach · Lesson 001"));
  ctx.coach1 = thread.id;
  await page.waitForURL(new RegExp(`/threads/${ctx.coach1}$`), { timeout: 30000 });
  check(true, "starting Lesson 1 opens its coach thread");
  await until("first 001 turn", () => turns(ctx.coach1)[0], { timeout: 120000 });
  waitIdle(ctx.coach1);
  const t = await turn(ctx.coach1, ["CALL tutor_adopt_iteration {\"iteration\":\"001\"}"]);
  check(t.toolReport[0].includes(": ok →"), "tutor_adopt_iteration 001 succeeded");
  if (STARTER_LAYOUT) {
    check(readFactory("ITERATION").trim() === "001 WIP", "the factory's root ITERATION is 001 WIP");
    check(!exists(`${FACTORY}/spec/ITERATION`), "spec/ITERATION is absent");
  } else {
    check(readFactory("spec/ITERATION").trim() === "001 WIP", "spec/ITERATION is 001 WIP");
  }
  const diff = sh(`diff -r ${COURSE}/docs/iterations/001-*/features ${FACTORY}/spec/features && echo same`);
  check(diff.trim().endsWith("same"), "spec/features matches the course's 001 features exactly");
  if (STARTER_LAYOUT) {
    const seed = `${CODEBASE}/seeds/${CODEBASE.split("/").pop()}.md`;
    check(exists(seed), `the seed ${seed} exists`);
    check(sh(`cmp ${COURSE}/docs/iterations/001-*/spec.md ${seed} && echo same`).trim().endsWith("same"), "the seed is the course's 001 spec.md");
    check(!exists(`${FACTORY}/seeds`), `${FACTORY}/seeds does not exist`);
    check(exists(`${FACTORY}/stand-ins`), "the factory has stand-ins/");
    check(sh(`diff -r ${COURSE}/stand-ins ${FACTORY}/stand-ins && echo same`).trim().endsWith("same"), "stand-ins/ matches the course's stand-ins/ exactly (diff -r is empty)");
    const spec = sh(`ls -A ${FACTORY}/spec`).trim().split("\n");
    check(["README.md", "FACTORY.md", "features"].every((n) => spec.includes(n)), `spec/ holds README.md, FACTORY.md and features/ (${spec.join(" ")})`);
    check(sh(`cd ${FACTORY}/spec && for f in README.md FACTORY.md; do cmp ${COURSE}/docs/iterations/001-*/$f $f || exit 1; done && echo same`).trim().endsWith("same"), "spec/README.md and spec/FACTORY.md are the course's 001 files");
  }
  await page.goto(`${BASE}/plugins/tutor/course/start/001`, { waitUntil: "load" });
  await page.waitForURL(new RegExp(`/threads/${ctx.coach1}$`), { timeout: 30000 });
  check(true, "the start route of a started lesson opens its coach thread");
  await page.goBack();
  await sleep(2000);
  check(await page.getByRole("button", { name: "Open the coach thread →" }).isVisible(), "Back to the start route does not bounce");
});

step("13 BB home's Continue opens the coach thread", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.getByText(/Continue with your coach/).first().waitFor({ timeout: 30000 });
  await sleep(1000);
  await shot(page, "e2e-13-home-continue");
  await page.getByText(/Continue with your coach/).first().click();
  await page.waitForURL(new RegExp(`/threads/${ctx.coach1}$`), { timeout: 30000 });
  check(true, "Continue with your coach opens the Lesson 1 coach thread");
});

step("14 a non-Tutor thread cannot use Tutor tools", async () => {
  const project = bbJson("project", "list").find((p) => (p.sources ?? []).some((s) => s.path === PROJECT));
  const progressBefore = readFactory("spec/PROGRESS.yaml");
  sh(`printf '%s\\n' 'FORCECALL tutor_mark_example {"example":"${ctx.keys.examples[0]}","status":"pending"}' 'FORCECALL tutor_status {}' > /tmp/forcecall.txt`);
  const spawned = JSON.parse(bb("thread", "spawn", "--project", project.id, "--provider", "scripted", "--title", "Ordinary thread", "--prompt-file", "/tmp/forcecall.txt", "--json"));
  ctx.plain = spawned.id;
  const t = await until("ordinary thread turn", () => turns(ctx.plain)[0], { timeout: 120000 });
  waitIdle(ctx.plain);
  check(!t.tools.some((x) => x.startsWith("tutor_")), "ordinary thread is not offered tutor tools");
  check(!(t.skills ?? []).includes("tutor"), "ordinary thread is not offered the tutor skill");
  check(t.toolReport.length === 2 && t.toolReport.every((r) => r.includes("ERROR")), "both forced tutor tool calls return isError");
  check(readFactory("spec/PROGRESS.yaml") === progressBefore, "spec/PROGRESS.yaml is unchanged by the forced calls");
  await page.goto(`${BASE}/threads/${ctx.plain}`, { waitUntil: "load" });
  await sleep(2500);
  check((await outline().locator(".tp-other-group").innerText()).includes("Ordinary thread"), "the ordinary thread is under Other threads");
});

step("15 Lesson 0 stays truthful after moving on", async () => {
  check(/^history:\n {2}"000":\n/m.test(readFactory("spec/PROGRESS.yaml")), "PROGRESS.yaml keeps Lesson 0 under history");
  await page.goto(`${BASE}/threads/${ctx.coach1}`, { waitUntil: "load" });
  await outline().locator("li.tp-lesson").first().waitFor({ timeout: 30000 });
  await sleep(1500);
  check((await lessonRow("001").locator(".tp-lesson-head").getAttribute("aria-expanded")) === "true", "the outline opens Lesson 1 now");
  const zero = lessonRow("000");
  check((await zero.innerText()).includes("10/10"), "Lesson 0 still counts 10/10");
  await zero.locator(".tp-lesson-head").click();
  check((await zero.locator(`a.tp-rrow[data-rule-key="${ctx.ruleA}"]`).count()) === 1, "a done lesson's reached Rules still link to their sections");
  await shot(page, "e2e-15-after-moving-on");
});

/** Passes every Example of the coach's lesson, a few calls a turn, completes the lesson, and commits as the coach would. */
async function finishLesson(coach, id) {
  await turn(coach, ["CALL tutor_status {}"]);
  const { examples } = keysFrom(lastToolResult(coach, "tutor_status"));
  check(examples.length > 0, `tutor_status lists Lesson ${id}'s ${examples.length} Examples`);
  for (let i = 0; i < examples.length; i += 8) {
    const calls = examples.slice(i, i + 8).map((key) => `CALL tutor_mark_example {"example":"${key}","status":"passing","evidence":"$ ./factory\\nok"}`);
    const t = await turn(coach, calls);
    if (!t.toolReport.every((r) => r.includes(": ok →"))) throw new Error(`CHECK FAILED: marking Lesson ${id}'s Examples: ${t.toolReport.join(" | ")}`);
  }
  const done = await turn(coach, [`CALL tutor_complete_iteration {"iteration":"${id}","summary":"Done ${id}."}`]);
  check(done.toolReport[0].includes(": ok →"), `tutor_complete_iteration ${id} succeeded`);
  sh(`cd '${PROJECT}' && git add -A && git commit -qm 'Iteration ${id}'`);
}

/** Starts the lesson after `id` from its completion page, and has its new coach adopt it. */
async function startAndAdopt(id, next) {
  await page.goto(`${BASE}/plugins/tutor/course/complete/${id}`, { waitUntil: "load" });
  const start = page.getByText(new RegExp(`Start lesson ${Number(next)} with your coach`)).first();
  await start.waitFor({ timeout: 30000 });
  await start.click();
  const thread = await until(`coach thread for ${next}`, () => tutorThreads().find((t) => t.title === `Coach · Lesson ${next}`));
  await until(`first ${next} turn`, () => turns(thread.id)[0], { timeout: 120000 });
  waitIdle(thread.id);
  const t = await turn(thread.id, [`CALL tutor_adopt_iteration {"iteration":"${next}"}`]);
  check(t.toolReport[0].includes(": ok →"), `tutor_adopt_iteration ${next} succeeded`);
  return thread.id;
}

step("16 lessons 001-003 in tetris/.factory, then adopting 004 moves the factory to factory/ as fetch.sh does", async () => {
  if (!REPO_LAYOUT) {
    console.log("  skip  the project is not a starter clone's top folder");
    return;
  }
  const starterHead = sh(`git -C '${PROJECT}' rev-parse HEAD`).trim();
  await finishLesson(ctx.coach1, "001");
  const coach2 = await startAndAdopt("001", "002");
  await finishLesson(coach2, "002");
  const coach3 = await startAndAdopt("002", "003");
  check(readFactory("ITERATION").trim() === "003 WIP", "tetris/.factory/ITERATION is 003 WIP");
  check(!exists(`${PROJECT}/factory`), "no factory/ before 004");
  await finishLesson(coach3, "003");
  ctx.coach4 = await startAndAdopt("003", "004");
  const early = FACTORY;
  FACTORY = `${PROJECT}/factory`;
  check(exists(FACTORY) && !exists(early), "factory/ exists and tetris/.factory is gone");
  check(sh(`readlink '${FACTORY}/.claude/skills'`).trim() === "../../.agents/skills", "factory/.claude/skills links to ../../.agents/skills");
  const porcelain = sh(`git -C '${PROJECT}' status --porcelain`);
  check(/^R. tetris\/\.factory\/AGENTS\.md -> factory\/AGENTS\.md$/m.test(porcelain), "the factory's renames are staged");
  check(readFactory("ITERATION").trim() === "004 WIP", "factory/ITERATION is 004 WIP");
  check(sh(`diff -r ${COURSE}/docs/iterations/004-*/features ${FACTORY}/spec/features && echo same`).trim().endsWith("same"), "factory/spec/features matches the course's 004 features");
  check(sh(`diff -r ${COURSE}/stand-ins ${FACTORY}/stand-ins && echo same`).trim().endsWith("same"), "factory/stand-ins matches the course's stand-ins");
  check(exists(`${FACTORY}/stand-ins/acp`), "factory/stand-ins has acp/");
  check(sh(`cmp ${COURSE}/docs/iterations/001-*/spec.md ${CODEBASE}/seeds/tetris.md && echo same`).trim().endsWith("same"), "tetris/seeds/tetris.md is still the course's 001 seed");

  // A second clone of the starter, as it was before the walk, run through its own fetch.sh with the same course.
  const clone = "/tmp/tutor-e2e-fetch";
  const fetched = sh(`set -euo pipefail
rm -rf ${clone} /tmp/tutor-e2e-bin && mkdir -p /tmp/tutor-e2e-bin
printf '#!/usr/bin/env bash\\nexec tar -cz -C /workspaces --exclude=.git tutorial\\n' > /tmp/tutor-e2e-bin/curl && chmod +x /tmp/tutor-e2e-bin/curl
git clone -q '${PROJECT}' ${clone} && git -C ${clone} checkout -q ${starterHead}
git -C ${clone} config user.name "E2E Student" && git -C ${clone} config user.email student@example.invalid
cd ${clone}/tetris/.factory
for id in 001 002 003; do
  PATH=/tmp/tutor-e2e-bin:$PATH bash ${clone}/.agents/skills/fetch-iteration/fetch.sh >/dev/null
  echo "$id Done" > ITERATION && git -C ${clone} add -A && git -C ${clone} commit -qm "Iteration $id"
done
PATH=/tmp/tutor-e2e-bin:$PATH bash ${clone}/.agents/skills/fetch-iteration/fetch.sh`);
  check(/moved the factory to factory\//.test(fetched), "fetch.sh moved the second clone's factory to factory/");
  const same = sh(`diff -r --no-dereference --exclude=PROGRESS.yaml --exclude=ITERATION --exclude=jobs '${FACTORY}' ${clone}/factory && diff -r '${CODEBASE}/seeds' ${clone}/tetris/seeds && echo same`);
  check(same.trim().endsWith("same"), "factory/ and tetris/seeds/ match the fetch.sh clone's");
  const staged = (dir) => sh(`git -C '${dir}' status --porcelain --untracked-files=all | grep -v PROGRESS.yaml | sort || true`);
  check(staged(PROJECT) === staged(clone), "the same changes are staged as in the fetch.sh clone");

  const t4 = await turn(ctx.coach4, ["CALL tutor_status {}"]);
  check(t4.toolReport[0].includes(": ok →"), "the 004 coach takes a turn");
  check(/Factory: factory\//.test(lastToolResult(ctx.coach4, "tutor_status")), "tutor_status names factory/");
  const t1 = await turn(ctx.coach1, ["CALL tutor_status {}"]);
  check(t1.toolReport[0].includes(": ok →"), "the Lesson 001 coach still takes a turn");
  check(/Factory: factory\//.test(lastToolResult(ctx.coach1, "tutor_status")), "the older coach's tutor_status names factory/ too");
  await openThread(ctx.coach4);
  await shot(page, "e2e-16-after-the-move");
});

let failed = false;
const only = process.argv.slice(2);
for (const s of steps) {
  if (only.length > 0 && !only.some((o) => s.name.startsWith(o))) continue;
  console.log(`STEP ${s.name}`);
  try {
    await s.fn();
  } catch (e) {
    failed = true;
    console.error(`  FAIL ${e.message}`);
    await shot(page, `e2e-FAIL-${s.name.slice(0, 3).trim()}`).catch(() => {});
    break;
  }
}
if (errors.length) console.log(`browser errors:\n${[...new Set(errors)].join("\n")}`);
console.log(JSON.stringify(ctx));
await browser.close();
process.exit(failed ? 1 : 0);
