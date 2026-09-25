// App-wide activity reporting, mounted as a content script: BB mounts content
// scripts once per window for as long as the plugin's frontend is active,
// whichever sidebar, navigation or page is showing, which no slot guarantees.
// The decisions live in model/heartbeat.ts.
import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { STUDENT_INPUT_EVENTS, createHeartbeatTracker } from "./model/heartbeat.ts";

const TICK_MS = 15_000;

/**
 * POSTs the `heartbeat` RPC directly: content scripts have no React context
 * for useRpc. This is the route BB documents for `useRpc().call`.
 */
function sendHeartbeat(pluginId: string, signal: AbortSignal): void {
  void fetch(`/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
    signal,
  }).catch(() => undefined);
}

export function mountActivityReporter(context: PluginContentScriptContext): () => void {
  const { signal } = context;
  const tracker = createHeartbeatTracker({
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    send: () => sendHeartbeat(context.pluginId, signal),
  });
  const interacted = () => tracker.interacted();
  const options = { capture: true, passive: true, signal };
  for (const type of STUDENT_INPUT_EVENTS) window.addEventListener(type, interacted, options);
  // Not capturing: only the window's own focus, when the student comes back to the tab.
  window.addEventListener("focus", interacted, { signal });
  document.addEventListener("visibilitychange", () => tracker.tick(), { signal });
  const timer = window.setInterval(() => tracker.tick(), TICK_MS);
  return () => window.clearInterval(timer);
}
