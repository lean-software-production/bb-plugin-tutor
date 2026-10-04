import assert from "node:assert/strict";
import { test } from "node:test";
import { hostedWelcome } from "./welcome.ts";

test("no machine: open your Codespace, Tutor connects by itself", () => {
  assert.deepEqual(hostedWelcome({ status: "no-machine" }), {
    heading: "Open your Codespace",
    body: "Open your Codespace of capstone-project-starter. Tutor connects to it by itself; this page updates when it has.",
    action: null,
  });
});

test("no folder: names the folder Tutor looked for", () => {
  const view = hostedWelcome({ status: "no-folder", folder: "/workspaces/capstone-project-starter", machineName: "cs-1" });
  assert.match(view.body, /\/workspaces\/capstone-project-starter/);
  assert.equal(view.action, null);
});

test("offer: one button, naming the folder", () => {
  const view = hostedWelcome({ status: "offer", hostId: "h", machineName: "cs-1", folder: "/workspaces/capstone-project-starter" });
  assert.deepEqual(view.action, { label: "Use /workspaces/capstone-project-starter", hostId: "h", folder: "/workspaces/capstone-project-starter" });
});

test("nothing student-facing says BB", () => {
  for (const offer of [
    { status: "no-machine" as const },
    { status: "no-folder" as const, folder: "/w", machineName: "m" },
    { status: "offer" as const, hostId: "h", machineName: "m", folder: "/w" },
  ]) {
    const view = hostedWelcome(offer);
    assert.doesNotMatch(`${view.heading} ${view.body} ${view.action?.label ?? ""}`, /\bBB\b/);
  }
});
