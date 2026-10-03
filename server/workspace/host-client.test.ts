import assert from "node:assert/strict";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { AdoptLessonInput } from "../../host/contract.ts";
import { WorkspaceUnreachableError, WriteConflictError } from "./access.ts";
import { createHostClient } from "./host-client.ts";

/** Just enough of BB for the host client: bb.hosts.experimental_client, whose calls `answer` answers. */
function fakeBb(answer: (method: string, input: unknown, options: unknown) => Promise<unknown>): BbPluginApi {
  return { hosts: { experimental_client: () => ({ call: answer }) } } as unknown as BbPluginApi;
}

const input: AdoptLessonInput = {
  root: "/w/repo",
  lesson: { id: "001", seedSpec: null },
  spec: { entries: [] },
  standIns: null,
  progress: { iteration: "001", examples: {} },
  iteration: { iteration: "001", status: "WIP" },
  progressSha256: null,
};

test("adoptLesson is one call on the workspace's machine, with two minutes to finish", async () => {
  const calls: unknown[] = [];
  const output = { factoryShown: "tetris/.factory", moved: false, note: null, written: ["tetris/.factory/spec/README.md"] };
  const client = createHostClient(
    fakeBb(async (method, sent, options) => {
      calls.push({ method, sent, options });
      return output;
    }),
  );
  assert.deepEqual(await client.adoptLesson("host_1", input), output);
  assert.deepEqual(calls, [{ method: "adoptLesson", sent: input, options: { hostId: "host_1", timeoutMs: 120_000 } }]);
});

test("adoptLesson's conflict is a WriteConflictError, and a machine that is not connected is unreachable", async () => {
  const conflicted = createHostClient(fakeBb(async () => ({ conflict: true })));
  await assert.rejects(conflicted.adoptLesson("host_1", input), WriteConflictError);
  const offline = createHostClient(
    fakeBb(async () => {
      throw Object.assign(new Error("HTTP 502: Host is not connected"), { status: 502, code: "host_unavailable" });
    }),
  );
  await assert.rejects(offline.adoptLesson("host_1", input), WorkspaceUnreachableError);
  const refused = createHostClient(
    fakeBb(async () => {
      throw new Error("Lesson 002 has no feature files, so it cannot be adopted.");
    }),
  );
  await assert.rejects(refused.adoptLesson("host_1", input), /Lesson 002 has no feature files/);
});

test("seedWorkspace is one call on the workspace's machine, with the caller's timeout", async () => {
  const calls: unknown[] = [];
  const output = { written: ["README.md"], same: [], kept: [], complete: true as const };
  const client = createHostClient(
    fakeBb(async (method, sent, options) => {
      calls.push({ method, sent, options });
      return output;
    }),
  );
  const seedInput = { root: "/w/repo", courseId: "tetris", ref: "v1", bundle: { entries: [] } };
  assert.deepEqual(await client.seedWorkspace("host_1", seedInput, { timeoutMs: 120_000 }), output);
  assert.deepEqual(calls, [{ method: "seedWorkspace", sent: seedInput, options: { hostId: "host_1", timeoutMs: 120_000 } }]);
});

test("seedWorkspace's machine that is not connected is unreachable, and the host's refusal otherwise", async () => {
  const offline = createHostClient(
    fakeBb(async () => {
      throw Object.assign(new Error("HTTP 502: Host is not connected"), { status: 502, code: "host_unavailable" });
    }),
  );
  await assert.rejects(
    offline.seedWorkspace("host_1", { root: "/w/repo", courseId: "tetris", ref: "v1", bundle: { entries: [] } }, { timeoutMs: 120_000 }),
    WorkspaceUnreachableError,
  );
  const refused = createHostClient(
    fakeBb(async () => {
      throw new Error("Bundle entry refused: ../x is absolute.");
    }),
  );
  await assert.rejects(
    refused.seedWorkspace("host_1", { root: "/w/repo", courseId: "tetris", ref: "v1", bundle: { entries: [] } }, { timeoutMs: 120_000 }),
    /Bundle entry refused/,
  );
});
