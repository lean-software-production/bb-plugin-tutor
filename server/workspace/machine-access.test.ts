import assert from "node:assert/strict";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { WorkspaceUnreachableError, WriteConflictError } from "./access.ts";
import type { TutorHostClient } from "./host-client.ts";
import { createMachineAccess } from "./machine-access.ts";

type Files = BbPluginApi["sdk"]["files"];

/** Just enough of BB for machine access: sdk.files, with the methods a test gives. */
function fakeBbWithFiles(files: Partial<{ [K in "read" | "write" | "remove"]: (args: Parameters<Files[K]>[0]) => Promise<unknown> }>): BbPluginApi {
  const missing = (name: string) => async () => assert.fail(`sdk.files.${name} was not expected`);
  return {
    sdk: { files: { read: files.read ?? missing("read"), write: files.write ?? missing("write"), remove: files.remove ?? missing("remove") } },
  } as unknown as BbPluginApi;
}

function fakeHostClient(inspect: TutorHostClient["inspect"] = async () => assert.fail("inspect was not expected")): TutorHostClient {
  return { inspect };
}

/** An error shaped like the SDK's BbHttpError. */
function bbError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(`HTTP ${status}: ${message}`), { status, code, body: { code, message } });
}

test("read decodes sdk.files, write passes expectedSha256, and a conflict is a WriteConflictError", async () => {
  const calls: unknown[] = [];
  const bb = fakeBbWithFiles({
    read: async () => ({ path: "/w/p", content: Buffer.from("hi").toString("base64"), contentEncoding: "base64", sha256: "abc", sizeBytes: 2 }),
    write: async (args) => {
      calls.push(args);
      return { outcome: "conflict", currentSha256: "def" };
    },
  });
  const access = createMachineAccess(bb, fakeHostClient(), "host_1");
  assert.deepEqual(await access.read("/w/p"), { text: "hi", sha256: "abc" });
  await assert.rejects(access.write("/w/p", "new", "abc"), WriteConflictError);
  assert.equal((calls[0] as { expectedSha256: string }).expectedSha256, "abc");
});

test("a utf8 read is its content; a write goes to the machine as utf8, creating its folders", async () => {
  const calls: Record<string, unknown>[] = [];
  const bb = fakeBbWithFiles({
    read: async () => ({ path: "/w/p", content: "héllo", contentEncoding: "utf8", sha256: "abc", sizeBytes: 6 }),
    write: async (args) => {
      calls.push(args as unknown as Record<string, unknown>);
      return { outcome: "written", sha256: "x", sizeBytes: 3 };
    },
  });
  const access = createMachineAccess(bb, fakeHostClient(), "host_1");
  assert.deepEqual(await access.read("/w/p"), { text: "héllo", sha256: "abc" });
  await access.write("/w/new", "new", null);
  await access.write("/w/any", "any");
  assert.deepEqual(calls[0], { hostId: "host_1", path: "/w/new", content: "new", contentEncoding: "utf8", createParents: true, expectedSha256: null });
  assert.deepEqual(calls[1], { hostId: "host_1", path: "/w/any", content: "any", contentEncoding: "utf8", createParents: true });
});

test("a file the machine doesn't have reads as null, and removing it is fine", async () => {
  const removed: unknown[] = [];
  const bb = fakeBbWithFiles({
    read: async () => {
      throw bbError(404, "ENOENT", "Path does not exist: /w/p");
    },
    remove: async (args) => {
      removed.push(args);
      throw bbError(404, "ENOENT", "Path does not exist: /w/p");
    },
  });
  const access = createMachineAccess(bb, fakeHostClient(), "host_1");
  assert.equal(await access.read("/w/p"), null);
  await access.remove("/w/p");
  assert.deepEqual(removed, [{ hostId: "host_1", path: "/w/p" }]);
});

test("a host that is offline makes reads fail as unreachable, not missing", async () => {
  // BB 0.44.0 answers a call to a machine that is not connected with HTTP 502, code host_unavailable.
  const bb = fakeBbWithFiles({
    read: async () => {
      throw bbError(502, "host_unavailable", "Host is not connected");
    },
    write: async () => {
      throw bbError(502, "host_unavailable", "Host is not connected");
    },
  });
  const access = createMachineAccess(bb, fakeHostClient(), "host_1");
  await assert.rejects(access.read("/w/p"), WorkspaceUnreachableError);
  await assert.rejects(access.write("/w/p", "x", null), WorkspaceUnreachableError);
});

test("kinds and real paths come from the host entry's inspect; an offline host is unreachable", async () => {
  const asked: unknown[] = [];
  const access = createMachineAccess(
    fakeBbWithFiles({}),
    fakeHostClient(async (hostId, input) => {
      asked.push({ hostId, input });
      return { kinds: Object.fromEntries(input.paths.map((path) => [path, "folder" as const])), realPaths: Object.fromEntries(input.realPaths.map((path) => [path, `/real${path}`])) };
    }),
    "host_1",
  );
  assert.deepEqual(await access.kinds(["/w", "/w/spec"]), { "/w": "folder", "/w/spec": "folder" });
  assert.equal(await access.realPath("/w"), "/real/w");
  assert.deepEqual(asked, [
    { hostId: "host_1", input: { paths: ["/w", "/w/spec"], realPaths: [] } },
    { hostId: "host_1", input: { paths: [], realPaths: ["/w"] } },
  ]);

  const offline = createMachineAccess(
    fakeBbWithFiles({}),
    fakeHostClient(async () => {
      throw bbError(502, "host_unavailable", "Host is not connected");
    }),
    "host_1",
  );
  await assert.rejects(offline.kinds(["/w"]), WorkspaceUnreachableError);
  await assert.rejects(offline.realPath("/w"), WorkspaceUnreachableError);
});

test("other errors pass through as they are", async () => {
  const bb = fakeBbWithFiles({
    read: async () => {
      throw bbError(400, "invalid_path", "Path is a directory, not a file");
    },
  });
  await assert.rejects(createMachineAccess(bb, fakeHostClient(), "host_1").read("/w"), /directory/);
});
