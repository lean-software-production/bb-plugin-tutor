// Scripted provider bridge (Tutor test fixture). Protocol v2, grammar v3.
//
// Every turn replies with one agent message:
//   - every prompt line starting with `::` echoed verbatim (message
//     directives), then every `::` line of a successful tool result, as a
//     coach echoes the cards the tutor tools return; these open the message,
//   - the dynamic tools BB offered at thread/start|resume|fork (names),
//   - the skills BB offered via skills/configure (names), and
//   - the result of calling a tool named in a `CALL <tool> <json>` prompt line
//     (only if that tool was offered; `FORCECALL` skips that check to test
//     that the plugin itself refuses a tool it did not offer).
// thread/fork opens a fresh session at the source's tip, so BB side chats work.
// Each turn is also appended to <dataDir>/turns.ndjson for headless evidence.
import {
  type DynamicTool,
  type PromptInput,
  type ThreadDelta,
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  ZERO_TOKEN_USAGE,
  createBridgeIo,
  decodeToolCallResponsePayload,
  experimental_defineProviderBridge,
  runBridgeRequest,
  skillsConfigureParamsSchema,
  threadResumeParamsSchema,
  threadForkParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  turnStartParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

type JsonRpcId = string | number;
type Out = { jsonrpc: "2.0" } & Record<string, unknown>;
const io = createBridgeIo<Out>();
const nonce = randomUUID().slice(0, 8);
let counter = 0;
let dataDir: string | null = null;
let skillRoots: { id: string; path: string; skills: string[] }[] | null = null;
let skillsConfiguredAt: string | null = null;

interface Session {
  threadId: string;
  providerThreadId: string;
  cwd: string;
  tools: Map<string, DynamicTool>;
  turns: number;
}
const sessions = new Map<string, Session>();
const pending = new Map<string, (r: { content: string; isError: boolean }) => void>();

const notify = (method: string, params: Record<string, unknown>) =>
  io.send({ jsonrpc: "2.0", method, params });
const deltas = (threadId: string, ds: ThreadDelta[]) =>
  notify(THREAD_DELTA_NOTIFICATION_METHOD, { threadId, deltas: ds });

function record(entry: Record<string, unknown>) {
  if (dataDir === null) return;
  try {
    appendFileSync(join(dataDir, "turns.ndjson"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    /* evidence only */
  }
}

/** Text blocks each start a line: a side chat's agent-only seed comes before the student's message. */
function promptText(input: readonly PromptInput[]): string {
  return input
    .filter((i): i is Extract<PromptInput, { type: "text" }> => i.type === "text")
    .map((i) => i.text)
    .join("\n");
}

function openSession(a: {
  threadId: string;
  providerThreadId: string;
  cwd: string;
  dynamicTools?: readonly DynamicTool[];
}): Session {
  const s: Session = {
    threadId: a.threadId,
    providerThreadId: a.providerThreadId,
    cwd: a.cwd,
    tools: new Map((a.dynamicTools ?? []).map((t) => [t.name, t])),
    turns: 0,
  };
  sessions.set(a.threadId, s);
  notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId: a.threadId,
    providerThreadId: a.providerThreadId,
  });
  deltas(a.threadId, [{ kind: "session.reset" }]);
  record({ event: "session", threadId: a.threadId, tools: [...s.tools.keys()] });
  return s;
}

/** Message directives: lines that start with `::`, trimmed. */
function directiveLines(lines: readonly string[]): string[] {
  return lines.filter((l) => /^\s*::[a-z]/.test(l)).map((l) => l.trim());
}

function callTool(s: Session, tool: string, args: unknown): Promise<{ content: string; isError: boolean }> {
  counter += 1;
  const id = `scripted-req-${counter}`;
  const p = new Promise<{ content: string; isError: boolean }>((resolve) => pending.set(id, resolve));
  io.send({
    jsonrpc: "2.0",
    id,
    method: BRIDGE_INBOUND_REQUEST_METHODS.toolCall,
    params: {
      providerThreadId: s.providerThreadId,
      threadId: s.threadId,
      turnId: null,
      callId: `${s.providerThreadId}-call-${counter}`,
      tool,
      arguments: args,
      providerNativeIds: true,
    },
  });
  return p;
}

async function runTurn(s: Session, input: readonly PromptInput[], clientRequestId?: unknown) {
  const prompt = promptText(input);
  s.turns += 1;
  const t = s.turns;
  const head: ThreadDelta[] = [];
  if (clientRequestId !== undefined) head.push({ kind: "input.accepted", clientRequestId } as ThreadDelta);
  head.push({ kind: "turn.open" });
  deltas(s.threadId, head);

  const lines = prompt.split(/\r?\n/);
  const toolReport: string[] = [];
  const echoed: string[] = [];
  for (const line of lines) {
    const m = /^\s*(FORCE)?CALL\s+([A-Za-z0-9_-]+)\s*(\{.*\})?\s*$/.exec(line);
    if (m === null) continue;
    const force = m[1] === "FORCE";
    const name = m[2] ?? "";
    let args: unknown = {};
    try {
      args = m[3] ? JSON.parse(m[3]) : {};
    } catch {
      args = {};
    }
    const offered = s.tools.get(name) ?? (force ? ({ name, description: "", inputSchema: {} } as DynamicTool) : undefined);
    if (offered === undefined) {
      toolReport.push(`- CALL ${name}: NOT OFFERED to this thread (not called)`);
      continue;
    }
    const key = { providerItemId: `${s.providerThreadId}-t${t}-tool-${name}` };
    const pres = offered.presentation === undefined ? {} : { presentation: offered.presentation };
    deltas(s.threadId, [{ kind: "item.open", key, item: { type: "tool", tool: name, server: "bb", args }, ...pres } as ThreadDelta]);
    const r = await callTool(s, name, args);
    deltas(s.threadId, [
      {
        kind: "item.close",
        key,
        status: r.isError ? "failed" : "completed",
        item: { type: "tool", tool: name, server: "bb", args, ...(r.isError ? { error: r.content } : { result: r.content }) },
        ...pres,
      } as ThreadDelta,
    ]);
    if (!r.isError) echoed.push(...directiveLines(r.content.split(/\r?\n/)));
    toolReport.push(`- ${force ? "FORCECALL" : "CALL"} ${name}${s.tools.has(name) ? "" : " (not offered; forced)"}: ${r.isError ? "ERROR" : "ok"} → ${r.content.replace(/\s+/g, " ").slice(0, 400)}`);
  }

  const directives = [...directiveLines(lines), ...echoed];
  const skillNames = skillRoots === null ? null : skillRoots.flatMap((r) => r.skills);
  const text = [
    ...directives.flatMap((d) => [d, ""]),
    `**Scripted provider report** (turn ${t}, thread \`${s.threadId}\`)`,
    "",
    `- dynamic tools offered: ${s.tools.size === 0 ? "(none)" : [...s.tools.keys()].map((n) => `\`${n}\``).join(", ")}`,
    `- skills offered (skills/configure${skillsConfiguredAt ? ` @ ${skillsConfiguredAt}` : ""}): ${skillNames === null ? "(never configured)" : skillNames.length === 0 ? "(none)" : skillNames.map((n) => `\`${n}\``).join(", ")}`,
    ...(toolReport.length === 0 ? [] : ["", "Tool calls:", ...toolReport]),
  ].join("\n");
  record({ event: "turn", threadId: s.threadId, turn: t, tools: [...s.tools.keys()], skills: skillNames, toolReport, directives });

  const key = { providerItemId: `${s.providerThreadId}-t${t}-msg` };
  const pres = { label: { pending: "Reporting", completed: "Reported" }, icon: { glyph: "Zap" } };
  deltas(s.threadId, [
    { kind: "item.open", key, item: { type: "agentMessage", text: "" }, presentation: pres } as ThreadDelta,
    { kind: "item.textDelta", key, channel: "agentMessage", text } as ThreadDelta,
    { kind: "item.textClose", key, channel: "agentMessage", text } as ThreadDelta,
    {
      kind: "usage",
      total: { ...ZERO_TOKEN_USAGE, inputTokens: prompt.length, outputTokens: text.length, totalTokens: prompt.length + text.length },
      last: { ...ZERO_TOKEN_USAGE, inputTokens: prompt.length, outputTokens: text.length, totalTokens: prompt.length + text.length },
      modelContextWindow: 8192,
    } as ThreadDelta,
    { kind: "turn.boundary", status: "completed" },
  ]);
}

function invalid(id: JsonRpcId, method: string, issues: unknown) {
  io.send({ jsonrpc: "2.0", id, error: { code: BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, message: `Invalid params for ${method}`, data: issues } });
}

const handlers: Record<string, (id: JsonRpcId, params: unknown) => void> = {
  [BRIDGE_REQUEST_METHODS.initialize]: (id) => {
    io.sendResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        sessionRestore: true,
        threadArchive: false,
        threadRename: false,
        threadGoalClear: false,
        fork: "tip",
        approvalEnforcedBy: "runtime",
        steerMode: "queue",
        skills: { configure: true },
      },
    });
  },
  [BRIDGE_REQUEST_METHODS.modelList]: (id) => {
    io.sendResult(id, {
      models: [
        {
          id: "scripted-1",
          model: "scripted-1",
          displayName: "Scripted 1",
          description: "Reports what it was offered.",
          supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Default" }],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
    });
  },
  [BRIDGE_REQUEST_METHODS.providerHealth]: (id) => {
    io.sendResult(id, {
      supported: true,
      health: {
        status: "ready",
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
        installedVersion: null,
        minimumSupportedVersion: null,
        canInstall: false,
        canUpdate: false,
        loginCommand: null,
      },
    });
  },
  [BRIDGE_REQUEST_METHODS.skillsConfigure]: (id, params) => {
    const p = skillsConfigureParamsSchema.safeParse(params);
    if (!p.success) return invalid(id, "skills/configure", p.error.issues);
    skillRoots = p.data.roots.map((r) => ({ id: r.id, path: r.path, skills: r.skills.map((s) => s.name) }));
    skillsConfiguredAt = new Date().toISOString();
    record({ event: "skills/configure", roots: skillRoots, raw: params });
    io.sendResult(id, {});
  },
  [BRIDGE_REQUEST_METHODS.threadStart]: (id, params) => {
    const p = threadStartParamsSchema.safeParse(params);
    if (!p.success) return invalid(id, "thread/start", p.error.issues);
    counter += 1;
    const providerThreadId = `scripted_${nonce}_${counter}`;
    const s = openSession({
      threadId: p.data.threadId,
      providerThreadId,
      cwd: p.data.cwd,
      dynamicTools: p.data.dynamicTools,
    });
    io.sendResult(id, { providerThreadId, sessionRestorable: true });
    if (p.data.input !== undefined && p.data.input.length > 0) void runTurn(s, p.data.input);
  },
  [BRIDGE_REQUEST_METHODS.threadResume]: (id, params) => {
    const p = threadResumeParamsSchema.safeParse(params);
    if (!p.success) return invalid(id, "thread/resume", p.error.issues);
    openSession({
      threadId: p.data.threadId,
      providerThreadId: p.data.providerThreadId,
      cwd: p.data.cwd,
      dynamicTools: p.data.dynamicTools,
    });
    io.sendResult(id, { providerThreadId: p.data.providerThreadId, sessionRestorable: true });
  },
  // A fork (a BB side chat) starts a fresh session: the script has no history to copy.
  [BRIDGE_REQUEST_METHODS.threadFork]: (id, params) => {
    const p = threadForkParamsSchema.safeParse(params);
    if (!p.success) return invalid(id, "thread/fork", p.error.issues);
    counter += 1;
    const providerThreadId = `scripted_${nonce}_${counter}`;
    openSession({
      threadId: p.data.threadId,
      providerThreadId,
      cwd: p.data.cwd,
      dynamicTools: p.data.dynamicTools,
    });
    record({ event: "fork", threadId: p.data.threadId, source: p.data.sourceProviderThreadId });
    io.sendResult(id, { providerThreadId, sessionRestorable: true });
  },
  [BRIDGE_REQUEST_METHODS.turnStart]: (id, params) => {
    const p = turnStartParamsSchema.safeParse(params);
    if (!p.success) return invalid(id, "turn/start", p.error.issues);
    const s = sessions.get(p.data.threadId);
    if (s === undefined) {
      io.sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, `No session for thread ${p.data.threadId}`);
      return;
    }
    io.sendResult(id, {});
    void runTurn(s, p.data.input, p.data.clientRequestId);
  },
  [BRIDGE_REQUEST_METHODS.threadStop]: (id, params) => {
    const p = threadStopParamsSchema.safeParse(params);
    if (!p.success) return invalid(id, "thread/stop", p.error.issues);
    sessions.delete(p.data.threadId);
    io.sendResult(id, {});
  },
};

function handleResponse(message: { id?: unknown; result?: unknown; error?: unknown }) {
  if (typeof message.id !== "string") return;
  const resolve = pending.get(message.id);
  if (resolve === undefined) return;
  pending.delete(message.id);
  if (message.error !== undefined) {
    const msg = (message.error as { message?: unknown }).message;
    resolve({ content: typeof msg === "string" ? msg : "tool call failed", isError: true });
    return;
  }
  const d = decodeToolCallResponsePayload(message.result);
  resolve({ content: d.content, isError: d.isError });
}

export function handleLine(line: string): void {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) return;
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof method !== "string") return handleResponse(message as { id?: unknown });
  if (typeof id !== "string" && typeof id !== "number") return;
  const handler = handlers[method];
  if (handler === undefined) {
    io.sendError(id, BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
    return;
  }
  runBridgeRequest({ request: { id, method, params }, sendError: io.sendError, handleRequest: async (r) => handler(r.id, r.params) });
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  start(context) {
    dataDir = context.dataDir;
    record({ event: "bridge-start", pluginId: context.pluginId });
  },
});
