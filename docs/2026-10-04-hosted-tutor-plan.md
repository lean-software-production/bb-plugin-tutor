# Hosted Tutor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each pilot instructor opens their own hosted Tutor server in a browser and is coached in their Codespace of `capstone-project-starter`. Each Codespace reaches its server through Cloudflare Access.

**Architecture:**
- **Server:** one bb-server per student on `ew-lsp-001`, provisioned by the infrastructure repo's `ew_bb` role and a new Cloudflare playbook.
- **Machine:** the student's Codespace, through the `bb` devcontainer feature's `machine` mode (already drafted).
- **Plugin:** a hosted first run that creates the workspace's project; explanations for missing agents, failed coach turns and a sleeping Codespace; one batched host call per page load.
- **Retired:** the all-on-the-laptop launcher.

**Tech Stack:** TypeScript plugin (node `--test`, `@get-bb/plugin-sdk` 0.6.15, bb-app 0.45.0); Bash (devcontainer feature, e2e harness); Ansible + shellspec (infrastructure); Cloudflare API.

**Spec:** [docs/2026-10-04-hosted-tutor.md](2026-10-04-hosted-tutor.md). Evidence is in [Spike 2](2026-10-03-hosted-tutor-spike.md) and [Spike 3](2026-10-04-cloudflare-machine-spike.md).

**Repos:**
- this one (`bb-plugin-tutor`);
- `../devcontainer-features` (branch `bb/machine-mode`, commit `7d886c2`);
- `../capstone-project-starter`;
- `../infrastructure`.

Each task names its repo. Every repo works on a branch; nothing is pushed or published without the operator's go-ahead.

## Global Constraints

