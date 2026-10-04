import assert from "node:assert/strict";
import { test } from "node:test";
import type { CandidateProject } from "../../shared/rpc.ts";
import { hostedWelcome, showsHostedOffer, unreachableView } from "./welcome.ts";

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

test("the first run offers the Codespace checkout when no candidate is on a connected machine", () => {
  const candidate = (over: Partial<CandidateProject>): CandidateProject => ({
    projectId: "p",
    name: "p",
    root: "/workspaces/p",
    qualifies: true,
    detail: "",
    reachable: true,
    ...over,
  });
  assert.equal(showsHostedOffer([]), true);
  assert.equal(showsHostedOffer([candidate({ reachable: false, qualifies: false })]), true, "only a project on the old, stopped Codespace");
  assert.equal(showsHostedOffer([candidate({ root: null, qualifies: false })]), true, "a project with no folder anywhere");
  assert.equal(showsHostedOffer([candidate({ reachable: false }), candidate({ projectId: "q" })]), false);
  assert.equal(showsHostedOffer([candidate({ qualifies: false })]), false, "a connected project that doesn't qualify still lists");
});

test("an unreachable workspace with a new Codespace to use: one button naming the folder and the machine", () => {
  const view = unreachableView({ status: "offer", hostId: "host_new", machineName: "cs-2", folder: "/workspaces/capstone-project-starter" });
  assert.deepEqual(view.action, {
    label: "Use /workspaces/capstone-project-starter on your Codespace (cs-2)",
    hostId: "host_new",
    folder: "/workspaces/capstone-project-starter",
  });
});

test("an unreachable workspace with nothing else to use says the Codespace is asleep", () => {
  for (const offer of [null, { status: "no-machine" as const }, { status: "no-folder" as const, folder: "/w", machineName: "m" }]) {
    const view = unreachableView(offer);
    assert.equal(view.action, null);
    assert.equal(view.body, "Your Codespace is asleep or stopped. Open it and Tutor reconnects by itself.");
    assert.doesNotMatch(`${view.heading} ${view.body}`, /\bBB\b/);
  }
  const offered = unreachableView({ status: "offer", hostId: "h", machineName: "m", folder: "/w" });
  assert.doesNotMatch(`${offered.heading} ${offered.body} ${offered.action?.label}`, /\bBB\b/);
});