- **Pins:** bb-app **0.45.0** and `@get-bb/plugin-sdk` **0.6.15** together. Every student server, and the starter's `bb` feature `version`, use the same bb-app version.
- **Hostname:** `https://<student>-tutor.leansoftware.ai` per student, used by both the browser and the machine.
- **`BB_APP_URL=https://<student>-tutor.leansoftware.ai`** on every student server. Without it, bb 0.45 answers `403 forbidden_host`.
- **Access:** each student's Access app has two policies, the reusable "lean-software-production GitHub org" policy and a Service Auth policy for that student's service token. The Access app always exists before its ingress rule goes live.
- **Codespaces secrets names:** `BB_MACHINE_SERVER_URL`, `BB_MACHINE_ACCESS_CLIENT_ID`, `BB_MACHINE_ACCESS_CLIENT_SECRET`.
- **Secrets:** a service token or enroll key never appears in an argv, a log, stdout, a commit or a chat message.
- **The coach:** with no `coachProvider` setting, the first of `claude-code`, `codex`, `pi` that is `ready` on the workspace's machine (built, `e39cf35`).
- **The workspace:** `/workspaces/capstone-project-starter` in the student's Codespace.
- **Student-facing text never says "BB"** (Tutor's pages, messages and settings descriptions).
- **Student server resources:** loopback only (`--server-bind-host 127.0.0.1`), `bbmachines.slice`, `MemoryMax=3G`.

## Review Focus

1. **A student whose Codespace has two checkouts, or who renamed the repo** (`/workspaces/my-capstone`). The offer must not silently pick the wrong folder: Tutor offers the configured folder only when it exists, and otherwise says which folder it looked for (Task 3 test "a missing folder is named, not guessed").
2. **A server with an older machine still enrolled** (a deleted Codespace that still shows as disconnected). The first run must offer the *connected* machine, never a disconnected one (Task 3 test "a disconnected machine is never offered").
3. **The coach is already running when the student signs out of their agent.** Turns then fail mid-lesson, and the failure must reach the student in Tutor's words, not as a silent stop (Task 6 test "a failed turn shows why, in Tutor's words").
4. **A page load during an adoption.** The batched snapshot must never serve a stale read to a write: writes always go to the machine, and a snapshot lives for one load only (Task 8 test "a write after a snapshotted read still checks the live file").
5. **Creating a project twice** (two tabs, or a retry after a timeout). Confirming the offer twice must reuse the project with the same machine and folder, not create a second one (Task 3 test "confirming twice makes one project").

---

## File structure

**bb-plugin-tutor:**

| File | Responsibility |
|---|---|
| `server/rpc/hosted-workspace.ts` (new) | Find the connected student machine; offer its checkout; create or reuse the project |
| `server/coach/agent.ts` (extend) | `coachAgentState`: the ready agent and sign-in commands |
| `server/coach/turn-failures.ts` (new) | Remember a coach thread's last failed turn; clear it on the next good one |
| `server/workspace/snapshot-access.ts` (new) | A `WorkspaceAccess` that serves one load from a single host snapshot |
| `host/snapshot.ts` (new) + `host/contract.ts` | The host entry's `snapshot` method |
| `shared/rpc.ts`, `shared/constants.ts` | Contract entries; new and changed texts |
| `app/model/welcome.ts`, `app/ui/WelcomePage.tsx` | The hosted first run |
| `app/model/outline.ts`, `app/ui/Outline.tsx`, `app/ui/StartPage.tsx` | Agent sign-in and turn-failure notices |
| `e2e/hosted.sh` (new; replaces `standalone/e2e/e2e.sh`), `e2e/scripted-provider/` (moved) | The CI end-to-end |
| `.github/workflows/ci.yaml` | The `e2e` job |
| removed: `standalone/` (launcher, installer, bats, spikes), `scripts/release-standalone.sh` | Retirement |

**devcontainer-features:** `src/bb/*` (machine mode, done), `examples/bb-machine/devcontainer.json` (new), `src/tutor/` (deprecation notice).

**capstone-project-starter:** `.devcontainer/devcontainer.json`, the getting-started guide.

**infrastructure:**

| File | Change |
|---|---|
| `roles/ew_bb/tasks/derive.yml` | `tailnet: false`, `plugin_archives` |
| `roles/ew_bb/tasks/server_proxy.yml` | Skip servers with `tailnet: false` |
| `roles/ew_bb/tasks/plugin_archives.yml` (new) | Install a plugin from a release archive |
| `roles/ew_bb/files/ew-bb-tutor-setup.sh` (new) | Theme and quiet plugins |
| `inventory/group_vars/ew.yml`, `inventory/host_vars/ew-lsp-001.yml` | Student entries |
| `playbooks/tutor-students.yml` (new) | Cloudflare: Access app, policies, service token, CNAME, the anonymous-302 check |
| `docs/tutor-students.md` (new) | The operator's add and remove procedure |
| `spec/` | Render and fixture tests |

## Decisions made in this plan

1. **A student is an `ew_bb` server, not a new role.** PR #29 already gives each server its own user, uid, port, `app_url` and unit. The plan adds only two server options:
   - `tailnet: false`, because students don't need the proxy;
   - `plugin_archives`, because the role installs only official-catalog plugins and Tutor ships as a built archive.
2. **The first run offers one folder,** the `workspaceFolder` setting (default `/workspaces/capstone-project-starter`). It does not scan `/workspaces`: the host entry only stats exact paths, and one predictable folder is easier to explain than a guess.
3. **Batching learns its paths.** `SnapshotAccess` records every path a load asks the machine about, and the next load fetches them all in one `snapshot` host call. Paths it hasn't seen before still go to the machine. That keeps layout and coach-file code unchanged; hand-listing the paths would duplicate their logic and drift.
4. **Turn failures come from `bb.events` `thread.failed`.** The plugin already subscribes to it for the dispatch guard. The failure text is the event's error message when it has one.
5. **`WORKSPACE_UNREACHABLE_TEXT` becomes Codespace wording for everyone.** The Codespace is the only machine in this design. A laptop machine (out of scope) will need its own wording when it comes.
6. **The CI end-to-end skips Cloudflare.** One runner runs bb-server as a second Linux user and the machine as the runner user, over loopback. Access is checked by hand against a provisioned student (Task 13).
7. **The Cloudflare playbook writes the service token's secret to a 0600 file on the operator's computer** and nowhere else. The operator pastes it into the instructor's message, then deletes the file. Cloudflare shows a token's secret only once.
8. **The reusable policy's id goes in `group_vars/ew.yml` as `cf_access_github_org_policy_id`.** It's recorded nowhere today; the operator looks it up once (Task 12, step 1).

---

## Phase A — the student's side

### Task 1: Land the `bb` feature's machine mode (devcontainer-features)

**Files:**
- Create: `examples/bb-machine/devcontainer.json`
- Modify: `README.md` (the `bb` section), `src/bb/README.md` (options table)
- Test: `test/bb/machine.sh` (exists), `test/bb/scenarios.json` (exists)

**Interfaces:**
- Produces: `ghcr.io/lean-software-production/devcontainer-features/bb:1` 1.1.0 with `mode: "machine"`, reading `BB_MACHINE_SERVER_URL`, `BB_MACHINE_ACCESS_CLIENT_ID` and `BB_MACHINE_ACCESS_CLIENT_SECRET`.

- [ ] **Step 1: Check out the branch and run the bb scenarios**

```bash
cd ../devcontainer-features && git switch bb/machine-mode
devcontainer features test -f bb --skip-autogenerated --skip-duplicated .
```
Expected: `✅ Passed: 'standalone'`, `'custom_origin'`, `'machine'`.

- [ ] **Step 2: Add the example**

`examples/bb-machine/devcontainer.json`:
```jsonc
{
  "name": "A BB machine of a hosted BB server",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:5-24-trixie",
  "remoteUser": "node",
  "features": {
    "ghcr.io/lean-software-production/devcontainer-features/bb:1": {
      "version": "0.45.0",
      "mode": "machine",
      "autoStart": true
    }
  }
  // Set Codespaces secrets BB_MACHINE_SERVER_URL, BB_MACHINE_ACCESS_CLIENT_ID and
  // BB_MACHINE_ACCESS_CLIENT_SECRET for the repository; see src/bb/NOTES.md, "Machine mode".
}
```

- [ ] **Step 3: Add the `serverUrl` option row to `src/bb/README.md`'s options table, and fix the `mode` row**

Add the `serverUrl` row:
```
| serverUrl | Machine mode: the hosted BB server's https origin. Empty reads BB_MACHINE_SERVER_URL from the environment (for example a Codespaces secret), so one devcontainer.json serves every learner. | string | - |
```
Replace the `mode` row's description with the one in `devcontainer-feature.json`.

- [ ] **Step 4: Add a "Machine mode" paragraph to the top-level `README.md`'s `bb` section,** pointing at `src/bb/NOTES.md#machine-mode` and the example.

- [ ] **Step 5: Re-run the machine scenario**

Run: `devcontainer features test -f bb --skip-autogenerated --filter machine .`
Expected: 8 checks `✅`, then `✅ Passed: 'machine'`.

- [ ] **Step 6: Commit, then ask the operator to push and open the PR**

```bash
git add examples/bb-machine README.md src/bb/README.md
git commit -m "bb: example and docs for machine mode"
```
Publishing happens on merge (`.github/workflows` release job) as `bb` 1.1.0. Wait until `ghcr.io/lean-software-production/devcontainer-features/bb:1.1.0` resolves (`devcontainer features info manifest ghcr.io/lean-software-production/devcontainer-features/bb:1`) before Task 2's step 3.

### Task 2: The starter's devcontainer and guide (capstone-project-starter)

**Files:**
- Modify: `.devcontainer/devcontainer.json`
- Modify: the getting-started guide (the file `main`'s last commits edit, "Sign in the Codex extension and Pi in the getting-started guide": find it with `git log -3 --name-only origin/main`)

**Interfaces:**
- Consumes: Task 1's feature.
- Produces: a Codespace that connects to `$BB_MACHINE_SERVER_URL` on start, with workspace `/workspaces/capstone-project-starter`.

- [ ] **Step 1: Branch from `origin/main`**

```bash
cd ../capstone-project-starter && git fetch && git switch -c tutor/hosted-machine origin/main
```

- [ ] **Step 2: Add the feature, after the agent features so they are installed first**

In `.devcontainer/devcontainer.json`, `features`:
```jsonc
"ghcr.io/lean-software-production/devcontainer-features/bb:1": {
  "version": "0.45.0",
  "mode": "machine",
  "autoStart": true
}
```

- [ ] **Step 3: Test it locally against `student-001`** (the spike server, or the one Task 13 provisions)

Write the secrets file from the operator's token without printing it:
```bash
( set -a; . ~/.tutor-spike2/cf-access.env; set +a; umask 077
  node -e 'process.stdout.write(JSON.stringify({BB_MACHINE_SERVER_URL:"https://student-001-tutor.leansoftware.ai",BB_MACHINE_ACCESS_CLIENT_ID:process.env.CF_ACCESS_CLIENT_ID,BB_MACHINE_ACCESS_CLIENT_SECRET:process.env.CF_ACCESS_CLIENT_SECRET}))' > /tmp/starter-secrets.json )
devcontainer up --workspace-folder . --secrets-file /tmp/starter-secrets.json | grep -E "BB machine|outcome"
rm -f /tmp/starter-secrets.json
```
Expected: `BB machine is connected to ********.` and `"outcome":"success"`.

- [ ] **Step 4: Add the guide's "Connect to your Tutor" section, before its sign-in steps**

Content:
1. Your operator sends you a link and three values.
2. In GitHub → Settings → Codespaces → Secrets, add `BB_MACHINE_SERVER_URL`, `BB_MACHINE_ACCESS_CLIENT_ID` and `BB_MACHINE_ACCESS_CLIENT_SECRET`, each available to `capstone-project-starter`.
3. Create (or rebuild) your Codespace.
4. In its terminal, sign in to Claude Code (`claude`), or to Codex (`codex`) or pi (`pi`, then `/login`).
5. Open your link and sign in with GitHub.

The guide must not mention BB.

- [ ] **Step 5: Commit, then ask the operator to push and open the PR**

```bash
git add .devcontainer/devcontainer.json <guide file>
git commit -m "Connect the Codespace to the student's hosted Tutor (bb feature, machine mode)"
```

---

## Phase B — the plugin (bb-plugin-tutor)

Work on a branch: `git switch -c hosted/plugin`. Run `npx tsc -p . --noEmit` and `npm test` before each commit.

### Task 3: The hosted first run, server side

**Files:**
- Create: `server/rpc/hosted-workspace.ts`
- Modify: `server/rpc/handlers.ts` (register two handlers), `shared/rpc.ts` (contract), `server/coach/settings.ts` (the `workspaceFolder` setting), `shared/constants.ts` (`SETTING_KEYS.workspaceFolder`, `DEFAULT_WORKSPACE_FOLDER`)
- Modify: `test/helpers/fake-bb.ts` (options `hosts` and `projects`)
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `rt.access(hostId)` (a `WorkspaceAccess`, `server/workspace/access.ts`); `bb.sdk.hosts.list()` returns `Host[]` with `id`, `name`, `status: "connected"|"disconnected"` and `machineProviderId: string|null`; `bb.sdk.projects.list()` and `bb.sdk.projects.create({ name, source: { hostId, path, type: "local_path" } })`; the existing `confirmWorkspace` handler body.
- Produces:
  - RPC `offerWorkspace`, input `null`, output `{ status: "no-machine" } | { status: "no-folder", folder: string, machineName: string } | { status: "offer", hostId: string, machineName: string, folder: string }`;
  - RPC `createWorkspace`, input `{ hostId: string, folder: string }`, output `workspaceSchema`;
  - `offerHostedWorkspace(sdk, access, folder)` and `findOrCreateProject(sdk, hostId, folder)` in `server/rpc/hosted-workspace.ts`.

- [ ] **Step 1: Extend the fake BB**

In `test/helpers/fake-bb.ts`, add two options to `makeTutorHost`:
```ts
/** Hosts sdk.hosts.list returns; the server's own host unless given. */
hosts?: Array<{ id: string; name?: string; status: "connected" | "disconnected"; machineProviderId: string | null }>;
/** When true, sdk.projects.list starts empty and sdk.projects.create adds to it. */
noProjectYet?: boolean;
```
Then change:
- `hosts.list` to return `options.hosts.map((h) => makeHostResponse({ id: h.id, name: h.name ?? h.id, status: h.status, machineProviderId: h.machineProviderId }))` when `options.hosts` is given;
- `hosts.get` to look up `options.hosts` by id (falling back to today's behaviour).

Keep a `projects: ProjectResponse[]` array, seeded with today's single project unless `noProjectYet`:
- `projects.list` returns it;
- `projects.get` finds by id, else `throw new Error("HTTP 404: project <id> not found")`;
- `projects.create` pushes `{ id: \`proj_${projects.length + 1}\`, name, kind: "standard", sources: [{ id: "src_x", projectId, hostId: source.hostId, type: "local_path", path: source.path, isDefault: true, createdAt: 1, updatedAt: 1 }], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 }` and returns it.

- [ ] **Step 2: Write the failing tests** (in `test/server.test.ts`, after the existing first-run tests)

```ts
// The hosted first run: the student's Codespace is their server's machine, and
// Tutor offers its checkout and creates the project.

async function hostedSetup(t: TestContext, hosts: Parameters<typeof makeTutorHost>[3] extends infer O ? O extends { hosts?: infer H } ? H : never : never, folderExists = true) {
  const ws = await emptyGitWorkspace();
  const folder = folderExists ? ws : join(ws, "not-there");
  const host = await makeTutorHost(null, ws, { workspaceFolder: folder }, { hosts, noProjectYet: true });
  t.after(async () => { await host.harness.lifecycle.dispose(); await rm(ws, { recursive: true, force: true }); });
  return { host, folder };
}

test("with no connected machine yet, the first run says to open the Codespace", async (t) => {
  const { host } = await hostedSetup(t, [{ id: "host_server", status: "connected", machineProviderId: null }]);
  assert.deepEqual(await host.harness.behavior.callRpc("offerWorkspace", null), { status: "no-machine" });
});

test("a disconnected machine is never offered", async (t) => {
  const { host } = await hostedSetup(t, [{ id: "host_old", name: "old-codespace", status: "disconnected", machineProviderId: "manual" }]);
  assert.deepEqual(await host.harness.behavior.callRpc("offerWorkspace", null), { status: "no-machine" });
});

test("the connected machine's checkout is offered, by name", async (t) => {
  const { host, folder } = await hostedSetup(t, [
    { id: "host_old", name: "old-codespace", status: "disconnected", machineProviderId: "manual" },
    { id: "host_cs", name: "my-codespace", status: "connected", machineProviderId: "manual" },
  ]);
  assert.deepEqual(await host.harness.behavior.callRpc("offerWorkspace", null), { status: "offer", hostId: "host_cs", machineName: "my-codespace", folder });
});

test("a missing folder is named, not guessed", async (t) => {
  const { host, folder } = await hostedSetup(t, [{ id: "host_cs", name: "my-codespace", status: "connected", machineProviderId: "manual" }], false);
  assert.deepEqual(await host.harness.behavior.callRpc("offerWorkspace", null), { status: "no-folder", folder, machineName: "my-codespace" });
});

test("createWorkspace creates the project on that machine and makes it the workspace", async (t) => {
  const { host, folder } = await hostedSetup(t, [{ id: "host_cs", status: "connected", machineProviderId: "manual" }]);
  const workspace = (await host.harness.behavior.callRpc("createWorkspace", { hostId: "host_cs", folder })) as { status: string; root: string };
  assert.equal(workspace.status, "found");
  assert.equal(workspace.root, folder);
  const [args] = host.harness.inspection.sdk.callsTo("projects.create")[0] as [Record<string, unknown>];
  assert.deepEqual(args.source, { hostId: "host_cs", path: folder, type: "local_path" });
});

test("confirming twice makes one project", async (t) => {
  const { host, folder } = await hostedSetup(t, [{ id: "host_cs", status: "connected", machineProviderId: "manual" }]);
  await host.harness.behavior.callRpc("createWorkspace", { hostId: "host_cs", folder });
  await host.harness.behavior.callRpc("createWorkspace", { hostId: "host_cs", folder });
  assert.equal(host.harness.inspection.sdk.callsTo("projects.create").length, 1);
});

test("createWorkspace refuses a machine that isn't connected", async (t) => {
  const { host, folder } = await hostedSetup(t, [{ id: "host_old", status: "disconnected", machineProviderId: "manual" }]);
  await assert.rejects(host.harness.behavior.callRpc("createWorkspace", { hostId: "host_old", folder }), /Codespace is asleep or stopped/);
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test --test-name-pattern="first run says|never offered|checkout is offered|named, not guessed|createWorkspace|confirming twice" test/server.test.ts`
Expected: FAIL (`offerWorkspace` is not a registered method).

- [ ] **Step 4: Add the setting and constants**

In `shared/constants.ts`, add `workspaceFolder: "workspaceFolder"` to `SETTING_KEYS`, and:
```ts
/** Where the student's Codespace checks out the starter: the workspace Tutor offers on first run. */
export const DEFAULT_WORKSPACE_FOLDER = "/workspaces/capstone-project-starter";
```

In `server/coach/settings.ts`, add to the descriptors:
```ts
[SETTING_KEYS.workspaceFolder]: {
  type: "string",
  label: "Workspace folder",
  description: "The folder on your Codespace that Tutor offers as your workspace the first time. Leave empty for /workspaces/capstone-project-starter.",
},
```
Read it in `world.ts` where the other values are read, as `workspaceFolder: values.workspaceFolder || DEFAULT_WORKSPACE_FOLDER`, and add `workspaceFolder: string` to `World`.

- [ ] **Step 5: Write `server/rpc/hosted-workspace.ts`**

```ts
// The hosted first run: the student's own machine (their Codespace) holds the
// workspace. Tutor offers that machine's checkout and, once the student
// confirms, creates the BB project for it (the only way a hosted student gets one).
import type { Sdk } from "../coach/threads.ts";
import type { WorkspaceAccess } from "../workspace/access.ts";

export type WorkspaceOffer =
  | { status: "no-machine" }
  | { status: "no-folder"; folder: string; machineName: string }
  | { status: "offer"; hostId: string; machineName: string; folder: string };

/** The student's machine: a connected, enrolled machine (never the server's own host). The newest wins. */
export async function studentMachine(sdk: Sdk): Promise<{ id: string; name: string } | null> {
  const hosts = await sdk.hosts.list();
  const enrolled = hosts.filter((h) => h.machineProviderId !== null && h.status === "connected");
  enrolled.sort((a, b) => b.createdAt - a.createdAt);
  const host = enrolled[0];
  return host === undefined ? null : { id: host.id, name: host.name };
}

export async function offerHostedWorkspace(sdk: Sdk, access: (hostId: string) => WorkspaceAccess, folder: string): Promise<WorkspaceOffer> {
  const machine = await studentMachine(sdk);
  if (machine === null) return { status: "no-machine" };
  const kinds = await access(machine.id).kinds([folder]);
  if (kinds[folder] !== "folder") return { status: "no-folder", folder, machineName: machine.name };
  return { status: "offer", hostId: machine.id, machineName: machine.name, folder };
}

/** The project whose default source is `folder` on `hostId`, created when there is none. */
export async function findOrCreateProject(sdk: Sdk, hostId: string, folder: string): Promise<string> {
  const projects = await sdk.projects.list({ includePersonal: false });
  const existing = projects.find((p) => p.kind === "standard" && p.sources.some((s) => s.isDefault && s.hostId === hostId && s.path === folder));
  if (existing !== undefined) return existing.id;
  const name = folder.split("/").filter(Boolean).pop() ?? "workspace";
  const created = await sdk.projects.create({ name, source: { hostId, path: folder, type: "local_path" } });
  return created.id;
}
```
`kinds` on an offline machine throws `WorkspaceUnreachableError`; let it propagate.

- [ ] **Step 6: Register the handlers and the contract**

In `shared/rpc.ts`, beside `confirmWorkspace`:
```ts
offerWorkspace: {
  input: z.null(),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("no-machine") }),
    z.object({ status: z.literal("no-folder"), folder: z.string(), machineName: z.string() }),
    z.object({ status: z.literal("offer"), hostId: z.string(), machineName: z.string(), folder: z.string() }),
  ]),
},
createWorkspace: {
  input: z.object({ hostId: z.string().min(1).max(128), folder: z.string().startsWith("/").max(4096) }),
  output: workspaceSchema,
},
```
In `server/rpc/handlers.ts`, factor `confirmWorkspace`'s body (lines 282–297: resolve, the overlap check, `rt.settings.experimental_set({ workspaceProject })`) into `async function confirmProject(projectId: string)`, and add:
```ts
offerWorkspace: async () => {
  const world = await rt.world.load();
  return offerHostedWorkspace(bb.sdk, rt.access, world.workspaceFolder);
},
createWorkspace: async ({ hostId, folder }) => {
  const host = await bb.sdk.hosts.get({ hostId });
  if (host.status !== "connected") throw new Error(WORKSPACE_UNREACHABLE_TEXT);
  const projectId = await rt.locks.run(`create-workspace:${hostId}:${folder}`, () => findOrCreateProject(bb.sdk, hostId, folder));
  return confirmProject(projectId);
},
confirmWorkspace: async ({ projectId }) => confirmProject(projectId),
```
(`WORKSPACE_UNREACHABLE_TEXT` changes in Task 7. The test's `/Codespace is asleep or stopped/` passes once both tasks land, so write Task 7's constant change now, in this task, if Task 7 hasn't run yet.)

- [ ] **Step 7: Run the tests, then the suite**

Run the Step 3 command, then `npm test`.
Expected: the 7 new tests PASS; the suite passes.

- [ ] **Step 8: Commit**

```bash
git add server/rpc/hosted-workspace.ts server/rpc/handlers.ts shared/rpc.ts shared/constants.ts server/coach/settings.ts server/coach/world.ts test/helpers/fake-bb.ts test/server.test.ts
git commit -m "Hosted first run: offer the student's Codespace checkout and create its project"
```

### Task 4: The hosted first run, page

**Files:**
- Modify: `app/model/welcome.ts` (`welcomeView`), `app/ui/WelcomePage.tsx`
- Test: `app/model/welcome.test.ts` (create it if absent; otherwise extend)

**Interfaces:**
- Consumes: Task 3's `offerWorkspace` and `createWorkspace` RPCs and their output types (import the types from `shared/rpc.ts` via `z.infer`).
- Produces: `welcomeView(input)` gains `offer: WorkspaceOffer | null`. When `candidates` is empty and `offer` is non-null, the mode is `"hosted"`.

- [ ] **Step 1: Write the failing model tests**

```ts
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
  for (const offer of [{ status: "no-machine" as const }, { status: "no-folder" as const, folder: "/w", machineName: "m" }, { status: "offer" as const, hostId: "h", machineName: "m", folder: "/w" }]) {
    const view = hostedWelcome(offer);
    assert.doesNotMatch(`${view.heading} ${view.body} ${view.action?.label ?? ""}`, /\bBB\b/);
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test app/model/welcome.test.ts`
Expected: FAIL (`hostedWelcome` is not exported).

- [ ] **Step 3: Implement `hostedWelcome` in `app/model/welcome.ts`**

```ts
export interface HostedWelcome {
  heading: string;
  body: string;
  action: { label: string; hostId: string; folder: string } | null;
}

export function hostedWelcome(offer: WorkspaceOffer): HostedWelcome {
  switch (offer.status) {
    case "no-machine":
      return { heading: "Open your Codespace", body: "Open your Codespace of capstone-project-starter. Tutor connects to it by itself; this page updates when it has.", action: null };
    case "no-folder":
      return { heading: "Your workspace folder isn't there", body: `Tutor looked for ${offer.folder} on ${offer.machineName} and didn't find it. Create your Codespace from capstone-project-starter, or set the folder under Settings → Tutor → Workspace folder.`, action: null };
    case "offer":
      return { heading: "Your workspace", body: `Tutor coaches you in ${offer.folder} on your Codespace (${offer.machineName}).`, action: { label: `Use ${offer.folder}`, hostId: offer.hostId, folder: offer.folder } };
  }
}
```

- [ ] **Step 4: Render it in `WelcomePage.tsx`**

When the candidates query returns no projects:
- Query `offerWorkspace` with `useQuery(QUERY_KEYS.offer, () => rpc.call("offerWorkspace", null))`, refetching every 5 s while the status is `no-machine`.
- Render `hostedWelcome(offer)`.
- The button calls `rpc.call("createWorkspace", { hostId, folder })`, then `homeDecision(await rpc.call("getOverview", null))`, as `Picker` does today.

Keep the existing `Picker` for the case with candidates.

- [ ] **Step 5: Run the model tests and the suite; typecheck**

Run: `node ... --test app/model/welcome.test.ts && npm test && npx tsc -p . --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/model/welcome.ts app/model/welcome.test.ts app/ui/WelcomePage.tsx shared/constants.ts
git commit -m "Hosted first run page: open your Codespace, then use its checkout"
```

### Task 5: The coach's agent, explained

**Files:**
- Modify: `server/coach/agent.ts`, `server/rpc/views.ts` (`buildOverview`), `server/rpc/handlers.ts` (`getOverview`), `shared/rpc.ts` (`overviewSchema` gains `coachAgent`)
- Modify: `app/model/outline.ts`, `app/ui/Outline.tsx`, `app/ui/StartPage.tsx`
- Test: `test/server.test.ts`, `app/model/outline.test.ts`

**Interfaces:**
- Consumes: `sdk.system.providerStates({ hostId })` returns `{ providers: Array<{ providerId, displayName, status, loginCommand: string|null }> }`; `COACH_AGENTS`.
- Produces:
  - `coachAgentState(sdk, hostId, log): Promise<CoachAgentState>` with `type CoachAgentState = { ready: string | null; signIn: Array<{ providerId: string; name: string; command: string | null }> }`;
  - `Overview.coachAgent: CoachAgentState | null` (null when `coachProvider` is set, or there is no workspace);
  - `readyCoachAgent` keeps its signature and now calls `coachAgentState`.

- [ ] **Step 1: Write the failing server tests**

```ts
test("the overview says which agent coaches, or how to sign in to one", async (t) => {
  const ready = await agentSetup(t, [{ providerId: "codex", status: "ready" }]);
  const overview = (await ready.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.coachAgent?.ready, "codex");

  const none = await agentSetup(t, [
    { providerId: "claude-code", status: "unauthenticated", loginCommand: "claude" },
    { providerId: "codex", status: "not_installed", loginCommand: null },
    { providerId: "pi", status: "expired", loginCommand: "pi" },
  ]);
  const view = (await none.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(view.coachAgent?.ready, null);
  assert.deepEqual(view.coachAgent?.signIn.map((s) => [s.providerId, s.command]), [["claude-code", "claude"], ["codex", null], ["pi", "pi"]]);
});

test("with a coachProvider setting the overview carries no agent advice", async (t) => {
  const host = await agentSetup(t, [{ providerId: "claude-code", status: "ready" }], { factoryProject: PROJECT_ID, coachProvider: "pi" });
  assert.equal(((await host.harness.behavior.callRpc("getOverview", null)) as Overview).coachAgent, null);
});
```
Extend `fake-bb.ts`'s `providerStates` entries with an optional `loginCommand`.

- [ ] **Step 2: Run them to make sure they fail**

Expected: FAIL (`coachAgent` is undefined).

- [ ] **Step 3: Implement `coachAgentState` in `server/coach/agent.ts`**

```ts
export interface CoachAgentState {
  ready: string | null;
  signIn: Array<{ providerId: string; name: string; command: string | null }>;
}

/** The agent that would coach, and for each of COACH_AGENTS that isn't ready, how to sign in. Null when BB can't say. */
export async function coachAgentState(sdk: Sdk, hostId: string, log: (message: string) => void): Promise<CoachAgentState | null> {
  try {
    const { providers } = await sdk.system.providerStates({ hostId });
    const byId = new Map(providers.map((p) => [p.providerId, p]));
    const ready = COACH_AGENTS.find((agent) => byId.get(agent)?.status === "ready") ?? null;
    const signIn = COACH_AGENTS.filter((agent) => byId.get(agent)?.status !== "ready").map((agent) => ({
      providerId: agent,
      name: byId.get(agent)?.displayName ?? agent,
      command: byId.get(agent)?.loginCommand ?? null,
    }));
    return { ready, signIn };
  } catch (cause) {
    log(`[tutor] couldn't ask which agents are ready on ${hostId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
}

export async function readyCoachAgent(sdk: Sdk, hostId: string, log: (message: string) => void): Promise<string | null> {
  return (await coachAgentState(sdk, hostId, log))?.ready ?? null;
}
```

- [ ] **Step 4: Put it in the overview**

In `getOverview`: when the workspace is found and `world.coachProvider === ""`, set `coachAgent = await coachAgentState(bb.sdk, world.hostId, …)`; otherwise `null`. Pass it to `buildOverview`, and add `coachAgent: z.object({ ready: z.string().nullable(), signIn: z.array(z.object({ providerId: z.string(), name: z.string(), command: z.string().nullable() })) }).nullable()` to the overview schema.

- [ ] **Step 5: Write the failing outline model test, then show it**

In `app/model/outline.test.ts`:
```ts
test("with no agent signed in, the outline says how to sign in, and the coach button waits", () => {
  const view = outlineView(overviewWith({ coachAgent: { ready: null, signIn: [{ providerId: "claude-code", name: "Claude Code", command: "claude" }] } }));
  assert.deepEqual(view.agentNotice, { text: "Sign in to a coding agent in your Codespace's terminal, then come back: Claude Code: run `claude`." });
  assert.equal(view.canStartCoach, false);
});
```
(`overviewWith` is the existing test fixture builder in that file; add `coachAgent` to its defaults as `null`.) Implement `agentNotice` and `canStartCoach` in `outline.ts`:
- **Commands:** join the entries with a command as `"<name>: run \`<command>\`"`, separated by "; ".
- **No commands at all:** "Install and sign in to Claude Code, Codex or pi in your Codespace."

Render `agentNotice` above the lesson list in `Outline.tsx`, and disable the "Start with your coach" button (`Outline.tsx:266–270`) and `StartPage`'s `ToCoach` while `canStartCoach` is false.

- [ ] **Step 6: Run the tests and the suite; typecheck. Commit.**

```bash
git add server/coach/agent.ts server/rpc/views.ts server/rpc/handlers.ts shared/rpc.ts app/model/outline.ts app/model/outline.test.ts app/ui/Outline.tsx app/ui/StartPage.tsx test/server.test.ts test/helpers/fake-bb.ts
git commit -m "Say which agent coaches, or how to sign in to one"
```

### Task 6: A failed coach turn, in Tutor's words

**Files:**
- Create: `server/coach/turn-failures.ts`
- Modify: `server/coach/register.ts` (the `thread.failed` and `thread.idle` handlers), `server/coach/runtime.ts` (add `turnFailures`), `server/rpc/views.ts` (lesson outline entries gain `coachFailure`), `shared/rpc.ts`
- Modify: `app/model/outline.ts`, `app/ui/Outline.tsx`
- Test: `server/coach/turn-failures.test.ts`, `test/server.test.ts`

**Interfaces:**
- Consumes: `bb.events.on("thread.failed", ({ thread, ...rest }) => …)` (`register.ts:79`) and `bb.events.on("thread.idle", …)` (`register.ts:74`). Before writing step 3, read the event's payload type in `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts` (search `"thread.failed"`) and in `bb-plugin-sdk-testing.d.ts` (`makeTurnFailedEvent`), and use its error field.
- Produces: `createTurnFailures(): { record(threadId: string, message: string | null): void; clear(threadId: string): void; get(threadId: string): string | null }`, and `coachFailure: string | null` on each lesson outline entry with a coach thread.

- [ ] **Step 1: Write the failing unit test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnFailures, failureText } from "./turn-failures.ts";

test("a failure is remembered until the thread's next good turn", () => {
  const failures = createTurnFailures();
  failures.record("thr_1", "403: OpenCode's free tier can only be used from within OpenCode");
  assert.equal(failures.get("thr_1"), failureText("403: OpenCode's free tier can only be used from within OpenCode"));
  failures.clear("thr_1");
  assert.equal(failures.get("thr_1"), null);
});

test("failureText puts the provider's message in Tutor's words, with what to do", () => {
  assert.equal(
    failureText("403: OpenCode's free tier can only be used from within OpenCode"),
    "Your coach stopped: its agent said \"403: OpenCode's free tier can only be used from within OpenCode\". Sign in to another agent in your Codespace (Claude Code: `claude`), or choose a model under Settings → Tutor → Coach model.",
  );
  assert.match(failureText(null), /^Your coach stopped\. /);
});
```

- [ ] **Step 2: Run it to make sure it fails, then implement `server/coach/turn-failures.ts`**

```ts
// The last failed turn of each coach thread, so the outline can say why the
// coach stopped. Cleared when the thread next goes idle after a good turn.
export function createTurnFailures() {
  const failures = new Map<string, string | null>();
  return {
    record(threadId: string, message: string | null): void { failures.set(threadId, message); },
    clear(threadId: string): void { failures.delete(threadId); },
    get(threadId: string): string | null { return failures.has(threadId) ? failureText(failures.get(threadId) ?? null) : null; },
  };
}

export function failureText(message: string | null): string {
  const advice = "Sign in to another agent in your Codespace (Claude Code: `claude`), or choose a model under Settings → Tutor → Coach model.";
  return message === null ? `Your coach stopped. ${advice}` : `Your coach stopped: its agent said "${message}". ${advice}`;
}
```
(The map stores the provider's raw message; `get` returns the student-facing text.)

- [ ] **Step 3: Write the failing server test**

```ts
test("a failed turn shows why, in Tutor's words", async (t) => {
  const { host } = await setup(t);
  await openCoach(host, "000");
  const threadId = host.threads[0]!.id;
  await host.harness.behavior.emit("thread.failed", makeTurnFailedEvent({ threadId, message: "403: OpenCode's free tier can only be used from within OpenCode" }));
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  const lesson = overview.courses[0]!.lessons.find((l) => l.id === "000")!;
  assert.match(lesson.coachFailure ?? "", /^Your coach stopped: its agent said "403/);
  await host.harness.behavior.emit("thread.idle", { thread: { id: threadId } });
  assert.equal(((await host.harness.behavior.callRpc("getOverview", null)) as Overview).courses[0]!.lessons.find((l) => l.id === "000")!.coachFailure, null);
});
```
Use the fake host's event emitter (`createFakePluginHost` exposes it as `harness.behavior.emit`; check `bb-plugin-sdk-testing.d.ts` for the exact name) and `makeTurnFailedEvent`'s real parameter names.

- [ ] **Step 4: Wire it**
- In `register.ts`, `thread.failed`: if the thread is one of Tutor's coach threads (`rt.coaches` knows it, or `isTutorCoachThread`), call `rt.turnFailures.record(thread.id, <the event's error message or null>)` and `rt.signals.publish("threads", null)`.
- In `register.ts`, `thread.idle`: call `rt.turnFailures.clear(thread.id)`.
- In `views.ts`, set `coachFailure: coachThread === undefined ? null : turnFailures.get(coachThread.id)`, and add `coachFailure: z.string().nullable()` to the lesson schema.
- In the outline, render `coachFailure` under the lesson as an error line.

- [ ] **Step 5: Run the tests and the suite; typecheck. Commit.**

```bash
git add server/coach/turn-failures.ts server/coach/turn-failures.test.ts server/coach/register.ts server/coach/runtime.ts server/rpc/views.ts shared/rpc.ts app/model/outline.ts app/ui/Outline.tsx test/server.test.ts
git commit -m "Say why the coach stopped when its agent fails a turn"
```

### Task 7: "Your Codespace is asleep"

**Files:**
- Modify: `shared/constants.ts:192`
- Test: every test asserting the old text (`grep -rn "tutor status" test app server --include=*.test.ts`)

- [ ] **Step 1: Write the failing test** (in `test/server.test.ts`, beside "a machine that is not connected makes the workspace unreachable")

```ts
test("an unreachable workspace says the Codespace is asleep, and that Tutor reconnects by itself", async (t) => {
  const sandbox = await makeSandbox();
  const host = await makeTutorHost(sandbox.course, sandbox.factoryRoot, { factoryProject: PROJECT_ID }, { hostStatus: "disconnected" });
  t.after(async () => { await host.harness.lifecycle.dispose(); await sandbox.cleanup(); });
  await assert.rejects(openCoach(host, "000"), /^Error: Your Codespace is asleep or stopped\. Open it and Tutor reconnects by itself\.$/);
});
```

- [ ] **Step 2: Run it to make sure it fails, then change the constant**

```ts
export const WORKSPACE_UNREACHABLE_TEXT = "Your Codespace is asleep or stopped. Open it and Tutor reconnects by itself.";
```

- [ ] **Step 3: Update the tests that matched "Run `tutor status`"** to match the new text. Run `npm test`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "An unreachable workspace: the Codespace is asleep, and Tutor reconnects by itself"
```

### Task 8: One host call per page load

**Files:**
- Create: `host/snapshot.ts`, `host/snapshot.test.ts`, `server/workspace/snapshot-access.ts`, `server/workspace/snapshot-access.test.ts`
- Modify: `host/contract.ts` (add `snapshot`), `host.ts` (the handler), `server/workspace/host-client.ts` (a `snapshot` method), `server/coach/world.ts` (wrap the access once per load)
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `WorkspaceAccess` (`read`, `write`, `remove`, plus `LayoutProbe`'s `kinds(paths)` and `realPath(path)`); `host/inspect.ts`'s `inspect`.
- Produces:
  - host method `snapshot`: input `{ root: string, kinds: string[] (≤256), realPaths: string[] (≤16), files: string[] (≤64) }`; output `{ kinds: Record<string, PathKind>, realPaths: Record<string, string>, files: Record<string, { text: string, sha256: string } | null> }`. Files outside `root`, or whose real path leaves `root`, come back `null`.
  - `createSnapshotAccess(live: WorkspaceAccess, fetch: (want) => Promise<Snapshot>, memory: SnapshotMemory): { access: WorkspaceAccess; prefetch(): Promise<void> }`
  - `createSnapshotMemory()`: what the last load asked for, per `hostId + root`.

- [ ] **Step 1: Write the failing host test** (`host/snapshot.test.ts`)

```ts
test("snapshot returns kinds, real paths and file texts in one call, and nothing outside the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "snap-"));
  await mkdir(join(root, ".tutor"));
  await writeFile(join(root, ".tutor/progress.yaml"), "iteration: \"000\"\n");
  await writeFile(join(tmpdir(), "outside.txt"), "secret");
  await symlink(join(tmpdir(), "outside.txt"), join(root, "escape"));
  const out = await snapshot({ root, kinds: [join(root, ".tutor")], realPaths: [root], files: [join(root, ".tutor/progress.yaml"), join(root, "escape"), "/etc/passwd", join(root, "nope")] });
  assert.equal(out.kinds[join(root, ".tutor")], "folder");
  assert.equal(out.files[join(root, ".tutor/progress.yaml")]?.text, "iteration: \"000\"\n");
  assert.equal(out.files[join(root, "escape")], null);
  assert.equal(out.files["/etc/passwd"], null);
  assert.equal(out.files[join(root, "nope")], null);
});
```

- [ ] **Step 2: Implement `host/snapshot.ts` and the contract entry**

```ts
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { sep } from "node:path";
import { inspect } from "./inspect.ts";

export async function snapshot(input: { root: string; kinds: string[]; realPaths: string[]; files: string[] }) {
  const { kinds, realPaths } = await inspect({ paths: input.kinds, realPaths: input.realPaths });
  const realRoot = await realpath(input.root).catch(() => null);
  const files: Record<string, { text: string; sha256: string } | null> = {};
  for (const path of input.files) {
    files[path] = null;
    if (realRoot === null || !(path === input.root || path.startsWith(input.root + sep))) continue;
    const real = await realpath(path).catch(() => null);
    if (real === null || !(real === realRoot || real.startsWith(realRoot + sep))) continue;
    const buffer = await readFile(real).catch(() => null);
    if (buffer === null) continue;
    files[path] = { text: buffer.toString("utf8"), sha256: createHash("sha256").update(buffer).digest("hex") };
  }
  return { kinds, realPaths, files };
}
```
Add the contract entry to `host/contract.ts` with the schemas from **Produces**, and `snapshot: (input) => snapshot(input)` to `host.ts`'s handlers.

Before relying on sha256 for writes, check that `snapshot`'s sha256 matches what `sdk.files.read` reports. BB's `sdk.files` returns a hex sha256 of the file's bytes. Assert it in `snapshot-access.test.ts` against a disk write.

- [ ] **Step 3: Write the failing access tests** (`server/workspace/snapshot-access.test.ts`)

```ts
test("the second load asks the machine once; misses fall through to the live access", async () => {
  const calls: string[] = [];
  const live = countingAccess(diskAccess, calls);       // records "kinds", "realPath", "read"
  const fetches: unknown[] = [];
  const memory = createSnapshotMemory();
  const load = async () => {
    const { access, prefetch } = createSnapshotAccess(live, async (want) => { fetches.push(want); return snapshotOf(want); }, memory, "host_1", root);
    await prefetch();
    await access.kinds([join(root, ".tutor")]);
    await access.read(join(root, ".tutor/progress.yaml"));
  };
  await load();                                            // learns the paths: live calls, no fetch
  assert.equal(fetches.length, 0);
  calls.length = 0;
  await load();                                            // one fetch, no live calls
  assert.equal(fetches.length, 1);
  assert.deepEqual(calls, []);
});

test("a write after a snapshotted read still checks the live file", async () => {
  // The snapshot holds sha A; the file changes on disk to B; a write expecting A must fail with WriteConflictError.
});
```
Write the second test in full: snapshot the file, change it on disk, then `access.write(path, "x", snapshotSha)`, and assert it rejects with `WriteConflictError`. Writes always go to `live.write`, so the CAS check runs on the machine.

- [ ] **Step 4: Implement `server/workspace/snapshot-access.ts`**

```ts
import type { FileText, WorkspaceAccess } from "./access.ts";
import type { PathKind } from "../../layouts/types.ts";

export interface SnapshotWant { kinds: string[]; realPaths: string[]; files: string[] }
export interface Snapshot { kinds: Record<string, PathKind>; realPaths: Record<string, string>; files: Record<string, FileText | null> }

/** What the last load of each workspace asked the machine, to fetch in one call next time. */
export function createSnapshotMemory() {
  const seen = new Map<string, SnapshotWant>();
  return {
    get: (key: string): SnapshotWant | undefined => seen.get(key),
    set: (key: string, want: SnapshotWant): void => { seen.set(key, want); },
  };
}

export function createSnapshotAccess(live: WorkspaceAccess, fetch: (want: SnapshotWant) => Promise<Snapshot>, memory: ReturnType<typeof createSnapshotMemory>, hostId: string, root: string) {
  const key = `${hostId}\u0000${root}`;
  const asked: SnapshotWant = { kinds: [], realPaths: [], files: [] };
  let snap: Snapshot | null = null;
  const note = (list: string[], path: string) => { if (!list.includes(path)) list.push(path); };
  const access: WorkspaceAccess = {
    async kinds(paths) {
      paths.forEach((p) => note(asked.kinds, p));
      const missing = paths.filter((p) => snap?.kinds[p] === undefined);
      const fetched = missing.length === 0 ? {} : await live.kinds(missing);
      return Object.fromEntries(paths.map((p) => [p, snap?.kinds[p] ?? fetched[p]!]));
    },
    async realPath(path) {
      note(asked.realPaths, path);
      return snap?.realPaths[path] ?? live.realPath(path);
    },
    async read(path) {
      note(asked.files, path);
      if (snap !== null && path in snap.files) return snap.files[path] ?? null;
      return live.read(path);
    },
    write: (path, text, expected) => live.write(path, text, expected),
    remove: (path) => live.remove(path),
  };
  return {
    access,
    async prefetch() {
      const want = memory.get(key);
      if (want !== undefined && (want.kinds.length + want.realPaths.length + want.files.length) > 0) {
        snap = await fetch({ kinds: want.kinds.slice(0, 256), realPaths: want.realPaths.slice(0, 16), files: want.files.slice(0, 64) });
      }
    },
    /** Call when the load ends: what it asked becomes the next load's prefetch. */
    remember() { memory.set(key, asked); },
  };
}
```
Update the test calls to `remember()` at the end of each `load`.

- [ ] **Step 5: Use it in `world.ts`'s `readWorkspace`**

Replace `const access = deps.access(hostId)` (line 257) with:
```ts
const snapshotted = createSnapshotAccess(deps.access(hostId), (want) => deps.snapshot(hostId, { root: workspace.root, ...want }), snapshotMemory, hostId, workspace.root);
await snapshotted.prefetch().catch((cause) => { if (cause instanceof WorkspaceUnreachableError) throw cause; });
const access = snapshotted.access;
```
Call `snapshotted.remember()` in a `finally` around the course reads. Then:
- add `snapshot: (hostId, input) => Promise<Snapshot>` to the world's deps, using `host-client.ts`'s new `snapshot` (an `onMachine`-wrapped `client.call("snapshot", input, { hostId })`), and the disk version in tests (`test/helpers/disk-access.ts`: call `host/snapshot.ts` directly);
- create one `snapshotMemory` per world.

The `resolveWorkspace` and `pathExists` calls before it stay live (1 inspect).

- [ ] **Step 6: Write the failing count test, then run it**

```ts
test("a page load asks the machine at most twice once Tutor has seen the workspace", async (t) => {
  const calls: string[] = [];
  const sandbox = await makeSandbox();
  const host = await makeTutorHost(sandbox.course, sandbox.factoryRoot, undefined, { access: "machine", onHostCall: (method) => { calls.push(method); } });
  t.after(async () => { await host.harness.lifecycle.dispose(); await sandbox.cleanup(); });
  await host.harness.behavior.callRpc("getOverview", null);
  calls.length = 0;
  const filesBefore = host.harness.inspection.sdk.callsTo("files.read").length;
  await host.harness.behavior.callRpc("getOverview", null);
  assert.ok(calls.length <= 2, `host calls: ${calls.join(", ")}`);           // pathExists' inspect + snapshot
  assert.equal(host.harness.inspection.sdk.callsTo("files.read").length - filesBefore, 0);
});
```
Expected: FAIL before step 5, PASS after.

- [ ] **Step 7: Run the suite and the typecheck; then measure against `student-001`**

Install the build on `student-001` (`standalone/spike2/box-setup.sh` until Task 11 replaces it), then time five `getOverview` calls as Spike 2's check 5 did. Record the numbers in the commit message. The target is under 300 ms server-side, but its RPC time over Cloudflare includes the network.

- [ ] **Step 8: Commit**

```bash
git add host/snapshot.ts host/snapshot.test.ts host/contract.ts host.ts server/workspace/snapshot-access.ts server/workspace/snapshot-access.test.ts server/workspace/host-client.ts server/coach/world.ts test/helpers/disk-access.ts test/server.test.ts
git commit -m "One host call per page load: a snapshot of what the last load read"
```

### Task 9: Remove the Codespace-only paths

**Files:**
- Modify: `server/coach/course-path.ts` (remove `readFeatureConfig`, `resolveFactoryHint`, `resolveProjectHint` and the default-path branch of `resolveConfiguredCourse`), `server/coach/world.ts` (`projectHint`, the feature-config reads at :295/:298/:322), `server/coach/register.ts:38` (`dataDir` from config), `shared/constants.ts` (`FEATURE_CONFIG_FILE`, `FEATURE_CONFIG_SCHEMA_VERSION`, `DEFAULT_COURSE_PATH`), `server.ts:16`, `server/coach/settings.ts` (the `coursePath` and `factoryProject` descriptions)
- Delete: `test/feature-config.test.ts`; the feature-config cases in `server/coach/course-path.test.ts`, `test/polish.test.ts:42` and `test/server.test.ts` ("the Feature's project hint…")
- Modify: `server/rpc/candidates.ts` (drop the `projectHint` parameter), `server/rpc/candidates.test.ts`, `README.md`

- [ ] **Step 1: Write the failing test**

```ts
test("with no coursePath setting, Tutor offers its built-in course and the catalog, and reports no course error", async (t) => {
  const { host } = await standalone(t);                      // the existing no-course fixture
  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.deepEqual(overview.courseErrors, []);
  assert.deepEqual(overview.courses.map((c) => c.course.id), ["tutor"]);
  assert.deepEqual(overview.available.map((a) => a.id), ["fixture"]);
});
```
It passes today too. It pins the behaviour that has to survive the deletion. The failing half of this task is the type check: once `featureConfigFile` leaves `makeTutorHost`'s options in step 2, every remaining caller fails to compile until it's removed.

- [ ] **Step 2: Delete the code and its tests as listed;** keep the `coursePath` setting (development). `world.coursePath` comes from the setting only.

- [ ] **Step 3: Run `npm test` and `npx tsc -p . --noEmit`.** Expected: PASS, with fewer tests.

- [ ] **Step 4: Commit**

```bash
git add -A server shared test README.md server.ts
git commit -m "Remove the Codespace-only paths: the tutor Feature config and the /workspaces/tutorial default"
```

---

## Phase C — the CI end-to-end (bb-plugin-tutor)

### Task 10: `e2e/hosted.sh` and the CI job

**Files:**
- Create: `e2e/hosted.sh`
- Move: `standalone/e2e/scripted-provider/` → `e2e/scripted-provider/` (`git mv`)
- Modify: `.github/workflows/ci.yaml` (job `e2e`)

**Interfaces:**
- Consumes: the plugin's RPCs `createWorkspace`, `startNextLesson`, `getLessonDetail` and `completeLesson`; the scripted provider's `CALL <tool> {json}` protocol (`e2e/scripted-provider/README.md`); Stage B's checks (`standalone/e2e/e2e.sh` `stage_lessons`).
- Produces: `e2e/hosted.sh <build|server|machine|first-run|lessons|all>`. It exits non-zero at the first `not ok`.

- [ ] **Step 1: Write `e2e/hosted.sh`**

Base it on `standalone/e2e/e2e.sh`: keep `check`, `info`, `json`, `rpc`, `make_fixture`, `tell` and `stage_lessons` as they are. Replace the launcher stages with:
```bash
SERVER_USER=${SERVER_USER:-tutor-e2e-server}
PORT=${PORT:-47390}
SERVER_URL="http://127.0.0.1:$PORT"
E2E_DIR=${E2E_DIR:-$HOME/tutor-e2e-hosted}
WS="$E2E_DIR/workspace"
BBCLI="$E2E_DIR/bb-cli/node_modules/.bin"

bbx() { env -u BB_CLI -u BB_THREAD_ID -u BB_PROJECT_ID -u BB_ENVIRONMENT_ID BB_SERVER_URL="$SERVER_URL" "$BBCLI/bb" "$@"; }

stage_build() {   # the plugin's built archive, with bb-app@0.45.0 (the build is stamped with the CLI's SDK)
  npm install --prefix "$E2E_DIR/bb-cli" --no-save --silent "bb-app@$(node -p 'require("./package.json").engines.bb.replace(">=","")')"
  PATH="$BBCLI:$PATH" scripts/release-archive.sh HEAD "$E2E_DIR/release"
  PATH="$BBCLI:$PATH" scripts/check-release-archive.sh "$E2E_DIR/release/bb-plugin-tutor-$VERSION.tgz"
}

stage_server() {  # the student server, as its own Linux user (as on ew-lsp-001), loopback only
  id "$SERVER_USER" >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash "$SERVER_USER"
  local h; h=$(getent passwd "$SERVER_USER" | cut -d: -f6)
  sudo -u "$SERVER_USER" npm install --prefix "$h/npm" --no-audit --no-fund --silent "bb-app@0.45.0"
  sudo -u "$SERVER_USER" bash -c "cd '$h' && nohup '$h/npm/node_modules/.bin/bb-server' --data-dir '$h/server' --server-bind-host 127.0.0.1 --server-port $PORT >'$h/server.log' 2>&1 &"
  for _ in $(seq 1 60); do curl -fsS "$SERVER_URL/health" -o /dev/null 2>/dev/null && break; sleep 1; done
  check "the student server is healthy" curl -fsS "$SERVER_URL/health" -o /dev/null
  sudo install -m 644 "$E2E_DIR/release/bb-plugin-tutor-$VERSION-built.tgz" "$h/plugin.tgz"
  sudo -u "$SERVER_USER" tar -xzf "$h/plugin.tgz" -C "$h"
  check "Tutor's plugin installs" sudo -u "$SERVER_USER" env BB_SERVER_URL="$SERVER_URL" "$h/npm/node_modules/.bin/bb" plugin install "$h/bb-plugin-tutor-$VERSION" --yes
}

stage_machine() { # the "Codespace": a host daemon as this user, joined over loopback (no Access in CI)
  mkdir -p "$E2E_DIR/machine" "$WS"; git -C "$WS" init -q
  BB_DATA_DIR="$E2E_DIR/machine" nohup "$BBCLI/bb-app" host-daemon join --server-url "$SERVER_URL" --host-daemon-port 47391 >"$E2E_DIR/machine.log" 2>&1 &
  for _ in $(seq 1 60); do bbx machine list --json | grep -q '"connected"' && break; sleep 1; done
  check "the machine is connected" bash -c "bbx machine list --json | grep -q '\"connected\"'"
}

stage_first_run() {
  check "the workspace folder setting points at the checkout" bbx plugin config tutor set workspaceFolder "$WS"
  local offer; offer=$(rpc offerWorkspace null)
  check "the first run offers the checkout" contains "$offer" '"status":"offer"'
  local host; host=$(printf '%s' "$offer" | json 'v.hostId ?? v.result?.hostId')
  check "createWorkspace makes it the workspace" contains "$(rpc createWorkspace "{\"hostId\":\"$host\",\"folder\":\"$WS\"}")" '"found"'
}
```
`stage_lessons` then runs as today: the scripted provider, then lessons 001–004 with the factory's tests on the machine and the move at 004. Before it, fetch the fixture course (`make_fixture`, the `courseCatalog` setting and the `fetchCourse` RPC, as `stage_fetch` does). `stage_scripted` installs the scripted provider into the student server with `bbx plugin install`.

- [ ] **Step 2: Run it locally**

Run: `e2e/hosted.sh all`
Expected: every line `ok — …`, ending with lesson 004 `ITERATION reads "004 Done"`.

- [ ] **Step 3: Add the CI job to `.github/workflows/ci.yaml`**

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: e2e/hosted.sh all
      - if: failure()
        run: tail -n 100 ~/tutor-e2e-hosted/machine.log; sudo tail -n 100 ~tutor-e2e-server/server.log
```

- [ ] **Step 4: Commit**

```bash
git mv standalone/e2e/scripted-provider e2e/scripted-provider
git add e2e/hosted.sh .github/workflows/ci.yaml
git commit -m "CI end-to-end in the hosted shape: a student server and its machine on one runner"
```

---

## Phase D — provisioning (infrastructure)

Work on a branch from `origin/main`: `git switch -c tutor/students origin/main`. The spike branch `tailnet/tutor-spike2-student-001` is superseded. Its cloudflared rule is re-made in Task 12, and its tailnet grant is dropped.

### Task 11: Student servers in `ew_bb`

**Files:**
- Modify: `roles/ew_bb/tasks/derive.yml`, `roles/ew_bb/tasks/server_proxy.yml`, `roles/ew_bb/tasks/main.yml`, `roles/ew_bb/defaults/main.yml`, `roles/ew_bb/README.md`
- Create: `roles/ew_bb/tasks/plugin_archives.yml`, `roles/ew_bb/files/ew-bb-tutor-setup.sh`
- Modify: `inventory/group_vars/ew.yml` (catalog entry `student-001`), `inventory/host_vars/ew-lsp-001.yml` (`ew_bb_servers` entry)
- Test: `spec/bb_render_spec.sh`, `spec/fixtures/bb-render/student.yml` (new), `spec/fixtures/bb-render/bad-student-no-app-url.yml` (new)

**Interfaces:**
- Produces: `ew_bb_servers` entries accept `tailnet: false` (default `true`) and `plugin_archives: [{ name: tutor, url: <https URL of bb-plugin-tutor-<v>-built.tgz>, sha256: <hex> }]`. A server with `plugin_archives` must declare `app_url`.

- [ ] **Step 1: Write the failing render specs**

`spec/fixtures/bb-render/student.yml` (shape of `ew-lsp-001.yml`'s fixture):
```yaml
ew_box_hostname_short: ew-lsp-001
ew_bb_tailnet_ip: 100.124.90.17
ew_bb_server_catalog:
  student-001: { box: ew-lsp-001, tailnet_ip: 100.124.90.17, port: 38888, app_version: "0.45.0" }
ew_bb_servers:
  - name: student-001
    user: student-001
    uid: 1200
    host_daemon_port: 38889
    app_url: https://student-001-tutor.leansoftware.ai
    memory_low_mb: 0
    memory_max_mb: 3072
    tailnet: false
    plugin_archives:
      - { name: tutor, url: "https://example.invalid/bb-plugin-tutor-0.4.0-built.tgz", sha256: "0000000000000000000000000000000000000000000000000000000000000000" }
```
In `spec/bb_render_spec.sh`:
```sh
It 'renders a student server with its own hostname and no tailnet proxy'
  When call render student
  The output should include 'Environment=BB_APP_URL=https://student-001-tutor.leansoftware.ai'
  The output should include '--server-port 38888'
  The output should include 'MemoryMax=3072M'
  The output should not include 'ew-bb-tailnet-proxy-38888'
End
It 'rejects a server with plugin archives but no app_url'
  When call rejects bad-student-no-app-url "a server with plugin_archives must declare app_url"
  The status should be success
End
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `shellspec spec/bb_render_spec.sh`
Expected: the two new examples FAIL.

- [ ] **Step 3: Implement**
- In `derive.yml`'s `ew_bb_servers_resolved`, default `tailnet` to `true` and `plugin_archives` to `[]`, and add the assert:
  ```yaml
  - name: A server with plugin archives declares its public hostname
    ansible.builtin.assert:
      that: item.plugin_archives | default([]) | length == 0 or item.app_url is defined
      fail_msg: "a server with plugin_archives must declare app_url ({{ item.name }})"
    loop: "{{ ew_bb_servers }}"
  ```
- In `server_proxy.yml`, loop over `ew_bb_servers_resolved | selectattr('tailnet')`.
- Leave `templates/bb-server.service.j2` unchanged: its `app_url` branch already writes `BB_APP_URL`.
- Add `slice: bbmachines.slice` support only if the template has no slice option. Otherwise students go in `bbservers.slice` with `memory_max_mb: 3072`, which keeps them under that slice's limit. Record which in `roles/ew_bb/README.md`.

`tasks/plugin_archives.yml`, imported after `plugins.yml` in `main.yml`:
```yaml
- name: Plugin archives are downloaded and checked
  ansible.builtin.get_url:
    url: "{{ item.1.url }}"
    dest: "{{ item.0.home }}/plugins/{{ item.1.name }}.tgz"
    checksum: "sha256:{{ item.1.sha256 }}"
    owner: "{{ item.0.user }}"
    mode: "0600"
  loop: "{{ ew_bb_servers_resolved | subelements('plugin_archives') }}"
  register: ew_bb_archives

- name: Plugin archives are installed in their server
  ansible.builtin.command:
    argv: ["/usr/local/sbin/ew-bb-tutor-setup", "{{ item.item.0.home }}/plugins/{{ item.item.1.name }}.tgz"]
  become: true
  become_user: "{{ item.item.0.user }}"
  environment: { HOME: "{{ item.item.0.home }}", BB: "{{ item.item.0.home }}/.local/bin/bb" }
  loop: "{{ ew_bb_archives.results }}"
  when: item.changed and not ansible_check_mode
```
`files/ew-bb-tutor-setup.sh` (installed to `/usr/local/sbin/ew-bb-tutor-setup` the same way `ew-bb-plugins` is) does what Spike 2's `remote/setup.sh` steps 6–7 did:
1. extract into `~/plugins/<top>`;
2. `$BB plugin install <dir> --yes`;
3. `$BB theme set plugin:tutor:sketchbook`;
4. `$BB plugin disable` each of `account-pool agent-annotations ask-user-question automations bb-guide connect custom-instructions drafts keep-awake monaco-editor navigation plugin-api-docs plugin-api-tester provider-acp push-notifications scheduled-send workflows`.

Run it from `$HOME`, because a working directory the user can't enter makes bb's CLI fail with EACCES (Spike 2).

- [ ] **Step 4: Add `student-001`** to the catalog in `group_vars/ew.yml` and to `ew_bb_servers` in `host_vars/ew-lsp-001.yml`, as in the fixture. The archive URL is the plugin's GitHub release asset `bb-plugin-tutor-<version>-built.tgz`, and its sha256 comes from the release's `SHA256SUMS`. Pick port 38888 and uid 1200, outside the people's and dev ranges.

- [ ] **Step 5: Run the specs, `devenv test`, then `bin/ew-fleet check ew-lsp-001`**

Expected: the specs pass, and the check shows only student-001's new user, unit, files and plugin tasks as changes.

- [ ] **Step 6: Commit**

```bash
git add roles/ew_bb inventory spec
git commit -m "ew_bb: student servers (no tailnet proxy, Tutor from its release archive); student-001"
```

### Task 12: The Cloudflare playbook

**Files:**
- Create: `playbooks/tutor-students.yml`, `docs/tutor-students.md`
- Modify: `inventory/group_vars/ew.yml` (`cf_access_github_org_policy_id`, `cf_leansoftware_zone_id`, `cf_tunnel_id_ew_lsp_001`), `inventory/host_vars/ew-lsp-001.yml` (`tutor_students: [{ name: student-001, port: 38888 }]`), `instances/ew-lsp-001/cloudflared-config.yml` (student-001's rule), `.env.example` (the token's scopes)
- Test: the playbook's `--check` mode against the live account, plus `ansible-playbook playbooks/tutor-students.yml --syntax-check` in `devenv test`

**Interfaces:**
- Consumes: `CF_API_TOKEN` with "Access: Apps and Policies Write", "Access: Service Tokens Write" and "DNS: Edit".
- Produces: per student, an Access app `ew-lsp-001-<student>` (domain `<student>-tutor.leansoftware.ai`, the reusable GitHub-org policy plus a Service Auth policy for its token), a service token `tutor-<student>-machine`, a proxied CNAME to `<tunnel>.cfargotunnel.com`, and a check that an anonymous `GET /health` is a 302 to `*.cloudflareaccess.com`. The token secret goes to `~/.tutor-students/<student>.env` (0600) on the operator's computer, only when the token is created.

- [ ] **Step 1: Record the three ids**
- **The reusable policy:** `curl -s -H "Authorization: Bearer $CF_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/access/policies" | jq -r '.result[] | select(.name=="lean-software-production GitHub org") | .id'`.
- **The zone id** for `leansoftware.ai`: `.../zones?name=leansoftware.ai`.
- **The tunnel id:** `a2b04acf-e58c-43cb-84a2-aeb4f101796d`, from `cloudflared-config.yml`.

Put them in `group_vars/ew.yml` with a comment each.

- [ ] **Step 2: Write the playbook** (`hosts: ew-lsp-001`, `connection: local`, `gather_facts: false`, the token from the environment, every `uri` task `no_log: true`)

Per student, in this order:
1. **The service token:** `GET /accounts/{acct}/access/service_tokens?name=tutor-<s>-machine`. If absent, `POST` it, then write the returned `client_id` and `client_secret` to `~/.tutor-students/<s>.env` (mode 0600, `delegate_to: localhost`, `no_log`), and report "created; secret in ~/.tutor-students/<s>.env".
2. **The Service Auth policy:** `GET /accounts/{acct}/access/policies?name=tutor-<s>-machine`. If absent, `POST { name, decision: "non_identity", include: [{ service_token: { token_id } }] }`.
3. **The Access app:** `GET /accounts/{acct}/access/apps?domain=<s>-tutor.leansoftware.ai`. If absent, `POST { name: "ew-lsp-001-<s>", type: "self_hosted", domain, session_duration: cf_access_session_duration, policies: [{ id: github_org, precedence: 1 }, { id: service_auth, precedence: 2 }] }`. If present, assert both policy ids are attached, and `PUT` the whole app when they're not, as `cloudflare-access.yml` does (there is no PATCH).
4. **The CNAME:** `GET /zones/{zone}/dns_records?name=<s>-tutor.leansoftware.ai`. If absent, `POST { type: CNAME, name: "<s>-tutor", content: "<tunnel>.cfargotunnel.com", proxied: true }`.
5. **The ingress rule:** assert that `instances/ew-lsp-001/cloudflared-config.yml` has `hostname: <s>-tutor.leansoftware.ai` with `service: http://localhost:<port>`. If it's missing, fail with the exact block to add and "copy the file to /etc/cloudflared/config.yml and restart cloudflared". This playbook never edits that file or restarts cloudflared.
6. **The check:** `uri GET https://<s>-tutor.leansoftware.ai/health`, `follow_redirects: none`, `status_code: 302`, and assert the `location` header contains `cloudflareaccess.com`.

In check mode: the GETs run, and the creates report "would create".

- [ ] **Step 3: Write `docs/tutor-students.md`**

**Adding a student:**
1. Add the student to `ew_bb_server_catalog`, `ew_bb_servers` and `tutor_students`.
2. Run `ansible-playbook playbooks/tutor-students.yml`. The Access app and the token come first.
3. Add the ingress rule, then copy the file to the box and restart cloudflared.
4. Run `bin/ew-fleet converge ew-lsp-001`.
5. Run the playbook again for the anonymous-302 check.
6. Send the student their link and the three secrets: the URL plus the two values from `~/.tutor-students/<s>.env`. Then delete that file.

**Removing a student** reverses the steps:
1. remove the ingress rule (copy, then restart cloudflared);
2. delete the CNAME, the app, the policy and the token (a `state: absent` variant of the playbook, `-e tutor_remove=<s>`);
3. drop the server entry and converge;
4. on the box, `systemctl disable --now` the unit and `userdel -r` the user. The role never deletes users.

- [ ] **Step 4: Syntax-check, then run in check mode against the account**

Run: `ansible-playbook playbooks/tutor-students.yml --syntax-check && CF_API_TOKEN=… ansible-playbook playbooks/tutor-students.yml --check`
Expected: for student-001 (made by hand in Spike 2), it reports the existing app and the CNAME, flags a missing named Service Auth policy if the hand-made one has a different name, and says the check passes.

- [ ] **Step 5: Commit**

```bash
git add playbooks/tutor-students.yml docs/tutor-students.md inventory .env.example instances/ew-lsp-001/cloudflared-config.yml devenv.nix
git commit -m "Tutor students at the edge: Access app, Service Auth policy, service token, CNAME"
```

### Task 13: Re-make `student-001` with the tools, and remove the spike's hand-made pieces

**Files:** none new. This task is operations, run by the operator with the go-ahead.

- [ ] **Step 1: Remove the spike's machines and the hand-made server**

From this repo:
- `standalone/spike3/cf-machine.sh teardown`;
- `docker rm -f <the codespace-like container>`, then `bb machine remove host_nteksyrxqn` over the tailnet;
- `standalone/spike2/teardown.sh`.

This removes the user `student-001` and its units, and restores nothing in Cloudflare.

- [ ] **Step 2: Converge the student server** with `bin/ew-fleet converge ew-lsp-001`, then run `playbooks/tutor-students.yml`. Expected: the user, unit, plugin and theme are back, and the Access check passes.

- [ ] **Step 3: Retire the hand-made Access pieces.** If the playbook made its own Service Auth policy and token, delete the hand-made `tutor-student-001-machine` token and its policy in the dashboard, so only the playbook's remain.

- [ ] **Step 4: The pre-pilot checks, by hand.** In a real Codespace of the starter (Task 2's branch), with the playbook's three secrets:
  1. **It connects:** `bb-feature-status` reports it, and the first run offers `/workspaces/capstone-project-starter`.
  2. **The workspace is created,** and a Claude Code coach adopts Lesson 0.
  3. **The course is added,** with `seeded.kept` listing the starter's files, then lesson 001 is adopted.
  4. **It recovers:** stop the Codespace, see the "asleep" message, resume, and see the outline come back without a reload.
  5. **The edge:** an anonymous `curl -I https://student-001-tutor.leansoftware.ai/` gets a 302.

  Record the results in `docs/2026-10-04-hosted-tutor.md` under a new "Pre-pilot check" heading.

---

## Phase E — retirement

### Task 14: Remove the launcher (bb-plugin-tutor)

**Files:**
- Delete: `standalone/` (`tutor`, `install.sh`, `test/`, `e2e/e2e.sh`, `e2e/record-pi`, `spike/`, `spike2/`, `spike3/`), `scripts/release-standalone.sh`, `test/pins.test.ts`'s launcher assertions
- Modify: `package.json` (drop `bats` from devDependencies, and any `test:standalone` script), `.github/workflows/ci.yaml` (the bats and shellcheck steps for `standalone/`), `.github/workflows/release.yaml` (the launcher assets), `README.md` (the "Standalone" section → "Hosted", pointing at the spec and the infrastructure repo's `docs/tutor-students.md`)

- [ ] **Step 1: Check that nothing outside `standalone/` uses it**

Run: `git grep -n "standalone/" -- ':!standalone' ':!docs'`
Expected: only the workflow and `package.json` references this task removes.

- [ ] **Step 2: Delete and edit as listed**

Keep `scripts/release-archive.sh` and `scripts/check-release-archive.sh`: the release still ships the built plugin archive that Task 11 installs.

- [ ] **Step 3: Run `npm ci && npm test && npx tsc -p . --noEmit`, then `e2e/hosted.sh all`.** Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git rm -r standalone scripts/release-standalone.sh
git add -A package.json package-lock.json .github README.md test
git commit -m "Retire the all-on-the-laptop launcher: Tutor is hosted"
```

### Task 15: Deprecate the `tutor` feature (devcontainer-features)

**Files:**
- Modify: `src/tutor/README.md` and `src/tutor/NOTES.md` (a deprecation notice at the top), `README.md` (the `tutor` row marked deprecated, pointing at the `bb` feature's machine mode)

- [ ] **Step 1: Add the notice:** "Deprecated (2026-10): Tutor is now hosted, one server per student, and the student's Codespace joins it with the `bb` feature's `machine` mode. This feature gets no new versions."
- [ ] **Step 2: Run `devcontainer features test -f tutor --skip-autogenerated .`** to confirm nothing else changed. Then commit and ask the operator to open the PR.

```bash
git commit -am "tutor: deprecated in favour of a hosted Tutor and bb's machine mode"
```

---

## Phase F — the pilot

### Task 16: Provision the instructors and run the pilot

**Files:**
- Modify: `inventory/group_vars/ew.yml` and `inventory/host_vars/ew-lsp-001.yml` (one entry per instructor, `student-002` …)
- Create: `docs/2026-10-pilot.md` (in bb-plugin-tutor): who, when, and what they thought

- [ ] **Step 1: For each instructor, follow `docs/tutor-students.md` "Adding a student".** Check memory after each (`systemctl show tutor-<s> -p MemoryCurrent`, or the ew_bb unit name). Stop adding when the box has under 4 GiB available.
- [ ] **Step 2: Send each instructor their link and secrets,** with the starter guide's "Connect to your Tutor" section.
- [ ] **Step 3: Collect, in `docs/2026-10-pilot.md`:**
  - did they reach a Lesson 0 coach without help, and if not, where did they stop;
  - which agent coached;
  - did the capstone course's lesson 001 adopt;
  - do they think it's worth continuing to invest in, and why.
- [ ] **Step 4: Commit the notes.**

---

## Self-review notes

**Spec coverage:**

| Spec item | Task |
|---|---|
| Decision 1 (hosted server per student) | 11, 12, 13 |
| Decision 2 (the Codespace is the machine) | 1, 2 |
| Decision 3 (the workspace is the checkout) | 3 (`workspaceFolder`) |
| Decision 4 (the student's own agent) | built; explained in 5 |
| Decisions 5 and 6 (one hostname, Access, service token) | 12 |
| Decision 7 (the feature's machine mode) | 1 |
| Decision 8 (provisioning by the operator) | 11–13, 16 |
| Decision 9 (the plugin creates the project) | 3, 4 |
| Decision 10 (retirement) | 14, 15; the e2e retargeted in 10 |
| Decision 11 (pins) | Global Constraints, 2, 11 |
| Plugin changes 1–5 | 3–4, 5–6, 7, 8, 9 |
| Security | 12 (anonymous-302 check), 1 (token handling, already tested) |
| Testing | 10 (CI), 1 (feature CI), 13 step 4 (manual) |
| Acceptance criteria 1–6 | 13 step 4, 16 |

**Known risks the executor should watch:**
- **Task 6:** the exact shape of the `thread.failed` event and the test harness's emit method. Read the SDK types first, as the task says.
- **Task 8:** sha256 parity between `snapshot` and `sdk.files`. Step 2 checks it.
- **Task 12:** Cloudflare's API field names for service-token policies (`non_identity`, `service_token.token_id`). Check them against the API docs, using the account's existing Service Auth policy (the hand-made one) as a live example (`GET` it first).
