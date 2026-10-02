# Standalone Tutor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tutor up ~/my-course` gives a Mac or Linux student a working Tutor at `http://127.0.0.1:47386`, made of a tutor server and an enrolled machine. At the same time Tutor becomes course-agnostic: a workspace instead of a factory, Lesson 0 built in, and every other course fetched.

**Architecture:** The plugin's server half keeps the course and the decisions, and reaches the student's folder only through the machine: `sdk.files` for reads and guarded writes, and a host entry (`host.ts`) for whole operations (`inspect`, `adoptLesson`, `seedWorkspace`). The capstone's factory logic moves behind a `capstone-factory` course layout that both halves share (`layouts/`). A POSIX-shell launcher (`standalone/tutor`) installs BB 0.44.0, runs `bb-server` and the enrolled machine as user services, keeps Tutor's pi apart in `~/.tutor/pi`, and creates the workspace project.

**Tech Stack:** TypeScript (strict, `node --test` over the sources), `@get-bb/plugin-sdk` 0.5.29 (the SDK bb-app 0.44.0 bundles), zod 4, POSIX sh plus bats for the launcher, systemd user units and launchd agents, GitHub Actions.

**Spec:** [`docs/2026-10-02-standalone-tutor.md`](2026-10-02-standalone-tutor.md). Read it before any task; this plan argues from it. Terms follow [`docs/GLOSSARY.md`](GLOSSARY.md).

## Global Constraints

- Mac and Linux only. Node 22.19+, 24 or 26; npm; git. No Docker, no Windows, no native installer, no BB desktop app.
- BB is pinned at **0.44.0** (`bb-app`), with `@get-bb/plugin-sdk` **0.5.29** pinned exactly. The host-entry API is `experimental_`, so BB and the SDK move together, and every bump runs the end-to-end test.
- Server: `bb-server --data-dir ~/.tutor/server --server-bind-host 127.0.0.1 --server-port 47386`. Default port **47386**, changed by `--port`.
- `machineServerUrl` is `http://127.0.0.1:<port>`, never `localhost`. `defaultMachineAccess` is `direct`.
- Machine data lives in `~/.bb-machines/127.0.0.1-<port>/`, because BB's installer manages machines only there.
- Both services listen on `127.0.0.1` only. BB's Host/Origin checks stay on.
- `~/.tutor/server` and the machine directory are `0700`. The enrolment header only ever sits in a `0600` file and is passed as `curl -H @file`. It never appears in arguments or output.
- The machine service environment carries `PI_CODING_AGENT_DIR=<abs ~/.tutor/pi>` and `BB_PI_BRIDGE_COMMAND=<abs ~/.tutor/bin/pi>`. `~/.pi` is never touched.
- In scripts, `pi -p` runs with `</dev/null`.
- Host calls are limited to 32 MiB in, 8 MiB out and a 30-second default timeout.
- The launcher is one POSIX shell script, and its name is one variable (`TUTOR_NAME=tutor`). Nothing it prints says "bb", except `tutor logs`.
- The plugin is installed from the release's plugin archive, which the launcher carries. Nothing is fetched from the network at run time apart from course content the student asks for.
- `tutor up` adds only `.git` to the workspace, and Lesson 0 adds only `.tutor/`. Nothing Tutor does ever deletes the workspace.
- The existing suite (`npm run typecheck && npm test && bb plugin build .`) stays green after every task, and the `bb-tutor` Codespace keeps coaching Lesson 0 and lesson 001.
- Repo conventions: relative imports carry their extension; type-only imports use `import type`; frontend code imports `shared/model.ts` and `shared/rpc.ts` with `import type` only; UI copy follows `vendor/brand/VOICE.md` (`app/voice.test.ts`).

## Review Focus

These are the conditions the spec implies but no feature test naturally exercises. Each has a test in the task named.

1. **The machine goes away mid-call.** The daemon restarts itself on auto-update, or the laptop sleeps. The student should see "unreachable" with its own message, never "missing", and an adoption should never be left half done. Tests: Task 8 (unreachable status) and Task 10 (a host call that fails after the lock leaves nothing half written).
2. **The progress file changes between Tutor's read and its write.** The student or an outside agent edits `PROGRESS.yaml`. The write should refuse or retry, not lose either edit. Test: Task 8 (`expectedSha256` conflict).
3. **A workspace path with spaces or non-ASCII characters** (`~/My Course`, `~/Études`). The service files, the drop-in and the project root should all work. Tests: Task 15 and Task 18 (bats).
4. **Re-running `tutor up` after BB's daemon auto-update rewrote the plist or unit and dropped Tutor's environment.** It should be repaired silently. Test: Task 19 (bats repair case).
5. **An existing Codespace student upgrades the plugin mid-course.** They have the `factoryProject` setting, Lesson 0's record in `spec/PROGRESS.yaml`, and coach threads whose metadata names the old course id. Nothing they have done should look undone. Tests: Task 3 (setting fallback) and Task 6 (Lesson 0 fallback, old coach threads).

## Decisions made in this plan

The spec left these open. Each is decided here so a reviewer can see and challenge it.

1. **The spike's output is a document plus scripts.** `standalone/spike/` holds the scripts that were run, and `docs/2026-10-02-standalone-tutor-spike.md` records the results per OS, the exact commands BB 0.44.0 needs, and a captured BB↔pi RPC transcript. Later tasks read their constants from it. *What changes if it fails* is in Task 1.
2. **BB is pinned first (Task 2), before the refactor.** That way SDK drift surfaces early, and the fake host's `experimental_callHostRpc` and `experimental_createHostEntryHarness` are available to every later test. The tutor and bb devcontainer Features move to BB 0.44.0 in lockstep with the release (Task 23). Until then, the Codespace keeps the plugin release it pins.
3. **`workspaceProject` replaces `factoryProject`.** A stored `factoryProject` is still read when `workspaceProject` is unset, so existing Codespaces carry on, but it is never written. The RPC `confirmFactory` becomes `confirmWorkspace`, and `Overview.factoryProject` becomes `Overview.workspace`. Both halves ship in one plugin, so the contract can change in one step.
4. **How a course says which layout it uses.** It sets `layout:` in `course.yaml`. A course read from the ledger (no `course.yaml`) is `capstone-factory`, because only the capstone uses that format. A `course.yaml` without `layout` has none. The release (Task 23) waits until the tutorial's `course.yaml`, if it has one, says `layout: capstone-factory`.
5. **Lesson 0 is its own built-in course** (`id: tutor`), listed first in the outline. Lesson ids repeat across courses, so every lesson RPC input and every route carries `courseId`. A legacy route `start/NNN` resolves to the built-in course for `000`, else to the only other course. An existing coach thread for lesson `000` counts as Lesson 0's coach, whatever course id its metadata names.
6. **Where progress lives.**
   - The built-in course: `.tutor/progress.yaml`, with no `ITERATION`. It is done once every Example passes or is skipped, as Lesson 0 is today.
   - A fetched course without a layout: `.tutor/courses/<course-id>/progress.yaml`, with `ITERATION` beside it.
   - `capstone-factory`: `spec/PROGRESS.yaml` and `ITERATION` in the factory, as today.

   For Codespace compatibility, when `.tutor/progress.yaml` is absent, Lesson 0's status is read from the capstone progress file's `000` entry (current or `history`).
7. **A third host method, `inspect`.** `sdk.files` (SDK 0.5.29) has no `lstat` and no `realpath`, but layout detection needs to tell folder, link, file and nothing apart. Kinds and real paths therefore come from `inspect(paths)`. Progress reads use `sdk.files.read`, and progress writes use `sdk.files.write` with `expectedSha256`. On a conflict Tutor re-reads once under the workspace lock and retries; a second conflict is an error the coach sees.
8. **"The server never touches the workspace" is enforced statically.** `test/no-workspace-io.test.ts` fails when a module under `server/` imports `node:fs`, `node:fs/promises` or `node:child_process`, except the allowlisted ones: course loading, the content store and fetch, the activity heartbeat, and the Feature config reader.
9. **Bundles have a 24 MiB encoded ceiling**, under the 32 MiB host-call limit. The server refuses anything bigger with a clear error, and there is no chunking. Task 9 measures the fixture course, and a manual step records the real tutorial's numbers in the spike document.
10. **`seedWorkspace` writes only what is absent.**
    - A file that is already there with the same content counts as done.
    - A file that is there with different content is kept and reported, never overwritten.
    - `.tutor/seeds/<course-id>.json` records that a seed finished. A call after an interruption simply finishes the seed.
    - Tutor does not commit, since its tools never do. The tool's text tells the coach to commit the starter.
11. **The course catalog is a constant**, `server/content/catalog.ts`, holding the tutorial and its starter at pinned tags or full SHAs. A `courseCatalog` setting (a JSON string) overrides it, which is how the end-to-end test points at a fixture course.
12. **A configured course wins.** When the `coursePath` setting, `TUTOR_COURSE_PATH` or the Feature config names one, fetched content is ignored and "Add the course" is hidden. The default `/workspaces/tutorial` counts as configured only if it exists, so a standalone Tutor without a course shows no error.
13. **The coach provider is a setting, `coachProvider`.** It is a string, and empty means BB's default. `tutor up` sets it to `pi`, and the Codespace leaves it empty, so the Codespace does not suddenly need pi. When it is set, `spawnCoachThread` passes `providerId` with `executionInputSources: { providerId: "explicit" }`; without that, BB drops a `providerId` it has no source for.
14. **The coach file goes in as text.**
    - The course's coach file is inlined in the coach thread's first prompt and in `configure`'s instructions, capped at 48 KiB (truncated with a note).
    - The starter's `coach-me` skill stays in the workspace and is named by its path relative to the workspace.
15. **Fetching runs on the server**, with `git clone --depth 1 --branch <tag>`, or `git init` plus `git fetch --depth 1 origin <sha>`. It writes into `<BB data dir>/content/<course-id>/{course,starter}`. Refs must be tags or full SHAs, never branch names.
16. **"Add the course" is offered whether or not Lesson 0 is done.** Adoption is not gated on Lesson 0 today either: `adoptionTargets` offers the first real lesson alongside it.
17. **The launcher's conventions.**
    - State: `~/.tutor/config` holds `key=value` lines. They are read with `grep`/`sed` and never sourced.
    - Releases: assets are kept in `~/.tutor/releases/<version>/`.
    - Services: `tutor-server.service` on Linux, `com.leansoftwareproduction.tutor-server` on macOS.
    - BB calls: every `bb` call goes through `tutor_bb()` with `BB_DATA_DIR=~/.tutor/server`, and its output goes to `~/.tutor/logs/launcher.log`.
    - Enrolment: `bb machine create --provider manual --key tutor-machine`, so a retry reuses the creation. BB's installer script is saved, without the header, so that `tutor uninstall` can run it with `--uninstall`.
18. **`tutor up` refuses some folders as the workspace:** `$HOME` itself, anything inside `~/.tutor` or `~/.bb-machines`, and the course content directory.
19. **The end-to-end test uses two stand-ins.**
    - A `fake-pi` on `BB_PI_BRIDGE_COMMAND` records its environment and argv, and replays the BB↔pi transcript captured in the spike. This proves a pi coach thread starts on the machine with `~/.tutor/pi`.
    - Checks that need coach tool calls switch `coachProvider` to devcontainer-features' scripted provider, which the Codespace end-to-end test already uses.

    CI runs with `loginctl enable-linger` so systemd user services work.
20. **The workspace is `unreachable` when the machine is not connected** (its `Host.status` is not `"connected"`), or when a host call fails with BB's offline error. Every gate shows "Tutor can't reach your computer's machine right now. Run `tutor status`."

## File structure

New and moved modules, by responsibility:

| Path | Responsibility |
|---|---|
| `host.ts` | The host entry (`experimental_defineHostEntry`): `inspect`, `adoptLesson`, `seedWorkspace`. Declared as `bb.host` in `package.json`. |
| `host/contract.ts` | The zod contract shared by `host.ts` and the server's client. |
| `host/inspect.ts`, `host/lock.ts`, `host/bundle.ts`, `host/seed.ts` | lstat/realpath probes, a per-root lock in the worker, bundle validation and writing, and the resumable seed. |
| `layouts/types.ts` | `CourseLayoutState`, `ProgressLocation`, `PathKind`, `LayoutProbe`. |
| `layouts/capstone-factory/{detect,spec-copy,factory-move,adopt}.ts` | Today's `server/progress/{layout,spec-copy,factory-move}.ts`, moved. Detection takes a `LayoutProbe`; spec-copy takes bundles. |
| `layouts/progress/{progress-yaml,iteration,carry-over}.ts` | The pure formats, moved from `server/progress/` so both halves can use them. |
| `server/workspace/{access,machine-access,workspace-project,host-client}.ts` | `WorkspaceAccess`, its `sdk.files` + `inspect` implementation, workspace resolution (was `factory-project.ts`), and the typed host client. |
| `server/content/{catalog,fetch,store,make-bundle}.ts` | The course catalog, the git fetch, the fetched-content index, and bundles built from course folders. |
| `server/coach/coach-text.ts` | Reads the coach file and caps it, for inlining. |
| `standalone/tutor`, `standalone/install.sh` | The launcher, one POSIX sh file of functions with a `main` at the bottom (tests source it with `TUTOR_SOURCE_ONLY=1`), and its installer. |
| `standalone/test/*.bats`, `standalone/test/stubs/` | The launcher's tests and its stubs. |
| `standalone/spike/` | Task 1's scripts. |
| `standalone/e2e/` | The Linux end-to-end test and `fake-pi`. |
| `test/helpers/disk-access.ts` | A `WorkspaceAccess` over the local disk, for tests only. |

`npm test` gains the globs `"host/**/*.test.ts" "layouts/**/*.test.ts"`, added in the task that creates the first test there.

---

## Phase 1: Verify pi's environment (spec Order 1)

### Task 1: Spike: pi's environment on a real machine service, Linux and macOS

This task builds no product code. It answers one question before anything depends on the answer: **does a manually enrolled BB 0.44.0 machine, with `PI_CODING_AGENT_DIR` and `BB_PI_BRIDGE_COMMAND` in its service environment, keep them across restarts, and do pi login, model discovery and pi threads all use `~/.tutor/pi`?** It also records the exact commands later tasks need.

**Files:**
- Create: `standalone/spike/setup.sh` (server and machine on a throwaway port, 47399)
- Create: `standalone/spike/check-pi-env.sh` (the assertions, printing PASS/FAIL lines)
- Create: `standalone/spike/tee-pi` (a `BB_PI_BRIDGE_COMMAND` wrapper that logs stdin and stdout of the real pi to `$TEE_PI_LOG`)
- Create: `standalone/spike/teardown.sh`
- Create: `docs/2026-10-02-standalone-tutor-spike.md`

**Interfaces:**
- Produces, in the spike document, these values that later tasks copy verbatim:
  - `BB_SERVER_HEALTH_PATH`: the health URL path (expected `/health`).
  - `BB_SET_MACHINE_URL`: the command that sets `machineServerUrl` and `defaultMachineAccess` (expected `bb settings general machineServerUrl http://127.0.0.1:<port>` and `bb settings general defaultMachineAccess direct`).
  - `BB_ENROL_LINE_PATTERN`: how to find the `curl -H 'X-BB-Enrollment: …' <url> | sh` line in `bb machine create --provider manual` output.
  - `MACHINE_UNIT_GLOB` and `MACHINE_PLIST_GLOB`: where BB's installer writes the systemd user unit and the launchd plist, and how to recognise them (each mentions `.bb-machines/127.0.0.1-<port>`).
  - `MACHINE_UNINSTALL`: how BB's installer uninstalls (expected: re-run the saved installer with `--uninstall`), and whether the installer body itself holds a secret.
  - `PI_PACKAGE` and `PI_VERSION`: the npm package and version tested (`@earendil-works/pi-coding-agent`, at the version installed for the spike).
  - `PI_LOGIN`: how to run pi's login against a given agent dir.
  - `PI_READY`: how to tell whether that dir is signed in (expected: `auth.json` there holds at least one provider).
  - `PI_RPC_TRANSCRIPT`: `standalone/e2e/fixtures/pi-rpc-transcript.jsonl`, the BB↔pi exchange of one coach turn, which `fake-pi` (Task 21) replays.
  - `BB_CLI_ENV`: how the `bb` CLI is pointed at the tutor server (expected `BB_DATA_DIR=~/.tutor/server`).

- [ ] **Step 1: Write `standalone/spike/setup.sh`**

```sh
#!/bin/sh
# Spike only: a tutor-shaped server and machine on port 47399, data under $SPIKE_HOME.
set -eu
SPIKE_HOME=${SPIKE_HOME:-$HOME/.tutor-spike}
PORT=47399
BB_VERSION=0.44.0
umask 077
mkdir -p "$SPIKE_HOME/server" "$SPIKE_HOME/pi" "$SPIKE_HOME/bin"
npm install --prefix "$SPIKE_HOME/npm" "bb-app@$BB_VERSION" \
  --allow-scripts=better-sqlite3,node-pty,@parcel/watcher >"$SPIKE_HOME/npm.log" 2>&1
BB="$SPIKE_HOME/npm/node_modules/.bin"
"$BB/bb-server" --data-dir "$SPIKE_HOME/server" --server-bind-host 127.0.0.1 --server-port "$PORT" \
  >"$SPIKE_HOME/server.log" 2>&1 &
echo $! >"$SPIKE_HOME/server.pid"
until curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do sleep 1; done
export BB_DATA_DIR="$SPIKE_HOME/server"
"$BB/bb" settings general machineServerUrl "http://127.0.0.1:$PORT"
"$BB/bb" settings general defaultMachineAccess direct
"$BB/bb" machine create --provider manual --key spike-machine >"$SPIKE_HOME/create.out" 2>&1 &
echo "Now run the curl line from $SPIKE_HOME/create.out by hand (header in a 0600 file), then check-pi-env.sh"
```

- [ ] **Step 2: Write `standalone/spike/tee-pi`**

```sh
#!/bin/sh
# BB_PI_BRIDGE_COMMAND wrapper: records env, argv and the RPC exchange, then runs the real pi.
LOG=${TEE_PI_LOG:-$HOME/.tutor-spike/pi-rpc.log}
{ echo "argv: $*"; echo "PI_CODING_AGENT_DIR=${PI_CODING_AGENT_DIR-unset}"; } >>"$LOG.env"
exec 3>>"$LOG"
tee -a /dev/fd/3 | "$HOME/.tutor-spike/bin/pi.real" "$@" | tee -a /dev/fd/3
```

- [ ] **Step 3: Write `standalone/spike/check-pi-env.sh`**

It prints one `PASS`/`FAIL` line per check:
1. The machine service's environment (`systemctl --user show <unit> -p Environment`, or `launchctl print gui/$UID/<label>`) holds both variables.
2. After `systemctl --user restart <unit>` (or `launchctl kickstart -k`), it still holds both.
3. After a simulated BB update rewrite (re-run BB's installer, which rewrites the unit or plist), say whether the drop-in survives on Linux and whether the plist's `EnvironmentVariables` survive on macOS. Expected: the drop-in survives and the plist entries do not. That is why `tutor up` repairs them.
4. `PI_CODING_AGENT_DIR=$SPIKE_HOME/pi pi.real --list-models </dev/null` lists nothing before login.
5. After the login in `PI_LOGIN`, `$SPIKE_HOME/pi/auth.json` exists, and `~/.pi/agent/auth.json` has the same checksum as before (record it first).
6. `bb provider list --machine <id>` (model discovery) shows pi's models from `$SPIKE_HOME/pi`. Check by signing in to a provider that is absent from `~/.pi`.
7. A pi thread spawned on the machine (`bb thread spawn --provider pi --machine <id> --prompt-file -`) runs through `tee-pi`, whose `.env` log shows `PI_CODING_AGENT_DIR=$SPIKE_HOME/pi`.
8. After a reboot (by hand; note it in the document), checks 1 and 7 again.

- [ ] **Step 4: Run it on Linux, then on macOS**

Run `standalone/spike/setup.sh`, do the enrolment by hand, then run `standalone/spike/check-pi-env.sh` on each OS. Expected: checks 1, 2 and 4 to 8 PASS on both OSes. Check 3 is informational.

- [ ] **Step 5: Capture the RPC transcript**

Copy one coach turn's lines from `pi-rpc.log` into `standalone/e2e/fixtures/pi-rpc-transcript.jsonl`, with any credential redacted. Include one tool call to a plugin tool if BB routes plugin tools through pi; say in the document how it does.

- [ ] **Step 6: Write `docs/2026-10-02-standalone-tutor-spike.md`**

Sections: what was run (OS, versions), the result of each check per OS, the constants listed under **Interfaces**, and the measured sizes of the real tutorial's largest lesson bundle and of the starter (for Task 9).

- [ ] **Step 7: Tear down and commit**

```bash
standalone/spike/teardown.sh   # bb machine remove, the installer's --uninstall, kill the server, rm -rf ~/.tutor-spike
git add standalone/spike docs/2026-10-02-standalone-tutor-spike.md standalone/e2e/fixtures/pi-rpc-transcript.jsonl
git commit -m "Spike: pi's environment on an enrolled machine, Linux and macOS"
```

**If it fails, this is what changes.** Record the failing check in the spike document, take the matching branch below, and update the tasks it names before starting them.

| Failing check | Change |
|---|---|
| 2 or 8: a variable is lost on restart or reboot (Linux) | Write the variables into the unit's own `[Service]` section with `systemctl --user edit --full` instead of a drop-in, and repair it on every `tutor up` and `tutor status` (Tasks 18 and 19). |
| 2 or 8 (macOS): the plist's `EnvironmentVariables` are lost | Repair on every `tutor up`, and have `tutor status` say "Run `tutor up` to repair Tutor's agent settings" (Task 19). Report it to BB together with the `localhost` bug (Task 23). |
| 1 or 7: BB's pi provider ignores one variable in practice | Point `BB_PI_BRIDGE_COMMAND` at a wrapper, `~/.tutor/bin/pi`, that exports `PI_CODING_AGENT_DIR` and then `exec`s the pinned pi. Then only one variable has to reach the daemon (Task 18). If `BB_PI_BRIDGE_COMMAND` itself is ignored, put `~/.tutor/bin` first on the machine service's `PATH` instead, and say so in Task 18. |
| 6: model discovery reads `~/.pi` although threads use `~/.tutor/pi` | Coach threads also pin the model. `coachProvider` becomes `pi:<model>` (Task 12), and `tutor login` writes the chosen model into `~/.tutor/config` and the plugin setting (Task 18). |
| 5: pi's login writes outside `PI_CODING_AGENT_DIR` | Stop. Decision 10 of the spec (the student signs Tutor's pi in themselves, kept apart from `~/.pi`) no longer holds, and the design goes back to its author before Phase 5. Phases 2 to 4 do not depend on pi and can go ahead. |
| The BB↔pi exchange can't be replayed (BB injects an extension that calls back into BB) | `fake-pi` only records its environment and exits cleanly after the first prompt, and every progress check uses the scripted provider (Task 21). |

## Phase 2: Workspace and layouts (spec Order 2)

### Task 2: Pin BB 0.44.0 and plugin SDK 0.5.29

**Files:**
- Modify: `package.json` (`engines.bb` `>=0.44.0`, `engines.bbPluginSdk` `>=0.5.29`, devDependency `@get-bb/plugin-sdk` `0.5.29`)
- Modify: `package-lock.json` (`npm install --save-exact @get-bb/plugin-sdk@0.5.29`)
- Modify: `.github/workflows/ci.yaml` (`BB_APP_VERSION: 0.44.0`)
- Modify: `README.md` ("Tutor targets bb-app **0.44.0** … plugin SDK **0.5.29**")
- Modify: any source that SDK drift breaks (typecheck finds them)
- Test: `test/pins.test.ts`

**Interfaces:**
- Produces: `test/pins.test.ts`, which later tasks extend with the launcher's `BB_VERSION` (Task 15).

- [ ] **Step 1: Write the failing test**

```ts
// test/pins.test.ts: BB and the SDK move together (the host-entry API is experimental_).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const BB = "0.44.0";
const SDK = "0.5.29";

test("package.json, the lockfile and CI pin the same BB and SDK", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.engines.bb, `>=${BB}`);
  assert.equal(pkg.engines.bbPluginSdk, `>=${SDK}`);
  assert.equal(pkg.devDependencies["@get-bb/plugin-sdk"], SDK);
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.equal(lock.packages["node_modules/@get-bb/plugin-sdk"].version, SDK);
  const ci = await readFile(".github/workflows/ci.yaml", "utf8");
  assert.match(ci, new RegExp(`BB_APP_VERSION: ${BB.replace(/\./g, "\\.")}\\b`));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/pins.test.ts`
Expected: FAIL. `engines.bb` is `>=0.43.4`.

- [ ] **Step 3: Bump the pins**

```bash
npm install --save-exact --save-dev @get-bb/plugin-sdk@0.5.29
# then edit package.json engines, ci.yaml BB_APP_VERSION and README as listed above
```

- [ ] **Step 4: Fix the type errors**

Run: `npm run typecheck`. Fix each error at its source and don't loosen types. Expected drift is small: `threads.list` args, `createFakePluginHost` options.

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test && bb plugin build .` (with bb 0.44.0 on `PATH`)
Expected: all PASS, and `dist/server.js`, `dist/app.js` built.

- [ ] **Step 6: Check the Codespace with BB 0.44.0**

In a devcontainer-features checkout, set the bb Feature's version to `0.44.0` in `.devcontainer/tutor`, then run `scripts/tutor-dev/e2e/run-all.sh` with this checkout swapped in (see `scripts/tutor-dev/e2e/README.md`). Expected: the walk passes. Note the devcontainer-features change for Task 23; don't push it.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .github/workflows/ci.yaml README.md test/pins.test.ts <fixed sources>
git commit -m "Pin BB 0.44.0 and plugin SDK 0.5.29"
```

### Task 3: `workspaceProject` replaces `factoryProject`

A rename with a migration. Behaviour is otherwise unchanged.

**Files:**
- Modify: `shared/constants.ts` (`SETTING_KEYS.workspaceProject = "workspaceProject"`; keep `factoryProject` marked "read only, for Tutor before 0.5")
- Modify: `shared/rpc.ts` (`factoryProjectSchema` → `workspaceSchema`, `FactoryProject` → `Workspace`; `overviewSchema.factoryProject` → `workspace`; `confirmFactory` → `confirmWorkspace`; `stateChangedSignalSchema.reason` `"factoryProject"` → `"workspace"`)
- Rename: `server/coach/factory-project.ts` → `server/workspace/workspace-project.ts` (`resolveFactory` → `resolveWorkspace`, `Factory` → `ResolvedWorkspace`)
- Modify: `server/coach/settings.ts` (a `workspaceProject` descriptor; the `factoryProject` descriptor kept with the label "Factory project (older Tutor)")
- Modify: `server/coach/world.ts`, `actions.ts`, `auth.ts`, `register.ts`, `signals.ts`, `tools.ts`, `server/rpc/handlers.ts`, `views.ts`, `candidates.ts`
- Modify: `app/model/{home,outline,welcome,lesson}.ts`, `app/ui/{WelcomePage,Home,Outline,StartPage}.tsx` (field rename, and copy: "workspace" where it talks about the setting)
- Modify: `shared/fixtures.ts` (`fixtureFactoryProject` → `fixtureWorkspace`), `test/helpers/*.ts`, every test touching these names
- Test: `server/workspace/workspace-project.test.ts`, plus `test/server.test.ts` (migration)

**Interfaces:**
- Produces:

```ts
// shared/rpc.ts
export const workspaceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unset") }),
  z.object({ status: z.literal("found"), projectId: z.string(), projectName: z.string(), root: z.string() }),
  z.object({ status: z.literal("missing"), projectId: z.string() }),
]);
export type Workspace = z.infer<typeof workspaceSchema>;

// server/workspace/workspace-project.ts
export interface ResolvedWorkspace { workspace: Workspace; hostId: string | null }
export function workspaceSetting(values: { workspaceProject?: string; factoryProject?: string }): string | undefined;
export async function resolveWorkspace(sdk: Sdk, projectId: string | undefined): Promise<ResolvedWorkspace>;
```

- `World.factoryProject` → `World.workspace`, and `World.factoryHostId` → `World.hostId`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/workspace/workspace-project.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { workspaceSetting } from "./workspace-project.ts";

test("workspaceProject wins; an older Tutor's factoryProject is still read; empty is unset", () => {
  assert.equal(workspaceSetting({ workspaceProject: "prj_a", factoryProject: "prj_b" }), "prj_a");
  assert.equal(workspaceSetting({ factoryProject: "prj_b" }), "prj_b");
  assert.equal(workspaceSetting({ workspaceProject: "", factoryProject: "prj_b" }), "prj_b");
  assert.equal(workspaceSetting({}), undefined);
});
```

```ts
// test/server.test.ts (new test)
test("a Codespace set up by an older Tutor (factoryProject only) keeps its workspace, and confirming writes workspaceProject", async (t) => {
  const sandbox = await makeRepoSandbox();
  t.after(() => sandbox.cleanup());
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot, { factoryProject: PROJECT_ID });
  const overview = await host.harness.rpc.call("getOverview", null);
  assert.equal(overview.workspace.status, "found");
  await host.harness.rpc.call("confirmWorkspace", { projectId: PROJECT_ID });
  assert.equal(host.harness.settings.get("workspaceProject"), PROJECT_ID);
});
```

(Use the fake harness's actual accessors for RPC and settings. `test/server.test.ts` already calls RPCs through them, so copy that pattern.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok|workspace"`
Expected: FAIL. The module and `confirmWorkspace` don't exist.

- [ ] **Step 3: Rename and add the fallback**

`workspaceSetting` returns the first non-empty value of `workspaceProject`, then `factoryProject`. `createWorldSource` calls `resolveWorkspace(bb.sdk, workspaceSetting(values))`. `confirmWorkspace` writes `{ workspaceProject: projectId }` only. Update every reference the typechecker reports. Change student-facing copy that names the setting ("Set up your factory project →" becomes "Pick your workspace →"; "The factory project you chose has gone" becomes "The workspace you chose has gone"), and keep copy that talks about the capstone factory itself.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS, the voice test included.

- [ ] **Step 5: Commit**

```bash
git add -A shared server app test
git commit -m "Rename the factory project to the workspace, still reading factoryProject"
```

### Task 4: The `WorkspaceAccess` seam (still on local disk)

Every server-side read and probe of the workspace goes through one port. Production still uses the local disk until Task 8 switches it to the machine, so behaviour is unchanged. Under the seam, layout detection and the progress formats move to `layouts/` so the host can share them.

**Files:**
- Create: `layouts/types.ts`
- Move: `server/progress/layout.ts` → `layouts/capstone-factory/detect.ts` (and its test)
- Move: `server/progress/{progress-yaml,iteration,carry-over}.ts` → `layouts/progress/` (and their tests)
- Create: `server/workspace/access.ts`
- Create: `test/helpers/disk-access.ts`
- Modify: `server/progress/store.ts` (reads and writes through `WorkspaceAccess` and `ProgressLocation`)
- Modify: `shared/ports.ts` (`ProgressStore` signature)
- Modify: `server/coach/coach-file.ts`, `server/coach/course-path.ts` (`resolveProjectHint` uses `findRepoRoot` with the probe), `server/rpc/candidates.ts`, `server/workspace/workspace-project.ts`, `server/coach/world.ts`
- Modify: `package.json` (`test` script gains `"layouts/**/*.test.ts"`)
- Test: `layouts/capstone-factory/detect.test.ts` (moved, now run against `diskProbe`), `server/progress/store.test.ts`, `test/no-workspace-io.test.ts` (new)

**Interfaces:**
- Produces:

```ts
// layouts/types.ts
export type PathKind = "folder" | "link" | "file" | "none";
/** What layout detection may ask about the workspace: lstat kinds and real paths of absolute machine paths. */
export interface LayoutProbe {
  kinds(paths: readonly string[]): Promise<Record<string, PathKind>>;
  realPath(path: string): Promise<string>;
}
/** Where one course's progress lives in the workspace. Paths in it are relative to `dir`. */
export interface ProgressLocation {
  dir: string;
  progressFile: string;
  /** Read in order; the first is the one written. Empty: there is no ITERATION (the built-in course). */
  iterationFiles: readonly string[];
}

// server/workspace/access.ts
import type { LayoutProbe } from "../../layouts/types.ts";
export interface FileText { text: string; sha256: string }
export interface WorkspaceAccess extends LayoutProbe {
  read(path: string): Promise<FileText | null>;
  /** expected: a sha256 the file must still have; null: it must not exist yet; undefined: no check. */
  write(path: string, text: string, expected?: string | null): Promise<void>;
}
export class WorkspaceUnreachableError extends Error { override name = "WorkspaceUnreachableError"; }
export class WriteConflictError extends Error { override name = "WriteConflictError"; }

// layouts/capstone-factory/detect.ts (was resolveLayout(projectRoot))
export async function resolveLayout(projectRoot: string, probe: LayoutProbe): Promise<Layout>;
export async function findRepoRoot(from: string, probe: LayoutProbe): Promise<string | null>;
export function capstoneProgress(layout: Layout): ProgressLocation; // { dir: factoryDir, progressFile: "spec/PROGRESS.yaml", iterationFiles: ["ITERATION", "spec/ITERATION"] }

// shared/ports.ts
export interface ProgressStore {
  read(access: WorkspaceAccess, at: ProgressLocation): Promise<StudentState>;
  writeProgress(access: WorkspaceAccess, at: ProgressLocation, progress: ProgressFile): Promise<void>;
  writeIteration(access: WorkspaceAccess, at: ProgressLocation, state: IterationState): Promise<void>;
}
```

- `WorldDeps` gains `access: (hostId: string) => WorkspaceAccess`. `server.ts` passes a disk-backed access for now (moved into Task 8). Production code gets it from `server/workspace/local-access.ts`, a temporary file that Task 8 deletes, allowlisted in the guard until then.

- [ ] **Step 1: Write the guard test**

```ts
// test/no-workspace-io.test.ts
// The server reaches the workspace only through the machine (spec: "The plugin split").
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

/** Server modules allowed to use the local filesystem or processes: none of them reads the workspace. */
const ALLOWED = new Set([
  "server/activity/heartbeat.ts",        // BB's data dir
  "server/coach/course-path.ts",         // the Feature's config file
  "server/course/builtin.ts",
  "server/course/files.ts",              // the course checkout, on the server
  "server/course/load-course.ts",
  "server/course/yaml-file.ts",
  "server/coach/coach-text.ts",          // the course's coach file (Task 12)
  "server/content/fetch.ts",             // Task 13
  "server/content/store.ts",             // Task 13
  "server/content/make-bundle.ts",       // Task 9
  "server/paths.ts",                     // realPath of the course path only
  "server/workspace/local-access.ts",    // removed in Task 8
]);
const IO = /from "node:(fs|fs\/promises|child_process)"/;

async function* sources(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) yield path;
  }
}

test("no server module reads or writes the workspace itself", async () => {
  const offenders: string[] = [];
  for await (const path of sources("server")) {
    if (!ALLOWED.has(path) && IO.test(await readFile(path, "utf8"))) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/no-workspace-io.test.ts`
Expected: FAIL, listing `server/progress/store.ts`, `server/progress/layout.ts`, `server/coach/coach-file.ts`, `server/rpc/candidates.ts`, `server/coach/factory-project.ts` or its rename, `server/progress/spec-copy.ts` and `server/progress/factory-move.ts`. The last two stay offenders until Task 10. Add them to `ALLOWED` with the comment `// moves to layouts/ in Task 10` so this task can go green.

- [ ] **Step 3: Write `test/helpers/disk-access.ts`**

```ts
// A WorkspaceAccess over this machine's disk, for tests: what the machine's host entry does, without BB.
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PathKind } from "../../layouts/types.ts";
import { WriteConflictError, type WorkspaceAccess } from "../../server/workspace/access.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function createDiskAccess(): WorkspaceAccess {
  return {
    async kinds(paths) {
      const out: Record<string, PathKind> = {};
      for (const path of paths) {
        const stats = await lstat(path).catch(() => null);
        out[path] = stats === null ? "none" : stats.isSymbolicLink() ? "link" : stats.isDirectory() ? "folder" : "file";
      }
      return out;
    },
    realPath: (path) => realpath(path).catch(() => resolve(path)),
    async read(path) {
      const text = await readFile(path, "utf8").catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return null;
        throw cause;
      });
      return text === null ? null : { text, sha256: sha(text) };
    },
    async write(path, text, expected) {
      if (expected !== undefined) {
        const current = await readFile(path, "utf8").then(sha, () => null);
        if (current !== expected) throw new WriteConflictError(`${path} changed since it was read.`);
      }
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, text, "utf8");
      await rename(temp, path);
    },
  };
}
```

`server/workspace/local-access.ts` is the same code, temporarily, for `server.ts`. Have it re-export a shared implementation rather than duplicating it: put the body in `server/workspace/local-access.ts` and make `test/helpers/disk-access.ts` re-export `createLocalAccess as createDiskAccess`. Task 8 moves the body to `test/helpers/disk-access.ts`.

- [ ] **Step 4: Move layout detection and the formats**

Run `git mv` for the files listed. In `detect.ts`, replace `kindOf`, `occupied` and `realPath` with calls on `probe`. `resolveLayout` asks once for the kinds of `[late, early, .git, ITERATION…, spec/PROGRESS.yaml, AGENTS.md]` under the root, then decides exactly as before. `findRepoRoot` walks up, asking `probe.kinds([dir/.git])` per level. Update imports everywhere.

- [ ] **Step 5: Route the store, coach file, candidates and workspace resolution through the port**

- `store.ts` builds paths as `join(at.dir, at.progressFile)` and so on. It reads with `access.read` and writes with `access.write(path, text, previousSha)`, where `previousSha` is the sha from the read in the same tool call. `ownFolder` checks become `access.kinds` before writing.
- `coach-file.ts` asks `access.kinds` for the skill candidates.
- `candidates.ts` probes with `access.kinds` and `access.read`.
- `resolveWorkspace` checks the root with `access.kinds([root])` and keeps `"missing"` when it is `"none"`.
- `world.ts` gets the access from `deps.access(hostId)` and compares `access.realPath(root)` with `realPath(coursePath)`.

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npm test`
Expected: PASS, including the moved detect, store and progress-yaml tests and the guard.

- [ ] **Step 7: Commit**

```bash
git add -A layouts server shared test package.json
git commit -m "Reach the workspace through one WorkspaceAccess port"
```

### Task 5: Course layouts: `none` and `capstone-factory`

**Files:**
- Modify: `server/course/manifest.ts` (`layout: z.enum(["capstone-factory"]).optional()` in `courseYamlSchema`; `CourseManifest.layout: LayoutId | null`; a ledger course is `"capstone-factory"`)
- Modify: `shared/model.ts` (`courseSchema` gains `layout: z.enum(["capstone-factory"]).nullable()`)
- Modify: `server/course/load-course.ts` (passes `layout` through)
- Create: `layouts/state.ts`
- Modify: `server/coach/world.ts` (`World.layout: CourseLayoutState`, replacing `Layout | null`)
- Modify: `server/coach/actions.ts`, `tools.ts`, `status-text.ts`, `prompts.ts`, `server/rpc/handlers.ts`, `views.ts`, `shared/rpc.ts` (gates)
- Modify: `shared/fixtures.ts` (`fixtureCourse.layout = "capstone-factory"`; a new `fixtureLayoutlessCourse`)
- Test: `layouts/state.test.ts`, `server/course/manifest.test.ts`, `server/coach/actions.test.ts`, `test/server.test.ts`

**Interfaces:**
- Consumes: `resolveLayout`, `capstoneProgress`, `LayoutProbe` and `ProgressLocation` (Task 4).
- Produces:

```ts
// layouts/state.ts
import type { Layout } from "./capstone-factory/detect.ts";
export type LayoutId = "capstone-factory";
export type CourseLayoutState =
  | { id: null; ready: true; progress: ProgressLocation; problems: []; blocked: null }
  | { id: "capstone-factory"; ready: boolean; layout: Layout; progress: ProgressLocation; problems: string[]; blocked: string | null };
/** `courseDir`: where a layoutless course keeps its files in the workspace, relative to it (".tutor/courses/<id>"). */
export async function resolveCourseLayout(id: LayoutId | null, workspaceRoot: string, courseDir: string, probe: LayoutProbe): Promise<CourseLayoutState>;
export const NOT_READY = "This lesson needs the course's starter files in your workspace. Add the course from the outline first.";
```

  - `ready` for `capstone-factory`: the layout has a factory folder, which means `blocked === null` and the "no factory folder" problem is absent. For a ledger course in the Codespace, the starter clone already has `tetris/.factory`, so it is ready.
  - The layoutless `progress`: `{ dir: join(root, courseDir), progressFile: "progress.yaml", iterationFiles: ["ITERATION"] }`.
- `shared/rpc.ts`: `lessonSummarySchema` gains `needsLayout: z.boolean()`, true when the course declares a layout that isn't ready. `overviewSchema` gains `layout: z.object({ id: z.enum(["capstone-factory"]).nullable(), ready: z.boolean() })`.
- `coachStateOf` (actions.ts) returns `{ error: NOT_READY }` for a non-built-in lesson of a course whose layout isn't ready. `CoachState.layout` becomes `CourseLayoutState`, and the tools write progress to `state.layout.progress`.

- [ ] **Step 1: Write the failing tests**

```ts
// layouts/state.test.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDiskAccess } from "../test/helpers/disk-access.ts";
import { resolveCourseLayout } from "./state.ts";

test("a course without a layout is ready at once and keeps progress under .tutor/courses/<id>", async () => {
  const root = await mkdtemp(join(tmpdir(), "ws-"));
  const state = await resolveCourseLayout(null, root, ".tutor/courses/intro", createDiskAccess());
  assert.equal(state.ready, true);
  assert.deepEqual(state.progress, { dir: join(root, ".tutor/courses/intro"), progressFile: "progress.yaml", iterationFiles: ["ITERATION"] });
});

test("capstone-factory is not ready in an empty workspace, and is in a starter clone", async () => {
  const root = await mkdtemp(join(tmpdir(), "ws-"));
  await mkdir(join(root, ".git"));
  const empty = await resolveCourseLayout("capstone-factory", root, ".tutor/courses/x", createDiskAccess());
  assert.equal(empty.ready, false);
  await mkdir(join(root, "tetris/.factory"), { recursive: true });
  const starter = await resolveCourseLayout("capstone-factory", root, ".tutor/courses/x", createDiskAccess());
  assert.equal(starter.ready, true);
  assert.equal(starter.progress.progressFile, "spec/PROGRESS.yaml");
});
```

```ts
// server/course/manifest.test.ts (add)
test("course.yaml may declare layout: capstone-factory, and nothing else", () => {
  const yaml = (layout: string) => `id: c\ntitle: C\nlayout: ${layout}\nlessons:\n  - { id: "001", title: One, dir: one }\n`;
  assert.equal(parseCourseYaml(yaml("capstone-factory"), "/c", "course.yaml").layout, "capstone-factory");
  assert.throws(() => parseCourseYaml(yaml("other"), "/c", "course.yaml"), /line 3: layout/);
  assert.equal(parseCourseYaml("id: c\ntitle: C\nlessons:\n  - { id: \"001\", title: One, dir: one }\n", "/c", "course.yaml").layout, null);
});
```

```ts
// test/server.test.ts (add)
test("a capstone lesson waits for the layout, with its own message; a layoutless course's lesson does not", async (t) => {
  const ws = await mkdtemp(join(tmpdir(), "ws-"));
  t.after(() => rm(ws, { recursive: true, force: true }));
  await mkdir(join(ws, ".git"));
  const capstone = await makeTutorHost({ ...fixtureCourse, layout: "capstone-factory" }, ws);
  await assert.rejects(capstone.harness.rpc.call("startNextLesson", { lessonId: "001" }), /Add the course from the outline first/);
  const plain = await makeTutorHost(fixtureLayoutlessCourse, ws);
  const { threadId } = await plain.harness.rpc.call("startNextLesson", { lessonId: "001" });
  assert.ok(threadId);
});
```

Task 6 changes these RPC inputs to `{ courseId, lessonId }`; update these tests then.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Add the manifest field and the model field. Write `layouts/state.ts`. In `world.ts`, call `resolveCourseLayout(course.layout, root, ".tutor/courses/" + course.id, access)` and read the student with `deps.store.read(access, layout.progress)`. Gate in `coachStateOf`, `openCoach`, `startNextLesson` and `redirectFocus` with `NOT_READY` for non-built-in lessons when `!layout.ready`. In `adoptAction`, legacy mode and `needsFactoryMove` apply only when `layout.id === "capstone-factory"`. A layoutless adoption returns `{ progress, iteration }` and no `adopt`, with the text `Adopted lesson NNN "Title": … Its spec is in the course; nothing was copied into your workspace.`

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A layouts server shared test
git commit -m "Course layouts: none, and capstone-factory behind one interface"
```

### Task 6: Lesson 0 becomes the built-in course; the world holds several courses

**Files:**
- Modify: `server/course/load-course.ts` (`loadCourse` stops prepending Lesson 0; new `loadBuiltinCourse(): Promise<Course>` with `id: "tutor"`, `layout: null`)
- Modify: `shared/ports.ts` (`CourseSource.loadBuiltin()`)
- Modify: `server/coach/world.ts` (`World.courses: LoadedCourse[]`, built-in first)
- Modify: `shared/derive.ts` (`resolveCurrent` unchanged per course; `adoptionTargets` per course: the first lesson of a not-started course is a target)
- Modify: `server/coach/actions.ts`, `tools.ts`, `auth.ts`, `status-text.ts`, `threads.ts` (`findCoachThread`: lesson `000` matches any course id)
- Modify: `shared/rpc.ts` (`lessonRef = { courseId, lessonId }` on every lesson input; `Overview` → `{ workspace, courses: CourseOverview[], threads }`; `tutorThreadSchema.courseId`)
- Modify: `shared/routes.ts` (`start/<courseId>/<lessonId>`, `complete/<courseId>/<lessonId>`; legacy `start/NNN` parses to `courseId: null`)
- Modify: `server/rpc/handlers.ts`, `views.ts`
- Modify: `app/model/*.ts`, `app/ui/*.tsx` (the outline renders one group per course, built-in first; every lesson call passes `courseId`; directives take the course from the thread context)
- Modify: `shared/fixtures.ts`, `test/helpers/*.ts`, every test using lesson inputs
- Test: `shared/routes.test.ts`, `server/course/load-course.test.ts`, `app/model/outline.test.ts`, `test/server.test.ts`

**Interfaces:**
- Consumes: `CourseLayoutState` and `resolveCourseLayout` (Task 5).
- Produces:

```ts
// server/coach/world.ts
export interface LoadedCourse {
  course: Course;
  layout: CourseLayoutState;
  student: StudentState;
  pointer: CurrentPointer;
  coachPath: string | null;
}
export interface World {
  workspace: Workspace;
  hostId: string | null;
  /** Tutor's built-in course first, then the configured or fetched courses. Empty only while there is no workspace. */
  courses: LoadedCourse[];
  /** Courses that could not be loaded, by id or path, with the reason. */
  courseErrors: { source: string; error: string }[];
  projectHint: string | null;
}
export const BUILTIN_COURSE_ID = "tutor";

// shared/rpc.ts
export const lessonRefSchema = z.object({ courseId: z.string().min(1).max(64), lessonId: lessonIdSchema });
export const courseOverviewSchema = z.object({
  course: courseInfoSchema,
  builtin: z.boolean(),
  layout: z.object({ id: z.enum(["capstone-factory"]).nullable(), ready: z.boolean() }),
  lessons: z.array(lessonSummarySchema),
  current: currentStateSchema.nullable(),
});
// overviewSchema: { workspace, courses: z.array(courseOverviewSchema), courseErrors: z.array(z.object({ source: z.string(), error: z.string() })), threads }

// shared/routes.ts
export type TutorRoute =
  | { kind: "home" }
  | { kind: "welcome" }
  | { kind: "start"; courseId: string | null; lessonId: string }
  | { kind: "complete"; courseId: string | null; lessonId: string };
```

- Progress locations follow Decision 6. The built-in course uses `{ dir: join(root, ".tutor"), progressFile: "progress.yaml", iterationFiles: [] }`. The Codespace fallback lives in `world.ts`: when that file reads as `null` and a `capstone-factory` course's student has `000` (as current progress or in `history`), the built-in student is built from that entry.

- [ ] **Step 1: Write the failing tests**

```ts
// shared/routes.test.ts (add)
test("lesson routes carry the course; a legacy start/NNN has none", () => {
  assert.deepEqual(parseRoute("start/tutor/000"), { kind: "start", courseId: "tutor", lessonId: "000" });
  assert.deepEqual(parseRoute("complete/software-factory/003"), { kind: "complete", courseId: "software-factory", lessonId: "003" });
  assert.deepEqual(parseRoute("start/003"), { kind: "start", courseId: null, lessonId: "003" });
  assert.equal(formatRoute({ kind: "start", courseId: "tutor", lessonId: "000" }), "start/tutor/000");
});
```

```ts
// test/server.test.ts (add)
test("with no course configured, Tutor offers the built-in course alone, and Lesson 0 progress lands in .tutor/progress.yaml", async (t) => {
  const ws = await mkdtemp(join(tmpdir(), "ws-"));
  t.after(() => rm(ws, { recursive: true, force: true }));
  await mkdir(join(ws, ".git"));
  const host = await makeTutorHost(null, ws); // null: no configured course
  const overview = await host.harness.rpc.call("getOverview", null);
  assert.deepEqual(overview.courses.map((entry) => entry.course.id), ["tutor"]);
  const { threadId } = await host.harness.rpc.call("openCoach", { courseId: "tutor", lessonId: "000" });
  await callTool(host, "tutor_adopt_iteration", { iteration: "000" }, threadId);
  assert.match(await readFile(join(ws, ".tutor/progress.yaml"), "utf8"), /iteration: "?000"?/);
  assert.deepEqual((await readdir(ws)).sort(), [".git", ".tutor"]);
});

test("an older Codespace's Lesson 0 record in spec/PROGRESS.yaml still shows Lesson 0 done, and its coach thread is found", async (t) => {
  const sandbox = await makeRepoSandbox({ progress: { iteration: "001", history: { "000": { examples: allPassing(lesson0) } } }, iteration: "001 WIP" });
  t.after(() => sandbox.cleanup());
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot);
  host.addThread({ id: "thr_old", originPluginId: "tutor", metadata: { course: "software-factory", lesson: "000", role: "coach" } });
  const overview = await host.harness.rpc.call("getOverview", null);
  const builtin = overview.courses.find((entry) => entry.builtin);
  assert.equal(builtin?.lessons[0]?.status, "done");
  assert.equal(builtin?.lessons[0]?.coachThreadId, "thr_old");
});
```

`makeTutorHost` changes to `(course: Course | null, workspaceRoot, settings?, options?)`, where `null` means no configured course and `courseSource.loadBuiltin` is the real built-in. `makeRepoSandbox` gains the `progress` and `iteration` options. `callTool` is the existing helper in `test/server.test.ts`; move it into `test/helpers/fake-bb.ts`.

```ts
// app/model/outline.test.ts (add)
test("the outline shows the built-in course first, then each course with its lessons", () => {
  const view = outlineView(overviewWith([builtinCourseOverview, fixtureCourseOverview]), null);
  assert.deepEqual(view.groups.map((group) => group.courseId), ["tutor", "software-factory"]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`
Expected: FAIL.

- [ ] **Step 3: Implement the backend**

- Stop prepending in `loadCourse`. `loadBuiltinCourse` reads `server/course/builtin/` as its own course with `id: "tutor"`. `checkLessonIds` still reserves `000`.
- `world.ts` loads the built-in course and the configured course (a list, which Task 13 extends with fetched ones), each with its layout and student.
- Every handler looks up the course with `requireCourse(world, courseId)` and passes `courseId` on.
- `coachStateOf(world, courseId)` picks the course, and the tools take the course from the caller's coach-thread metadata. For lesson `000` that is always the built-in course.
- `lockKey` stays `factoryLockKey(workspace root)`, now called `workspaceLockKey`.

- [ ] **Step 4: Implement the frontend**

- `outline.ts` builds one group per `CourseOverview`.
- Routes carry the course id. `homeDecision` sends the student to the first not-done lesson, taking the built-in course first, then the first course in order.
- `Directives.tsx` reads `courseId` from `getThreadContext` (whose `TutorThread` now has `courseId`) for `getLessonDetail`.
- Keep the CSS and the scope tests untouched.

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test && bb plugin build .`
Expected: PASS.

- [ ] **Step 6: Check the Codespace walk**

Run `scripts/tutor-dev/e2e/run-all.sh` (as in Task 2, Step 6). Expected: PASS. The walk's URLs now have the course in them, so update `walk.mjs` where it builds `start/NNN` URLs, which still resolve through the legacy route.

- [ ] **Step 7: Commit**

```bash
git add -A server shared app test scripts/tutor-dev
git commit -m "Lesson 0 is Tutor's built-in course; the world holds several courses"
```

### Task 7: Tutor's own words: Lesson 0, the welcome page and the coach skill

**Files:**
- Modify: `server/course/builtin/lesson-0/README.md` (no "lesson 1 is ready")
- Delete: `server/course/builtin/lesson-0/FACTORY.md` (Lesson 0 has none; `factoryMd` is `""`, as `readLesson` already allows)
- Modify: `server/course/builtin/lesson-0/features/tutor.feature` ("not your factory" becomes "not your own work")
- Modify: `app/ui/WelcomePage.tsx`, `app/model/welcome.ts` (no Codespace or BB wording; a workspace picker; candidates qualify per Decision 4)
- Modify: `server/rpc/candidates.ts` (a layoutless setup: every standard project qualifies, with `.tutor/` first; capstone: today's rules)
- Modify: `skills/tutor/SKILL.md` (general parts talk about the workspace; "Where the factory is" becomes a section headed "When the course uses the capstone-factory layout")
- Modify: `docs/GLOSSARY.md` (Workspace, Course layout, Tutor server, Machine, Built-in course; Factory and Repo point to the layout)
- Test: `server/course/tutorial.test.ts`, `app/voice.test.ts` (already runs), `test/copy.test.ts` (new)

**Interfaces:**
- Consumes: `World.courses` (Task 6).
- Produces: nothing new for code. The copy rules below are what Task 13's "Add the course" text follows.

- [ ] **Step 1: Write the failing test**

```ts
// test/copy.test.ts: Tutor's own text is course-agnostic and never names BB or a Codespace.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const OWN_TEXT = [
  "server/course/builtin/lesson-0/README.md",
  "server/course/builtin/lesson-0/features/tutor.feature",
  "app/ui/WelcomePage.tsx",
];

test("Lesson 0 and the welcome page don't assume the capstone, a Codespace or BB", async () => {
  for (const path of OWN_TEXT) {
    const text = await readFile(path, "utf8");
    assert.doesNotMatch(text, /\bfactory\b|lesson 1 is ready|Codespace/i, path);
    assert.doesNotMatch(text.replace(/@get-bb|bb\.(\w+)/g, ""), /\bBB\b/, path);
  }
});

test("the coach skill keeps factory instructions inside the capstone-factory section", async () => {
  const skill = await readFile("skills/tutor/SKILL.md", "utf8");
  const [general = "", capstone = ""] = skill.split(/^## When the course uses the capstone-factory layout$/m);
  assert.ok(capstone.length > 0, "the capstone-factory section exists");
  assert.doesNotMatch(general, /tetris|\.factory|fetch\.sh/);
});
```

The `\bBB\b` check is meant for user-visible strings. If `WelcomePage.tsx` has code identifiers that trip it, narrow the check to JSX text and string literals rather than weaken it.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test test/copy.test.ts`
Expected: FAIL on the three files and the skill.

- [ ] **Step 3: Rewrite the copy**

- The Lesson 0 README's last line becomes: "When every Example has passed, your coach closes the lesson. Add a course from the outline whenever you're ready."
- The welcome page asks for "the folder you'll work in" and lists projects. Its setup notice says: "Your coach needs a folder to work in. Run `tutor up <folder>` to make one, or pick a project below."
- In the skill, the general sections refer to "the workspace (this thread's folder)" and "the coaching method in your instructions". Every `tetris`/`factory`/`fetch.sh` line moves under the new section unchanged.
- In the glossary, add the terms named above. **Factory** and **Repo** now say that they belong to the `capstone-factory` layout.

- [ ] **Step 4: Run everything**

Run: `npm test`
Expected: PASS, `app/voice.test.ts` included.

- [ ] **Step 5: Commit**

```bash
git add -A server/course/builtin app skills docs/GLOSSARY.md test/copy.test.ts server/rpc/candidates.ts
git commit -m "Tutor's own text talks about the workspace, not the factory"
```

## Phase 3: The plugin split (spec Order 3)

### Task 8: The host entry, `inspect`, and `WorkspaceAccess` through the machine

**Files:**
- Create: `host/contract.ts`, `host/inspect.ts`, `host.ts`
- Modify: `package.json` (`"bb": { …, "host": "./host.ts" }`; the `test` script gains `"host/**/*.test.ts"`)
- Create: `server/workspace/host-client.ts`, `server/workspace/machine-access.ts`
- Modify: `server/workspace/workspace-project.ts` (the `unreachable` status)
- Modify: `shared/rpc.ts` (`workspaceSchema` gains `{ status: "unreachable", projectId, projectName }`)
- Modify: `server.ts` (`access: (hostId) => createMachineAccess(bb, host, hostId)`)
- Delete: `server/workspace/local-access.ts` (its body moves to `test/helpers/disk-access.ts`, and it leaves the guard's allowlist)
- Modify: `app/model/home.ts`, `outline.ts`, `app/ui/Outline.tsx`, `Home.tsx` (the unreachable message)
- Test: `host/inspect.test.ts`, `server/workspace/machine-access.test.ts`, `test/server.test.ts`

**Interfaces:**
- Produces:

```ts
// host/contract.ts
import { z } from "zod";
export const pathKindSchema = z.enum(["folder", "link", "file", "none"]);
export const hostContract = {
  inspect: {
    input: z.object({ paths: z.array(z.string().startsWith("/")).max(256), realPaths: z.array(z.string().startsWith("/")).max(16) }),
    output: z.object({ kinds: z.record(z.string(), pathKindSchema), realPaths: z.record(z.string(), z.string()) }),
  },
  // adoptLesson: Task 10; seedWorkspace: Task 11
} as const;
export type HostContract = typeof hostContract;

// host.ts
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
export default experimental_defineHostEntry({ contract: hostContract, handlers: { inspect: (input) => inspect(input) /* adoptLesson, seedWorkspace later */ } });

// server/workspace/host-client.ts
export interface TutorHostClient {
  inspect(hostId: string, input: { paths: string[]; realPaths: string[] }): Promise<{ kinds: Record<string, PathKind>; realPaths: Record<string, string> }>;
}
export function createHostClient(bb: BbPluginApi): TutorHostClient; // bb.hosts.experimental_client({ contract: hostContract }).call(method, input, { hostId })

// server/workspace/machine-access.ts
export function createMachineAccess(bb: BbPluginApi, host: TutorHostClient, hostId: string): WorkspaceAccess;
//   kinds/realPath  -> host.inspect
//   read            -> bb.sdk.files.read({ hostId, path }) -> { text, sha256 } (decode base64 when contentEncoding is "base64"); a not-found error -> null
//   write           -> bb.sdk.files.write({ hostId, path, content: text, contentEncoding: "utf8", createParents: true, expectedSha256: expected })
//                      outcome "conflict" -> throw WriteConflictError
//   any BB error whose code or message says the host is offline or unreachable -> throw WorkspaceUnreachableError
```

- `resolveWorkspace` reads `bb.sdk.hosts.get({ hostId })`. When its `status` is not `"connected"`, it returns `{ status: "unreachable", … }` without probing.
- Every gate (`coachStateOf`, the `require*` helpers, `homeDecision`, `continueView`, `outlineView`) treats `unreachable` apart from `missing`, with the message from Decision 20.
- The server's tool writer catches `WriteConflictError` once per tool call. It reloads the world under the same lock and re-runs the action. A second conflict is refused with: "Your progress file changed while Tutor was writing it. Call tutor_status and try again."

- [ ] **Step 1: Write the failing host test**

```ts
// host/inspect.test.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../host.ts";

test("inspect tells folders, links, files and nothing apart, and resolves real paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspect-"));
  await mkdir(join(root, "dir"));
  await writeFile(join(root, "file"), "x");
  await symlink("dir", join(root, "link"));
  const host = experimental_createHostEntryHarness(entry);
  const out = await host.experimental_call("inspect", {
    paths: ["dir", "file", "link", "none"].map((name) => join(root, name)),
    realPaths: [join(root, "link")],
  });
  assert.deepEqual(Object.values(out.kinds), ["folder", "file", "link", "none"]);
  assert.equal(out.realPaths[join(root, "link")], join(await realpathOf(root), "dir"));
});

test("inspect refuses relative paths at the contract", async () => {
  const host = experimental_createHostEntryHarness(entry);
  await assert.rejects(host.experimental_call("inspect", { paths: ["relative"], realPaths: [] }));
});
```

`realpathOf` is `fs.realpath`, which matters because `/tmp` is a link on macOS. Check the harness import path against the SDK's `exports`: it is `./testing/host` (`bb-plugin-sdk-testing-host.d.ts`).

- [ ] **Step 2: Write the failing server tests**

```ts
// server/workspace/machine-access.test.ts
test("read decodes sdk.files, write passes expectedSha256, and a conflict is a WriteConflictError", async () => {
  const calls: unknown[] = [];
  const bb = fakeBbWithFiles({
    read: async () => ({ path: "/w/p", content: Buffer.from("hi").toString("base64"), contentEncoding: "base64", sha256: "abc", sizeBytes: 2 }),
    write: async (args) => { calls.push(args); return { outcome: "conflict", currentSha256: "def" }; },
  });
  const access = createMachineAccess(bb, fakeHostClient(), "host_1");
  assert.deepEqual(await access.read("/w/p"), { text: "hi", sha256: "abc" });
  await assert.rejects(access.write("/w/p", "new", "abc"), WriteConflictError);
  assert.equal((calls[0] as { expectedSha256: string }).expectedSha256, "abc");
});

test("a host that is offline makes reads fail as unreachable, not missing", async () => {
  const bb = fakeBbWithFiles({ read: async () => { throw Object.assign(new Error("host is offline"), { code: "host_offline" }); } });
  await assert.rejects(createMachineAccess(bb, fakeHostClient(), "host_1").read("/w/p"), WorkspaceUnreachableError);
});
```

Before writing `fakeBbWithFiles`, check the exact error code BB 0.44.0 uses for an offline host in the SDK's types (`BbHttpError` codes, searched for `offline` and `not_connected`). Use the real code in both the test and the implementation.

```ts
// test/server.test.ts (add)
test("a machine that is not connected makes the workspace unreachable, with its own message", async (t) => {
  const host = await makeTutorHost(null, "/nowhere", undefined, { hostStatus: "disconnected" });
  const overview = await host.harness.rpc.call("getOverview", null);
  assert.equal(overview.workspace.status, "unreachable");
  await assert.rejects(host.harness.rpc.call("openCoach", { courseId: "tutor", lessonId: "000" }), /can't reach your computer's machine/);
});

test("a progress file changed between read and write is retried once, then refused, and neither edit is lost", async (t) => {
  // workspace with Lesson 0 adopted; the fake access's write throws WriteConflictError on the first call and
  // appends an outside edit to the file; the second attempt re-reads (keeping the outside edit) and writes.
});
```

Write the second test in full. The fake `access` wraps `createDiskAccess()` with a `beforeWrite` hook that edits the file once. Assert that the final file holds both the outside edit (an `examples` entry the tool didn't write) and the tool's mark.

`makeTutorHost` gains `hostStatus` (default `"connected"`), returned from a stubbed `sdk.hosts.get`. It also passes `access: () => createDiskAccess()` (or a test's own) and a `host` client built on `createFakePluginHost`'s `experimental_callHostRpc`, which dispatches to `experimental_createHostEntryHarness(entry)`. That way the fake goes through the real host handlers.

- [ ] **Step 3: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 4: Implement**

- Write `host/inspect.ts`, which uses `lstat` and `realpath`, with the same code as `createDiskAccess().kinds` and `realPath`.
- Add `host.ts`, the contract, the client, `machine-access.ts`, the `unreachable` status and the frontend messages.
- Move `local-access.ts`'s body to `test/helpers/disk-access.ts` and take it off the guard's allowlist.

- [ ] **Step 5: Run everything, and build**

Run: `npm run typecheck && npm test && bb plugin build .`
Expected: PASS, with `dist/host.js` and `dist/host.meta.json` produced.

- [ ] **Step 6: Check the Codespace walk**

Run `scripts/tutor-dev/e2e/run-all.sh`. Expected: PASS. In the Codespace, the machine is the Codespace's own host, so `sdk.files` and `inspect` reach the same disk.

- [ ] **Step 7: Commit**

```bash
git add -A host.ts host server shared app test package.json
git commit -m "Reach the workspace through the machine: sdk.files and the host entry's inspect"
```

### Task 9: Bundles

**Files:**
- Create: `shared/bundle.ts`
- Create: `server/content/make-bundle.ts`
- Create: `host/bundle.ts`
- Test: `shared/bundle.test.ts`, `server/content/make-bundle.test.ts`, `host/bundle.test.ts`

**Interfaces:**
- Produces:

```ts
// shared/bundle.ts
import { z } from "zod";
export const bundleEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1), executable: z.boolean(), base64: z.string() }),
  z.object({ kind: z.literal("symlink"), path: z.string().min(1), target: z.string().min(1) }),
]);
export const bundleSchema = z.object({ entries: z.array(bundleEntrySchema).max(20_000) });
export type Bundle = z.infer<typeof bundleSchema>;
export type BundleEntry = z.infer<typeof bundleEntrySchema>;
export const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;
/** Null when `path` is a safe relative path (no leading "/", no "..", no empty or "." segment, no NUL); else why not. */
export function unsafePath(path: string): string | null;
/** Null when a link at `path` pointing at `target` stays inside the bundle's root; else why not. Absolute targets are refused. */
export function escapingLink(path: string, target: string): string | null;
export function bundleBytes(bundle: Bundle): number; // JSON length, which is what crosses the wire

// server/content/make-bundle.ts
/** Every file and link under `dir`, relative to it; `skip` names top-level entries left out. Throws past MAX_BUNDLE_BYTES. */
export async function bundleFolder(dir: string, options?: { skip?: readonly string[]; prefix?: string }): Promise<Bundle>;

// host/bundle.ts
/** Validates every entry (unsafePath, escapingLink, no duplicate paths), then writes them under `target`, which must be a real folder. */
export async function writeBundle(target: string, bundle: Bundle, options: { onlyIfAbsent: boolean }): Promise<{ written: string[]; same: string[]; kept: string[] }>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// shared/bundle.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { escapingLink, unsafePath } from "./bundle.ts";

test("bundle paths must be relative and stay inside", () => {
  for (const bad of ["/etc/passwd", "../up", "a/../../b", "", "a//b", "./a", "a/\0"]) assert.notEqual(unsafePath(bad), null, bad);
  for (const good of ["README.md", "features/one.feature", ".agents/skills/x/SKILL.md"]) assert.equal(unsafePath(good), null, good);
});

test("links may point within the bundle only", () => {
  assert.equal(escapingLink("factory/.claude/skills", "../../.agents/skills"), null);
  assert.notEqual(escapingLink("a/link", "../../outside"), null);
  assert.notEqual(escapingLink("link", "/abs"), null);
});
```

```ts
// host/bundle.test.ts
test("writeBundle keeps the executable bit and writes links as links", async () => { /* file with executable: true → mode & 0o111 !== 0; symlink → readlink equals target */ });
test("writeBundle refuses the whole bundle when one entry escapes, and writes nothing", async () => { /* entries: ok file + "../x"; rejects; readdir(target) is [] */ });
test("writeBundle refuses to write through a link already in the target", async () => { /* target/sub is a link to elsewhere; entry "sub/file"; rejects; elsewhere is empty */ });
test("onlyIfAbsent: an identical file is 'same', a different one is 'kept' and untouched", async () => { /* … */ });
```

Write each body in full in the style of `server/progress/spec-copy.test.ts`. Every case uses a temp folder and checks the disk afterwards.

```ts
// server/content/make-bundle.test.ts
test("bundleFolder reads files, modes and links; the fixture course's largest lesson is far under the limit", async () => {
  const sandbox = await makeSandbox();
  const lesson = sandbox.course.lessons.find((entry) => entry.id === "002")!;
  const bundle = await bundleFolder(lesson.dir);
  assert.ok(bundle.entries.some((entry) => entry.path === "README.md"));
  assert.ok(bundleBytes(bundle) < MAX_BUNDLE_BYTES / 100);
  const standIns = await bundleFolder(join(sandbox.course.root, "stand-ins"));
  assert.equal(standIns.entries.find((entry) => entry.path === "plan-alpha-beta")?.kind === "file" && (standIns.entries.find((e) => e.path === "plan-alpha-beta") as { executable: boolean }).executable, true);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`. Expected: FAIL.

- [ ] **Step 3: Implement**

- `writeBundle` validates everything first: paths, links, duplicates, and with `kinds` that no parent of an entry is a link inside `target`.
- It writes files with `writeFile(path, data, { flag: onlyIfAbsent ? "wx" : "w", mode: executable ? 0o755 : 0o644 })`, creating parents with `mkdir` and never following a link.
- It writes links with `symlink(target, path)`.
- `bundleFolder` uses `readdir({ withFileTypes: true })` recursively and `lstat`. Its executable flag is `(mode & 0o111) !== 0`.

- [ ] **Step 4: Measure the real course**

With a checkout of the tutorial course, run:

```bash
node --experimental-strip-types -e 'import("./server/content/make-bundle.ts").then(async ({ bundleFolder }) => { const { bundleBytes } = await import("./shared/bundle.ts"); for (const d of process.argv.slice(1)) console.log(d, bundleBytes(await bundleFolder(d))); })' <course>/docs/iterations/* <course>/stand-ins <starter>
```

Record the largest lesson, the stand-ins and the starter (excluding `.git`, `.devcontainer`, `node_modules`) in the spike document. Expected: each well under 24 MiB, so there is no chunking. If one is over, stop and raise it; don't add chunking quietly.

- [ ] **Step 5: Run the tests and commit**

```bash
npm test
git add shared/bundle.ts shared/bundle.test.ts server/content/make-bundle.ts server/content/make-bundle.test.ts host/bundle.ts host/bundle.test.ts docs/2026-10-02-standalone-tutor-spike.md
git commit -m "Bundles: course files with modes and links, validated on the host"
```

### Task 10: `adoptLesson` on the host

**Files:**
- Move: `server/progress/spec-copy.ts` → `layouts/capstone-factory/spec-copy.ts`, and `server/progress/factory-move.ts` → `layouts/capstone-factory/factory-move.ts` (with their tests). They come off the guard's allowlist.
- Modify: `layouts/capstone-factory/spec-copy.ts` (stages from bundles: `stageLesson(lessonBundle, staging)` writes the bundle with `writeBundle`; `courseStandIns` becomes the `standIns` bundle or `null`; `requireFeatureFiles` checks the bundle for `features/*.feature`)
- Create: `layouts/capstone-factory/adopt.ts`
- Create: `host/lock.ts`
- Modify: `host/contract.ts`, `host.ts` (`adoptLesson`)
- Modify: `server/workspace/host-client.ts` (`adoptLesson`)
- Modify: `server/coach/tools.ts` (`applyOutcome`: a capstone adoption is one host call; layoutless and built-in adoptions write progress through `WorkspaceAccess` as in Task 5)
- Test: `layouts/capstone-factory/spec-copy.test.ts`, `factory-move.test.ts` (moved and adapted), `layouts/capstone-factory/adopt.test.ts`, `host/lock.test.ts`, `test/server.test.ts`, `test/starter.test.ts`

**Interfaces:**
- Consumes: `Bundle` and `writeBundle` (Task 9); `resolveLayout` and `LayoutProbe` (Task 4); `formatProgress` and `formatIteration` (moved in Task 4).
- Produces:

```ts
// host/contract.ts (add)
adoptLesson: {
  input: z.object({
    root: z.string().startsWith("/"),
    lesson: z.object({ id: lessonIdSchema, seedSpec: z.string().nullable() }),
    spec: bundleSchema,              // README.md, FACTORY.md?, features/**
    standIns: bundleSchema.nullable(),
    progress: progressFileSchema,    // already carried over by the server
    iteration: iterationStateSchema,
  }),
  output: z.object({ factoryShown: z.string(), moved: z.boolean(), note: z.string().nullable(), written: z.array(z.string()) }),
},

// layouts/capstone-factory/adopt.ts
/** The whole adoption, under the host lock: checks, the move at 004, spec/seed/stand-ins, then ITERATION and PROGRESS.yaml last. */
export async function adoptIntoWorkspace(input: AdoptLessonInput, probe: LayoutProbe): Promise<AdoptLessonOutput>;

// host/lock.ts
export function createHostLock(): { run<T>(key: string, work: () => Promise<T>): Promise<T> }; // same semantics as server/coach/keyed-lock.ts
```

- `adoptIntoWorkspace` keeps today's recovery behaviour unchanged: `recoverLeftovers`, a refusal leaving everything as it was, and a copy failing after the move leaving `factory/` at 003. It writes `PROGRESS.yaml` with `formatProgress(progress, existingText)` and `ITERATION` with `formatIteration`, in that order after the files, so `ITERATION` never names a lesson that isn't there.
- The server builds the bundles from the course on its side: `bundleFolder(lesson.dir, { skip: ["spec.md"] })` (the seed travels as `seedSpec`) and `bundleFolder(join(course.root, "stand-ins"))` when it exists.

- [ ] **Step 1: Move the tests, adapt them, and add the new ones**

Move `spec-copy.test.ts` and `factory-move.test.ts` with `git mv`. Wherever they passed `courseRoot`, have them build bundles with `bundleFolder` from the sandbox course. Then add:

```ts
// layouts/capstone-factory/adopt.test.ts
test("adoption writes spec/, the seed, stand-ins/, then PROGRESS.yaml and ITERATION, as one operation", async () => {
  // repo sandbox at 001 Done; adopt 002; assert files, ITERATION "002 WIP", PROGRESS.yaml iteration 002
});
test("a refusal (no feature files in the bundle) writes nothing, ITERATION and PROGRESS.yaml included", async () => {
  // snapshot the tree before and after; deepEqual
});
test("adopting 004 moves tetris/.factory to factory/ with git mv and re-links .claude/skills, then adopts there", async () => {
  // from factory-move.test.ts, now through adoptIntoWorkspace
});
test("a failure after the move leaves factory/ at 003 Done, and a second call adopts without moving again", async () => {
  // SpecCopyHooks.afterMovedAside throws once
});
```

```ts
// host/lock.test.ts
test("two adoptions of one workspace run one after the other", async () => { /* as keyed-lock.test.ts */ });
```

```ts
// test/server.test.ts (add)
test("the server never copies course files itself: a capstone adoption is a single adoptLesson host call", async (t) => {
  const sandbox = await makeRepoSandbox({ git: true });
  const calls: string[] = [];
  const host = await makeTutorHost(sandbox.course, sandbox.repoRoot, undefined, { onHostCall: (method) => calls.push(method) });
  // adopt 001 through the coach tool
  assert.deepEqual(calls.filter((method) => method !== "inspect"), ["adoptLesson"]);
  assert.match(await readFile(join(sandbox.factoryRoot, "ITERATION"), "utf8"), /^001 WIP/);
});

test("a host call that fails mid-adoption (machine gone) leaves the workspace as it was", async (t) => {
  // onHostCall throws WorkspaceUnreachableError for adoptLesson; tree snapshot unchanged; the tool refuses with the unreachable message
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`. Expected: FAIL.

- [ ] **Step 3: Implement**

- Move the files.
- Rewrite `stageLesson` and `stageStandIns` to `writeBundle(staging, bundle, { onlyIfAbsent: false })`.
- Write `adopt.ts` as `adoptLesson`'s body (formerly in `factory-move.ts`) plus the two progress writes.
- Register `adoptLesson` in `host.ts`, under `createHostLock().run(realpath(root), …)`.
- In `tools.ts`, replace `adoptLesson(...)`, `writeIteration` and `writeProgress` for capstone adoptions with one `rt.host.adoptLesson(hostId, input, { timeoutMs: 120_000 })`. The lesson's `git mv` and copies can pass 30 seconds on a slow disk, so the timeout is 2 minutes.

- [ ] **Step 4: Run everything, including the starter integration test where available**

Run: `npm run typecheck && npm test`. Then, if the checkouts are at hand, run `TUTOR_TEST_STARTER=… TUTOR_TEST_COURSE=… npm test -- test/starter.test.ts`.
Expected: PASS. Tutor still adopts 001 to 004 exactly as `fetch.sh` does.

- [ ] **Step 5: Check the Codespace walk, then commit**

Run `scripts/tutor-dev/e2e/run-all.sh`. Expected: PASS, through the move at 004.

```bash
git add -A layouts host host.ts server test
git commit -m "Adopt a capstone lesson as one host operation, from bundles"
```

### Task 11: `seedWorkspace` on the host

**Files:**
- Create: `host/seed.ts`
- Modify: `host/contract.ts`, `host.ts`, `server/workspace/host-client.ts`
- Test: `host/seed.test.ts`

**Interfaces:**
- Consumes: `writeBundle` (Task 9) and `createHostLock` (Task 10).
- Produces:

```ts
// host/contract.ts (add)
seedWorkspace: {
  input: z.object({ root: z.string().startsWith("/"), courseId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), ref: z.string(), bundle: bundleSchema }),
  output: z.object({ written: z.array(z.string()), same: z.array(z.string()), kept: z.array(z.string()), complete: z.literal(true) }),
},
// host/seed.ts
export async function seedWorkspace(input: SeedWorkspaceInput): Promise<SeedWorkspaceOutput>;
// marker: <root>/.tutor/seeds/<courseId>.json  { "ref": "...", "complete": true, "at": "<iso>" }
```

- A complete marker for the same `ref` means the call returns at once with `written: []`. A marker for another ref means the call seeds again with `onlyIfAbsent`, so a newer starter never overwrites the student's work.

- [ ] **Step 1: Write the failing tests**

```ts
// host/seed.test.ts
test("seeding writes the starter's files and a marker, and leaves .git alone", async () => { /* … */ });
test("an interrupted seed finishes on the next call: files already written are 'same', the rest are written", async () => {
  // first call with a writeBundle that throws after 2 files (inject via a hook option on seedWorkspace for tests); second call completes
});
test("a file the student already changed is kept, reported, and not overwritten", async () => { /* … */ });
test("a seed refuses a bundle with an escaping path and writes nothing, marker included", async () => { /* … */ });
```

Write each body in full.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`. Expected: FAIL.

- [ ] **Step 3: Implement**

Run under `lock.run(realpath(root))`: `writeBundle(root, bundle, { onlyIfAbsent: true })`, then write the marker atomically. Add a `hooks` option for tests only, mirroring `SpecCopyHooks`.

- [ ] **Step 4: Run them and commit**

```bash
npm test
git add host server/workspace/host-client.ts
git commit -m "Seed a workspace from a course's starter, resumably, on the host"
```

### Task 12: The coach file as content, and coach threads pinned to a provider

**Files:**
- Create: `server/coach/coach-text.ts`
- Modify: `server/coach/coach-file.ts` (returns `{ kind: "course"; text } | { kind: "workspace"; relativePath } | null`)
- Modify: `server/coach/prompts.ts` (`method()` inlines course text, or names the workspace path)
- Modify: `server/coach/configure.ts`, `world.ts` (`lastCoach` caches the method, not a path)
- Modify: `server/coach/settings.ts` (`coachProvider`: string, label "Coach agent", description "The agent provider coach threads use, such as pi. Empty uses BB's default.")
- Modify: `server/coach/threads.ts` (`SpawnCoach.providerId: string | null`)
- Modify: `skills/tutor/SKILL.md` ("Your coaching method is in your instructions")
- Test: `server/coach/prompts.test.ts`, `server/coach/coach-file.test.ts`, `server/coach/threads.test.ts`, `test/server.test.ts`

**Interfaces:**
- Produces:

```ts
// server/coach/coach-text.ts
export const MAX_COACH_TEXT = 48 * 1024;
export async function readCoachText(path: string): Promise<string>; // reads the course's coach file on the server; caps with "\n\n[The coaching method is longer than Tutor passes on; the rest is left out.]"

// server/coach/coach-file.ts
export type CoachMethod = { kind: "course"; text: string } | { kind: "workspace"; relativePath: string } | null;
export async function resolveCoachMethod(courseCoach: string | null, layout: CourseLayoutState, workspaceRoot: string, probe: LayoutProbe): Promise<CoachMethod>;

// server/coach/prompts.ts
export interface InstructionFacts { coach: CoachMethod; factory?: FactoryWhere | null }

// server/coach/threads.ts
export interface SpawnCoach { projectId: string; workspace: WorkspaceLocation; courseId: string; lessonId: string; prompt: string; providerId: string | null }
// spawn args when providerId !== null: { ..., providerId, executionInputSources: { providerId: "explicit" } }
```

- [ ] **Step 1: Write the failing tests**

```ts
// server/coach/prompts.test.ts (add)
test("the course's coach file reaches the agent as text, never as a server path", () => {
  const prompt = coachThreadPrompt(fixtureCourse, { kind: "course", text: "## Coaching process\nBaby steps." }, lesson1, "adopt");
  assert.match(prompt, /Baby steps\./);
  assert.doesNotMatch(prompt, /\/coach-me\.md|FIXTURE_COURSE_ROOT/);
});
test("the starter's coach-me skill is named by its path in the workspace", () => {
  const prompt = coachThreadPrompt(fixtureCourse, { kind: "workspace", relativePath: ".agents/skills/coach-me/SKILL.md" }, lesson1, "adopt");
  assert.match(prompt, /\.agents\/skills\/coach-me\/SKILL\.md/);
});
```

```ts
// server/coach/threads.test.ts (add)
test("a coach thread is pinned to the provider explicitly, so BB keeps it", async () => {
  const spawned: unknown[] = [];
  const sdk = { threads: { spawn: async (args: unknown) => (spawned.push(args), { id: "thr_1" }) } } as unknown as Sdk;
  await spawnCoachThread(sdk, { projectId: "p", workspace: { root: "/w", hostId: "h" }, courseId: "tutor", lessonId: "000", prompt: "x", providerId: "pi" });
  assert.deepEqual((spawned[0] as { providerId: string; executionInputSources: unknown }).executionInputSources, { providerId: "explicit" });
  assert.equal((spawned[0] as { providerId: string }).providerId, "pi");
});
test("without a coach provider, spawn passes none (the Codespace)", async () => { /* no providerId key */ });
```

```ts
// server/coach/coach-text.test.ts
test("a coach file over 48 KiB is cut with a note", async () => { /* … */ });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`. Expected: FAIL.

- [ ] **Step 3: Implement**

- `world.ts` resolves the method per course and keeps the last one for `configure`, which stays synchronous.
- `coachInstructions` prints `Coaching method:` followed by the text, or `Coaching method: the file <relativePath> in this workspace.`
- `register.ts`/`handlers.ts` read `coachProvider` from the settings and pass it to `spawnCoachThread`.

- [ ] **Step 4: Run everything, check the Codespace walk, and commit**

```bash
npm run typecheck && npm test && bb plugin build .
scripts/tutor-dev/e2e/run-all.sh   # coachProvider unset: unchanged
git add -A server skills test
git commit -m "Give the coach its method as text, and pin coach threads to a provider when set"
```

## Phase 4: Course fetching (spec Order 4)

### Task 13: Fetch a course: catalog, content store and `tutor_fetch_course`

**Files:**
- Create: `server/content/catalog.ts`, `server/content/fetch.ts`, `server/content/store.ts`
- Modify: `server/course/manifest.ts` (`starter: { repo: string; ref: string; exclude?: string[] }` optional in course.yaml)
- Modify: `server/coach/world.ts` (course sources in order: the configured course, else every fetched course from the store)
- Modify: `server/coach/course-path.ts` (`resolveConfiguredCourse` returns `null` when only the default path applies and it doesn't exist)
- Modify: `server/coach/settings.ts` (`courseCatalog`: string, a JSON catalog override)
- Modify: `shared/constants.ts` (`TOOL_NAMES.fetchCourse = "tutor_fetch_course"`)
- Modify: `shared/tools.ts` (schema `{ course: string }`)
- Modify: `server/coach/tools.ts` (registers it; allowed from any Tutor coach thread)
- Modify: `shared/rpc.ts` (`fetchCourse: { input: { courseId }, output: { courseId, firstLessonId, seeded: { written: number; kept: string[] } } }`; `Overview.available: { id, title, description }[]`)
- Modify: `server/rpc/handlers.ts` (`fetchCourse`)
- Modify: `skills/tutor/SKILL.md` (when to call `tutor_fetch_course`)
- Test: `server/content/catalog.test.ts`, `server/content/fetch.test.ts`, `test/server.test.ts`

**Interfaces:**
- Consumes: `seedWorkspace` (Task 11) and `bundleFolder` (Task 9).
- Produces:

```ts
// server/content/catalog.ts
export interface CatalogEntry { id: string; title: string; description: string; repo: string; ref: string }
/** The tutorial's commit Tutor fetches: its main at the time of this task (`git ls-remote …/tutorial.git main`), re-pinned to a tag in Task 23. */
export const TUTORIAL_REF = "<40-hex SHA from git ls-remote>";
export const BUILT_IN_CATALOG: readonly CatalogEntry[] = [
  { id: "software-factory", title: "Build a software factory", description: "Seven lessons, one factory.", repo: "https://github.com/lean-software-production/tutorial.git", ref: TUTORIAL_REF },
];
/** The courseCatalog setting when it parses as a catalog, else BUILT_IN_CATALOG. Refs must be tags (v*) or 40-hex SHAs. */
export function catalogFrom(setting: string | undefined): readonly CatalogEntry[];

// server/content/fetch.ts
/** Clones `repo` at `ref` into `dest` (shallow); an existing clone at the same ref is kept. */
export async function fetchRepo(repo: string, ref: string, dest: string): Promise<void>;

// server/content/store.ts
export interface ContentStore {
  root: string;                                  // <BB data dir>/content
  fetched(): Promise<{ id: string; coursePath: string; starterPath: string | null; ref: string }[]>;
  fetch(entry: CatalogEntry): Promise<{ coursePath: string; starterPath: string | null }>; // course, then the starter course.yaml names
}
export function createContentStore(dataDir: string): ContentStore;
```

- **The `fetchCourse` flow.** Every step runs under the workspace lock:
  1. `store.fetch(entry)`.
  2. `loadCourse(coursePath)`.
  3. If the course has a starter, bundle it with `bundleFolder(starterPath, { skip: [".git", ".devcontainer", ".github", ...starter.exclude] })` and call `host.seedWorkspace(hostId, { root, courseId, ref, bundle }, { timeoutMs: 120_000 })`.
  4. Publish `"course"`.

  It is refused when a configured course is set (Decision 12), with "This Tutor uses the course it was set up with."
- **`tutor_fetch_course`** runs the same flow. It returns: `Added "<title>". Its lessons follow Lesson 0 in the outline. <n> starter files are now in your workspace; commit them ("Add the <title> starter") before you start its first lesson.` When files were kept, it adds `These files were already there and were kept: …`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/content/catalog.test.ts
test("the built-in catalog pins a full SHA or a tag", () => {
  assert.match(TUTORIAL_REF, /^([0-9a-f]{40}|v\d+\.\d+\.\d+)$/);
});

test("a catalog override must pin refs to tags or full SHAs", () => {
  assert.throws(() => catalogFrom(JSON.stringify([{ id: "c", title: "C", description: "", repo: "file:///x", ref: "main" }])), /tag or a full SHA/);
  assert.equal(catalogFrom(undefined), BUILT_IN_CATALOG);
});
```

```ts
// server/content/fetch.test.ts
test("fetchRepo clones a local repo at a tag, and a second fetch at the same ref is a no-op", async () => {
  // git init a temp repo, commit, tag v1; fetchRepo(file://…, "v1", dest); HEAD matches; mtime of dest/.git/HEAD unchanged on the second call
});
```

```ts
// test/server.test.ts (add)
test("nothing from a course is on the computer until it is added; adding it seeds the workspace and lists its lessons after Lesson 0", async (t) => {
  const { catalogJson, courseRepo } = await makeFixtureCourseRepo({ layout: "capstone-factory", starter: true }); // file:// repos, tagged v1
  const dataDir = await mkdtemp(join(tmpdir(), "bbdata-"));
  const ws = await emptyGitWorkspace();
  const host = await makeTutorHost(null, ws, { workspaceProject: PROJECT_ID, courseCatalog: catalogJson }, { dataDir });
  assert.deepEqual(await readdir(join(dataDir, "content")).catch(() => []), []);
  const before = await host.harness.rpc.call("getOverview", null);
  assert.deepEqual(before.available.map((entry) => entry.id), ["fixture"]);
  await host.harness.rpc.call("fetchCourse", { courseId: "fixture" });
  const after = await host.harness.rpc.call("getOverview", null);
  assert.deepEqual(after.courses.map((entry) => entry.course.id), ["tutor", "fixture"]);
  assert.ok((await readdir(join(ws, "tetris"))).includes(".factory"));
  assert.equal(after.courses[1]?.layout.ready, true);
});

test("with a configured course, fetching is refused and nothing is offered", async (t) => { /* coursePath setting set; available is []; fetchCourse rejects */ });
```

`makeFixtureCourseRepo` is a new helper in `test/helpers/disk.ts`. It writes `fixtureCourse` with `writeCourse`, adds `course.yaml` with `layout` and `starter`, and makes a starter repo holding `tetris/.factory/AGENTS.md` and `.agents/skills/coach-me/SKILL.md`. It commits and tags both, and returns a catalog JSON naming them by `file://` URL.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`. Expected: FAIL.

- [ ] **Step 3: Implement**

- `fetchRepo` runs `git clone --depth 1 --branch <ref> <repo> <dest>` for tags, and `git init` + `git fetch --depth 1 origin <sha>` + `git checkout FETCH_HEAD` for SHAs. Each uses `execFile`, never a shell, with `GIT_TERMINAL_PROMPT=0`.
- The store lays out `<dataDir>/content/<id>/course` and `/starter`, plus `<id>/fetched.json` with `{ ref }`. The data dir is `bb.server.experimental_dataDir`.
- `world.ts` uses the configured course if any. Otherwise it uses the store's fetched courses, in fetch order.

- [ ] **Step 4: Run everything and commit**

```bash
npm run typecheck && npm test
git add -A server shared skills test
git commit -m "Fetch a course on request: catalog, content store, seeding and tutor_fetch_course"
```

### Task 14: "Add the course" in the outline

**Files:**
- Modify: `app/model/outline.ts` (an `add-course` row after the built-in group, one per `available` entry; hidden when `available` is empty)
- Modify: `app/ui/Outline.tsx` (the row: title, one line, button "Add the course"; busy and error states as other outline actions)
- Modify: `app/model/home.ts` (`continueView` points at "Add the course" once Lesson 0 is done and nothing has been fetched)
- Modify: `app/styles/outline.css` (layout only; `--tp-*` tokens)
- Test: `app/model/outline.test.ts`, `app/model/views.test.ts`, `app/styles/outline-scope.test.ts` (already runs), `app/voice.test.ts`

**Interfaces:**
- Consumes: `Overview.available` and the `fetchCourse` RPC (Task 13).
- Produces: `OutlineRow` gains `{ kind: "add-course"; courseId: string; title: string; description: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/model/outline.test.ts (add)
test("the outline offers each course that can be added, right after Lesson 0", () => {
  const view = outlineView({ ...overviewWith([builtinCourseOverview]), available: [{ id: "software-factory", title: "Build a software factory", description: "Seven lessons, one factory." }] }, null);
  assert.deepEqual(view.rows.map((row) => row.kind).slice(0, 2), ["lesson", "add-course"]);
});
test("once added, a course's lessons replace its Add row", () => { /* available [] and courses has it */ });
```

```ts
// app/model/views.test.ts (add)
test("after Lesson 0, BB home's Continue suggests adding the course", () => { /* continueView → kind "add-course" */ });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test 2>&1 | grep -E "^not ok"`. Expected: FAIL.

- [ ] **Step 3: Implement**

On click, call `rpc.call("fetchCourse", { courseId })`, and on success navigate to `start/<courseId>/<firstLessonId>`. The copy follows `vendor/brand/VOICE.md`. Let `app/voice.test.ts` judge the wording.

- [ ] **Step 4: Run everything, look at it, and commit**

Run: `npm run typecheck && npm test && bb plugin build .`. Then, in the tutor-dev harness with no course configured (`scripts/tutor-dev/up.sh`, `install-plugin.sh .`, then unset the course), take a screenshot of the outline with `scripts/tutor-dev/shot.mjs` and look at it.

```bash
git add -A app
git commit -m "Offer Add the course in the outline after Lesson 0"
```

## Phase 5: The launcher (spec Order 5)

All launcher tasks share one harness: `standalone/test/helper.bash`.
- It points `HOME` at a temp dir.
- It puts `standalone/test/stubs` first on `PATH`.
- It sources `standalone/tutor` with `TUTOR_SOURCE_ONLY=1`.
- It gives each stub a log (`$STUB_LOG/<name>`) that records argv and selected environment variables, and lets a test script the stub's behaviour through `STUB_<NAME>_*` variables.

The stubs are `npm`, `node`, `git`, `curl`, `systemctl`, `launchctl`, `uname`, `bb`, `bb-server`, `pi`, `PlistBuddy`, `ss`, `lsof` and `open`/`xdg-open`.

CI gains a `launcher` job (`sudo apt-get install -y bats`, then `bats standalone/test`).

### Task 15: Launcher skeleton: prerequisites, state, quiet output, the name in one place

**Files:**
- Create: `standalone/tutor`
- Create: `standalone/test/helper.bash`, `standalone/test/stubs/*`
- Create: `standalone/test/skeleton.bats`
- Modify: `test/pins.test.ts` (the launcher's `BB_VERSION` equals the pinned BB)
- Modify: `.github/workflows/ci.yaml` (the `launcher` job)

**Interfaces:**
- Produces these shell functions, which later tasks call:

```sh
TUTOR_NAME=tutor                      # the command's name; a course brand renames it here
TUTOR_VERSION=0.0.0-dev               # stamped at release (Task 20)
BB_VERSION=0.44.0
TUTOR_PORT_DEFAULT=47386
TUTOR_HOME="${TUTOR_HOME:-$HOME/.tutor}"

say()          # one line to stdout, the student's voice; never names BB
fail()         # say to stderr and exit 1
log()          # append to $TUTOR_HOME/logs/launcher.log with a timestamp
config_get()   # config_get <key>: value from $TUTOR_HOME/config, or empty; grep, never sourced
config_set()   # config_set <key> <value>: atomic rewrite of $TUTOR_HOME/config (0600)
os_kind()      # "linux" | "macos"; fail with "Tutor runs on macOS and Linux." otherwise
check_prereqs()# Node 22.19+, 24 or 26; npm; git; each failure names what to install
tutor_bb()     # BB_DATA_DIR="$TUTOR_HOME/server" "$TUTOR_HOME/server/npm/node_modules/.bin/bb" "$@" >>launcher.log 2>&1
main()         # dispatch: up | login | open | status | stop | logs | uninstall | help
```

- [ ] **Step 1: Write the failing bats tests**

```bash
# standalone/test/skeleton.bats
load helper

@test "refuses Windows and other systems" {
  STUB_UNAME=MINGW64_NT run tutor up "$HOME/course"
  [ "$status" -eq 1 ]; [[ "$output" == *"Tutor runs on macOS and Linux."* ]]
}

@test "names what to install when Node is too old, and accepts 22.19, 24 and 26" {
  STUB_NODE_VERSION=v22.18.0 run check_prereqs
  [ "$status" -eq 1 ]; [[ "$output" == *"Node 22.19 or newer"* ]]
  for v in v22.19.0 v24.1.0 v26.0.0; do STUB_NODE_VERSION=$v run check_prereqs; [ "$status" -eq 0 ]; done
}

@test "names git and npm when missing" {
  STUB_MISSING="git npm" run check_prereqs
  [[ "$output" == *"git"* && "$output" == *"npm"* ]]
}

@test "the config file is read without being run" {
  mkdir -p "$TUTOR_HOME"; printf 'port=47386\nworkspace=$(touch %s/pwned)\n' "$HOME" > "$TUTOR_HOME/config"
  run config_get workspace
  [ ! -e "$HOME/pwned" ]; [ "$output" = '$(touch '"$HOME"'/pwned)' ]
}

@test "config_set keeps other keys and leaves the file 0600" {
  config_set port 47386; config_set workspace "$HOME/My Course"
  [ "$(config_get port)" = 47386 ]; [ "$(config_get workspace)" = "$HOME/My Course" ]
  [ "$(stat -c %a "$TUTOR_HOME/config" 2>/dev/null || stat -f %Lp "$TUTOR_HOME/config")" = 600 ]
}

@test "tutor up --server is reserved and refused" {
  run tutor up --server https://example.com
  [ "$status" -eq 1 ]; [[ "$output" == *"not available yet"* ]]
}

@test "help uses the name variable" {
  TUTOR_NAME=coach run tutor help
  [[ "$output" == *"coach up"* ]]; [[ "$output" != *"tutor up"* ]]
}

@test "nothing the launcher prints says bb" {
  run tutor help
  ! printf '%s' "$output" | grep -iqw bb
}
```

`helper.bash` defines `tutor() { main "$@"; }`, so the tests run in the sourced shell.

```ts
// test/pins.test.ts (add)
test("the launcher installs the BB the plugin is pinned to", async () => {
  const launcher = await readFile("standalone/tutor", "utf8");
  assert.match(launcher, new RegExp(`^BB_VERSION=${BB.replace(/\./g, "\\.")}$`, "m"));
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bats standalone/test/skeleton.bats`. Expected: FAIL, because `standalone/tutor` is missing.

- [ ] **Step 3: Implement**

Write `standalone/tutor`:
- Start with `#!/bin/sh` and `set -eu`, then the constants, then the functions above, then `[ "${TUTOR_SOURCE_ONLY:-}" = 1 ] || main "$@"`.
- Use no bashisms: CI runs `checkbashisms` from the `devscripts` package as a step of the `launcher` job, and so does the test.
- `check_prereqs` parses `node --version` with `sed` and compares the major and minor numbers.
- `config_set` writes to `config.tmp` with `umask 077`, then `mv`.

- [ ] **Step 4: Run them and commit**

```bash
bats standalone/test && npm test
git add standalone/tutor standalone/test .github/workflows/ci.yaml test/pins.test.ts
git commit -m "Launcher skeleton: prerequisites, state file, quiet output"
```

### Task 16: The tutor server: install, service, configure, plugin

**Files:**
- Modify: `standalone/tutor` (functions `server_install`, `server_service_write`, `server_start`, `server_wait_healthy`, `server_configure`, `plugin_install`)
- Create: `standalone/test/server.bats`

**Interfaces:**
- Consumes: from the spike document (Task 1), `BB_SERVER_HEALTH_PATH`, `BB_SET_MACHINE_URL` and `BB_CLI_ENV`.
- Produces:

```sh
server_install()          # npm install --prefix "$TUTOR_HOME/server/npm" "bb-app@$BB_VERSION" --allow-scripts=better-sqlite3,node-pty,@parcel/watcher; skipped when installed at BB_VERSION
server_service_write()    # linux: ~/.config/systemd/user/tutor-server.service; macos: ~/Library/LaunchAgents/com.leansoftwareproduction.tutor-server.plist
server_start()            # systemctl --user daemon-reload && enable --now tutor-server | launchctl bootstrap gui/$(id -u) <plist>
server_wait_healthy()     # curl -fsS http://127.0.0.1:$port<health path>, up to 60 s; fail "Tutor's server didn't start. Run `tutor logs`."
server_configure()        # tutor_bb settings general machineServerUrl http://127.0.0.1:$port; tutor_bb settings general defaultMachineAccess direct
plugin_install()          # tutor_bb plugin install "$TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION" ; tutor_bb plugin config tutor set coachProvider pi
```

- The unit runs `ExecStart=<abs node> <abs bb-server> --data-dir <abs ~/.tutor/server> --server-bind-host 127.0.0.1 --server-port <port>`. It sets `Environment=PATH=<node's dir>:/usr/bin:/bin` and `Restart=on-failure`.
- Paths go into the unit with systemd quoting (`"…"` with `\"` and `\\` escaped). In the plist they go in as XML-escaped `<string>`s.
- `~/.tutor/server` is created `0700`.

- [ ] **Step 1: Write the failing tests**

```bash
# standalone/test/server.bats
load helper

@test "the server listens on 127.0.0.1 only, on the chosen port" {
  STUB_UNAME=Linux server_service_write 47390
  grep -q -- '--server-bind-host 127.0.0.1' ~/.config/systemd/user/tutor-server.service
  grep -q -- '--server-port 47390' ~/.config/systemd/user/tutor-server.service
}

@test "a home folder with spaces is quoted in the unit and the plist" {
  export HOME="$BATS_TEST_TMPDIR/Jo Bloggs"; mkdir -p "$HOME"; TUTOR_HOME="$HOME/.tutor"
  STUB_UNAME=Linux server_service_write 47386
  grep -q -- '--data-dir "'"$HOME"'/.tutor/server"' ~/.config/systemd/user/tutor-server.service
  STUB_UNAME=Darwin server_service_write 47386
  grep -q "<string>$HOME/.tutor/server</string>" ~/Library/LaunchAgents/com.leansoftwareproduction.tutor-server.plist
}

@test "bb-app is installed once, at the pinned version, with the native scripts allowed" {
  server_install; server_install
  [ "$(grep -c 'install' "$STUB_LOG/npm")" -eq 1 ]
  grep -q "bb-app@0.44.0" "$STUB_LOG/npm"
  grep -q "allow-scripts=better-sqlite3,node-pty,@parcel/watcher" "$STUB_LOG/npm"
}

@test "the server is configured with 127.0.0.1, never localhost" {
  server_configure 47386
  grep -q "machineServerUrl http://127.0.0.1:47386" "$STUB_LOG/bb"
  ! grep -q localhost "$STUB_LOG/bb"
}

@test "the server's data folder is private" {
  server_prepare_dirs
  [ "$(stat -c %a "$TUTOR_HOME/server" 2>/dev/null || stat -f %Lp "$TUTOR_HOME/server")" = 700 ]
}

@test "a server that never gets healthy fails with a pointer to tutor logs, and no bb" {
  STUB_CURL_FAIL=1 TUTOR_HEALTH_TIMEOUT=2 run server_wait_healthy 47386
  [ "$status" -eq 1 ]; [[ "$output" == *"tutor logs"* ]]; ! printf '%s' "$output" | grep -iqw bb
}

@test "the plugin comes from the release archive, never the network, and coach threads are pinned to pi" {
  plugin_install
  grep -q "plugin install $TUTOR_HOME/releases/" "$STUB_LOG/bb"
  ! grep -q "git:" "$STUB_LOG/bb"
  grep -q "plugin config tutor set coachProvider pi" "$STUB_LOG/bb"
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bats standalone/test/server.bats`. Expected: FAIL.

- [ ] **Step 3: Implement the functions**

`plugin_install` extracts `bb-plugin-tutor-$TUTOR_VERSION.tgz` (carried in `releases/`, Task 20) once into `releases/<v>/bb-plugin-tutor-<v>/`, then installs from that path.

- [ ] **Step 4: Run them and commit**

```bash
bats standalone/test
git add standalone
git commit -m "Launcher: install, run and configure the tutor server as a user service"
```

### Task 17: The machine: enrolment in the background

**Files:**
- Modify: `standalone/tutor` (`machine_enrol`, `machine_installer_run`, `machine_wait_connected`, `machine_id`)
- Create: `standalone/test/machine.bats`

**Interfaces:**
- Consumes: from the spike document (Task 1), `BB_ENROL_LINE_PATTERN` and `MACHINE_UNINSTALL`.
- Produces:

```sh
machine_enrol()        # bb machine create --provider manual --key tutor-machine in the background (output → $TUTOR_HOME/enrol.out, 0600);
                       # poll enrol.out for the enrolment line (up to 60 s); write "X-BB-Enrollment: <token>" to $TUTOR_HOME/enrol.header (0600);
                       # curl -fsSL -H @"$TUTOR_HOME/enrol.header" "<url>" -o "$TUTOR_HOME/machine-installer.sh"; sh it, output → $TUTOR_HOME/install.log;
                       # wait for the background create to exit 0; rm enrol.header and enrol.out; config_set machine_id …
                       # if the installer says the enrolment expired, or create exits non-zero: retry once from the top; then fail.
machine_wait_connected() # tutor_bb machine list --json shows machine_id connected, up to 60 s
```

- [ ] **Step 1: Write the failing tests**

```bash
# standalone/test/machine.bats
load helper

@test "machine create runs in the background, so waiting on it can't deadlock" {
  STUB_BB_CREATE_BLOCKS_UNTIL_INSTALLED=1 run machine_enrol
  [ "$status" -eq 0 ]
  grep -q "machine create --provider manual --key tutor-machine" "$STUB_LOG/bb"
}

@test "the enrolment header never reaches arguments, output or logs" {
  STUB_ENROL_TOKEN=s3cr3t-token run machine_enrol
  ! grep -rq s3cr3t-token "$STUB_LOG" "$TUTOR_HOME/logs" ; ! printf '%s' "$output" | grep -q s3cr3t-token
  grep -q -- '-H @' "$STUB_LOG/curl"
  [ ! -e "$TUTOR_HOME/enrol.header" ]
}

@test "the header file is 0600 while it exists" {
  STUB_CURL_HOOK='stat -c %a "$TUTOR_HOME/enrol.header" 2>/dev/null || stat -f %Lp "$TUTOR_HOME/enrol.header"' run machine_enrol
  grep -qx 600 "$STUB_LOG/curl-hook"
}

@test "an expired enrolment starts again from machine create, once" {
  STUB_INSTALLER_EXPIRED_TIMES=1 run machine_enrol
  [ "$status" -eq 0 ]; [ "$(grep -c 'machine create' "$STUB_LOG/bb")" -eq 2 ]
}

@test "two expiries in a row fail with what to do" {
  STUB_INSTALLER_EXPIRED_TIMES=2 run machine_enrol
  [ "$status" -eq 1 ]; [[ "$output" == *"Run tutor up again"* ]]
}

@test "the installer's output goes to install.log, not the screen" {
  run machine_enrol
  grep -q "installer says hello" "$TUTOR_HOME/install.log"; [[ "$output" != *"installer says hello"* ]]
}
```

The `bb` stub: for `machine create`, it writes `curl -H 'X-BB-Enrollment: $STUB_ENROL_TOKEN' http://127.0.0.1:47386/install.sh | sh` to stdout and then blocks until `$HOME/.stub-installed` exists. The `curl` stub writes an installer that prints "installer says hello", touches `.stub-installed`, and exits 3 with "enrollment expired" while `STUB_INSTALLER_EXPIRED_TIMES` remains.

- [ ] **Step 2: Run them and watch them fail**

Run: `bats standalone/test/machine.bats`. Expected: FAIL.

- [ ] **Step 3: Implement, keeping the token out of argv**

Extract the token with `sed` from `enrol.out` straight into the header file (`umask 077`). It never goes into a shell variable that is then passed as an argument.

- [ ] **Step 4: Run them and commit**

```bash
bats standalone/test
git add standalone
git commit -m "Launcher: enrol the machine without exposing its one-time header"
```

### Task 18: pi, the workspace project, login and open

**Files:**
- Modify: `standalone/tutor` (`pi_install`, `machine_env_apply`, `workspace_prepare`, `project_ensure`, `pi_ready`, `cmd_login`, `cmd_open`, `cmd_up`)
- Create: `standalone/test/pi.bats`, `standalone/test/up.bats`

**Interfaces:**
- Consumes: from the spike document (Task 1), `PI_PACKAGE`, `PI_VERSION`, `PI_LOGIN`, `PI_READY`, `MACHINE_UNIT_GLOB` and `MACHINE_PLIST_GLOB`, plus whichever fallback branch Task 1 took.
- Produces:

```sh
pi_install()          # npm install --prefix "$TUTOR_HOME/pi-npm" "$PI_PACKAGE@$PI_VERSION"; ln -sf …/.bin/pi "$TUTOR_HOME/bin/pi"; mkdir -m 700 "$TUTOR_HOME/pi"
machine_env_apply()   # linux: <unit>.d/tutor.conf with Environment="PI_CODING_AGENT_DIR=…" Environment="BB_PI_BRIDGE_COMMAND=…"; daemon-reload; restart
                      # macos: PlistBuddy Add/Set :EnvironmentVariables:… on the machine plist; launchctl bootout + bootstrap
                      # prints nothing; returns 0 when already applied (no restart)
workspace_prepare()   # mkdir -p; refuse (Decision 18) and refuse a non-empty folder without .tutor/ or a .git only; git init when no .git
project_ensure()      # tutor_bb project create --name "<basename>" --root "<abs folder>" --machine "$(config_get machine_id)" --json → project id;
                      # tutor_bb plugin config tutor set workspaceProject <id>; config_set workspace, project_id
pi_ready()            # per PI_READY; exit 0 when signed in
cmd_login()           # PI_CODING_AGENT_DIR="$TUTOR_HOME/pi" "$TUTOR_HOME/bin/pi" per PI_LOGIN (interactive; stdin is the terminal)
cmd_open()            # xdg-open / open http://127.0.0.1:$port
cmd_up()              # check_prereqs → workspace_prepare → server_* → plugin_install → machine_enrol (unless machine_id connected) → pi_install → machine_env_apply → project_ensure → pi_ready || say "Run `tutor login` to connect Tutor to a model provider" → cmd_open
```

- [ ] **Step 1: Write the failing tests**

```bash
# standalone/test/pi.bats
load helper

@test "the machine service gets Tutor's pi, as absolute paths, on Linux" {
  STUB_UNAME=Linux; make_stub_machine_unit
  machine_env_apply
  grep -q "Environment=\"PI_CODING_AGENT_DIR=$TUTOR_HOME/pi\"" ~/.config/systemd/user/*.service.d/tutor.conf
  grep -q "Environment=\"BB_PI_BRIDGE_COMMAND=$TUTOR_HOME/bin/pi\"" ~/.config/systemd/user/*.service.d/tutor.conf
  grep -q "restart" "$STUB_LOG/systemctl"
}

@test "on macOS the variables go into the machine's plist and the agent is reloaded" {
  STUB_UNAME=Darwin; make_stub_machine_plist
  machine_env_apply
  grep -q "EnvironmentVariables:PI_CODING_AGENT_DIR string $TUTOR_HOME/pi" "$STUB_LOG/PlistBuddy"
  grep -q "bootstrap" "$STUB_LOG/launchctl"
}

@test "applying twice restarts once" {
  STUB_UNAME=Linux; make_stub_machine_unit
  machine_env_apply; machine_env_apply
  [ "$(grep -c restart "$STUB_LOG/systemctl")" -eq 1 ]
}

@test "~/.pi is never touched" {
  mkdir -p ~/.pi/agent; echo '{"x":1}' > ~/.pi/agent/auth.json; before=$(cksum < ~/.pi/agent/auth.json)
  pi_install; STUB_UNAME=Linux; make_stub_machine_unit; machine_env_apply; cmd_login </dev/null || true
  [ "$(cksum < ~/.pi/agent/auth.json)" = "$before" ]
  grep -q "PI_CODING_AGENT_DIR=$TUTOR_HOME/pi" "$STUB_LOG/pi"
}
```

```bash
# standalone/test/up.bats
load helper

@test "a first tutor up does every step and ends at the browser" {
  run tutor up "$HOME/my-course"
  [ "$status" -eq 0 ]
  [ -d "$HOME/my-course/.git" ]; [ "$(ls -A "$HOME/my-course")" = ".git" ]
  grep -q "project create --name my-course --root $HOME/my-course" "$STUB_LOG/bb"
  grep -q "plugin config tutor set workspaceProject prj_stub" "$STUB_LOG/bb"
  grep -q "http://127.0.0.1:47386" "$STUB_LOG/xdg-open"
  ! printf '%s' "$output" | grep -iqw bb
}

@test "without pi signed in, up still finishes and says to run tutor login" {
  STUB_PI_SIGNED_IN=0 run tutor up "$HOME/my-course"
  [ "$status" -eq 0 ]; [[ "$output" == *"Run \`tutor login\` to connect Tutor to a model provider"* ]]
}

@test "a workspace path with spaces and accents works end to end" {
  run tutor up "$HOME/My Études"
  [ "$status" -eq 0 ]; grep -q -- "--root $HOME/My Études" "$STUB_LOG/bb"
}

@test "a folder that is neither empty nor a Tutor workspace is refused, and left alone" {
  mkdir -p "$HOME/stuff"; echo keep > "$HOME/stuff/notes.txt"
  run tutor up "$HOME/stuff"
  [ "$status" -eq 1 ]; [ "$(ls -A "$HOME/stuff")" = "notes.txt" ]
}

@test "home itself, ~/.tutor and the machine folder are refused" {
  for d in "$HOME" "$HOME/.tutor/x" "$HOME/.bb-machines/x"; do run tutor up "$d"; [ "$status" -eq 1 ]; done
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bats standalone/test/pi.bats standalone/test/up.bats`. Expected: FAIL.

- [ ] **Step 3: Implement**

`machine_env_apply` finds the machine's unit or plist by grepping `MACHINE_UNIT_GLOB`/`MACHINE_PLIST_GLOB` for `.bb-machines/127.0.0.1-$port`. If none is found, it fails with "Tutor's machine service is missing. Run `tutor up` again."

- [ ] **Step 4: Run them and commit**

```bash
bats standalone/test
git add standalone
git commit -m "Launcher: Tutor's own pi, the workspace project, login and open"
```

### Task 19: `status`, `stop`, `logs`, `uninstall`, and repair on re-run

**Files:**
- Modify: `standalone/tutor` (`cmd_status`, `cmd_stop`, `cmd_logs`, `cmd_uninstall`, plus the skip/repair logic in `cmd_up`)
- Create: `standalone/test/lifecycle.bats`

**Interfaces:**
- Consumes: everything above. `MACHINE_UNINSTALL` comes from the spike document.
- Produces:

```sh
cmd_status()    # lines: "Server: healthy|stopped", "Machine: connected|not connected", "Workspace: <path>", "Model provider: signed in|not signed in — run `tutor login`",
                # "Listening: 127.0.0.1 only" or "Listening: also on <addr> — this is unexpected" (ss -ltnp / lsof -iTCP -sTCP:LISTEN for the two services' PIDs)
cmd_stop()      # stop both services (systemctl --user stop tutor-server <machine unit> | launchctl bootout); keep everything
cmd_logs()      # tail -n 200 of ~/.tutor/server/logs/server-stdio.log, the machine's logs/host-daemon-stdio.log, ~/.tutor/install.log; these say "bb", by design
cmd_uninstall() # tutor_bb machine remove <id> --yes; MACHINE_UNINSTALL; stop + remove the server service file; with --purge: rm -rf ~/.tutor and ~/.bb-machines/127.0.0.1-<port>; never the workspace
```

- [ ] **Step 1: Write the failing tests**

```bash
# standalone/test/lifecycle.bats
load helper

setup_done() { tutor up "$HOME/my-course" >/dev/null; : >"$STUB_LOG/bb"; : >"$STUB_LOG/npm"; : >"$STUB_LOG/systemctl"; }

@test "a second tutor up skips what's done: no reinstall, no new enrolment, no new project" {
  setup_done; run tutor up
  [ "$status" -eq 0 ]
  ! grep -q install "$STUB_LOG/npm"; ! grep -q "machine create" "$STUB_LOG/bb"; ! grep -q "project create" "$STUB_LOG/bb"
}

@test "tutor up restarts a stopped server and repairs Tutor's pi settings after an update rewrote the machine unit" {
  setup_done; rm ~/.config/systemd/user/*.service.d/tutor.conf; STUB_SERVER_STOPPED=1
  run tutor up
  [ "$status" -eq 0 ]; ls ~/.config/systemd/user/*.service.d/tutor.conf; grep -q "start tutor-server\|enable --now tutor-server" "$STUB_LOG/systemctl"
}

@test "status reports each part, and flags a listener off loopback" {
  setup_done; STUB_LISTEN="0.0.0.0:47386" run tutor status
  [[ "$output" == *"Server: healthy"* && "$output" == *"Machine: connected"* && "$output" == *"also on 0.0.0.0:47386"* ]]
  ! printf '%s' "$output" | grep -iqw bb
}

@test "stop keeps everything; up brings back the same workspace and project" {
  setup_done; tutor stop >/dev/null; run tutor up
  [ "$(config_get project_id)" = prj_stub ]; [ -d "$HOME/my-course/.git" ]
}

@test "uninstall --purge removes Tutor's files, the services and the machine folder, and leaves the workspace as it was" {
  setup_done; echo work > "$HOME/my-course/mine.txt"; before=$(cd "$HOME/my-course" && find . | sort | cksum)
  run tutor uninstall --purge
  [ ! -e "$TUTOR_HOME" ]; [ ! -e "$HOME/.bb-machines/127.0.0.1-47386" ]
  [ ! -e ~/.config/systemd/user/tutor-server.service ]
  grep -q -- "--uninstall" "$STUB_LOG/machine-installer"
  [ "$(cd "$HOME/my-course" && find . | sort | cksum)" = "$before" ]
}

@test "logs is the one command that may say bb" {
  setup_done; run tutor logs; [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bats standalone/test/lifecycle.bats`. Expected: FAIL.

- [ ] **Step 3: Implement**

In `cmd_up`, each step first checks its own completion: the installed version, the service file present and active, `machine_id` set and connected, `machine_env_apply`'s own check, `project_id` set and present (`tutor_bb project show`), and `workspaceProject` equal to it.

- [ ] **Step 4: Run them and commit**

```bash
bats standalone/test
git add standalone
git commit -m "Launcher: status, stop, logs, uninstall, and repair on every tutor up"
```

### Task 20: `install.sh` and the release assets

**Files:**
- Create: `standalone/install.sh`
- Create: `scripts/release-standalone.sh` (stamps `TUTOR_VERSION` into a copy of `standalone/tutor` and writes `install.sh` with the version)
- Modify: `.github/workflows/release.yaml` (attach `install.sh`, `tutor`, `bb-plugin-tutor-<v>.tgz` and their `.sha256`)
- Modify: `.gitattributes` (`/standalone/ export-ignore`), `scripts/check-release-archive.sh` (expects `dist/host.js`)
- Modify: `standalone/tutor` (`releases_ensure`: the plugin archive comes from `$TUTOR_HOME/releases/$TUTOR_VERSION/`, which `install.sh` filled)
- Create: `standalone/test/install.bats`

**Interfaces:**
- Produces: `install.sh`, which is fetched from `…/releases/latest/download/install.sh`. It works as follows.
  1. It downloads `tutor`, the plugin archive and `SHA256SUMS` for its own version.
  2. It verifies them with `sha256sum -c`, or `shasum -a 256 -c` on macOS.
  3. It installs `tutor` to `~/.local/bin/tutor` (mode 0755) and the archive to `~/.tutor/releases/<v>/`.
  4. It says how to add `~/.local/bin` to `PATH` when that is missing.
  5. It prints "Now run: tutor up ~/my-course". It never runs `up` itself.

- [ ] **Step 1: Write the failing tests**

```bash
# standalone/test/install.bats
load helper
@test "install.sh refuses a download whose checksum doesn't match, and installs nothing" {
  STUB_CURL_CORRUPT=tutor run sh standalone/install.sh
  [ "$status" -eq 1 ]; [ ! -e ~/.local/bin/tutor ]
}
@test "install.sh installs the launcher and the plugin archive for its version, and says what to run" {
  run sh standalone/install.sh
  [ -x ~/.local/bin/tutor ]; ls ~/.tutor/releases/*/bb-plugin-tutor-*.tgz; [[ "$output" == *"tutor up ~/my-course"* ]]
  ! printf '%s' "$output" | grep -iqw bb
}
```

```ts
// test/pins.test.ts (add)
test("release.yaml attaches install.sh, tutor and the plugin archive", async () => {
  const release = await readFile(".github/workflows/release.yaml", "utf8");
  for (const asset of ["install.sh", "tutor", "bb-plugin-tutor-"]) assert.ok(release.includes(asset), asset);
});
```

- [ ] **Step 2: Run them and watch them fail; implement; run them again**

Run: `bats standalone/test/install.bats && npm test`. Expected: FAIL, then PASS after implementing.

- [ ] **Step 3: Check the release archive**

The plugin archive leaves out dev-only paths through `export-ignore` in `.gitattributes`. The launcher ships as its own asset, so add `/standalone/ export-ignore` there. Keep `host.ts`, `host/` and `layouts/` in the archive, because the plugin needs them. Check with `scripts/release-archive.sh HEAD "$TMPDIR/r" && scripts/check-release-archive.sh "$TMPDIR"/r/*.tgz`. The second script runs `bb plugin build .` and must now also produce `dist/host.js`, so add `host.js` to its artifact list.

- [ ] **Step 4: Commit**

```bash
git add standalone scripts .github/workflows/release.yaml test/pins.test.ts
git commit -m "install.sh and the release's launcher assets"
```

## Phase 6: End to end (spec Order 6)

### Task 21: The Linux end-to-end test in CI

**Files:**
- Create: `standalone/e2e/run.sh`
- Create: `standalone/e2e/fake-pi` (Node; records env and argv to `$FAKE_PI_LOG`; replays `fixtures/pi-rpc-transcript.jsonl`)
- Create: `standalone/e2e/fixture-course/` (a tiny `capstone-factory` course: 001 to 004 with one Example each, and a starter)
- Create: `standalone/e2e/checks.mjs` (RPC and filesystem checks, through `bb plugin rpc call tutor …` and plain `fs`)
- Modify: `.github/workflows/ci.yaml` (a job `standalone-e2e`, Linux, Node 24)
- Modify: `standalone/tutor` (the env var `TUTOR_RELEASE_DIR`, so the e2e uses a locally built archive and launcher, for tests only)

**Interfaces:**
- Consumes: the whole launcher, `fake-pi` per Decision 19, and the scripted provider from a devcontainer-features checkout (`DCF`).
- Produces: a job that fails on the first failed check. Its steps:
  1. **Set up.** `sudo loginctl enable-linger "$USER"`, then `export XDG_RUNTIME_DIR=/run/user/$(id -u)`. Build the release assets with `scripts/release-standalone.sh` and `scripts/release-archive.sh`. Run `TUTOR_RELEASE_DIR=… sh standalone/install.sh`.
  2. **Up.** `BB_PI_BRIDGE_COMMAND` is overridden to `standalone/e2e/fake-pi` through `TUTOR_PI_COMMAND`, a test-only launcher variable. Then `tutor up "$RUNNER_TEMP/my course"`.
  3. **Status.** `tutor status` shows the server healthy, the machine connected, and listeners on 127.0.0.1 only. `ss -ltn` shows no other listener for the two PIDs.
  4. **Lesson 0, offline.** `openCoach {courseId:"tutor",lessonId:"000"}`. The thread's `hostId` is the enrolled machine. `$FAKE_PI_LOG` shows `PI_CODING_AGENT_DIR=$HOME/.tutor/pi`. `~/.pi` is untouched (checksum before and after).
  5. **Lesson 0 progress.** Set `coachProvider` to the scripted provider, whose script calls `tutor_adopt_iteration 000` and then marks every Example. `.tutor/progress.yaml` holds the marks, and the workspace lists only `.git` and `.tutor`.
  6. **Fetch.** The `courseCatalog` setting points at `file://` repos made from `fixture-course/`. `fetchCourse {courseId:"fixture"}`. The workspace now has the starter (`tetris/.factory/AGENTS.md`). The server's content dir holds the course, and the server's data dir holds no copy of the workspace (`find ~/.tutor/server -name ITERATION` is empty).
  7. **The fixture course's lessons.** Adopt 001 through the scripted coach: `tetris/.factory/spec/` and `ITERATION` ("001 WIP") appear in the workspace. The factory's tests run on the machine: the scripted coach runs `npm test` in the factory, and the thread's tool output shows it passing. Lessons 002 and 003 finish the same way. Adopting 004 runs `git mv tetris/.factory factory` in the workspace (`git status` shows the rename).
  8. **Stop and up.** `tutor stop`, then `tutor up`. The same thread ids, `.tutor/progress.yaml` and `ITERATION` come back.
  9. **Uninstall.** `tutor uninstall --purge` leaves no `tutor-server.service`, no machine unit, no `~/.tutor` and no `~/.bb-machines/127.0.0.1-47386`. The workspace is unchanged (a checksum of the tree).
  10. **Quiet output.** Nothing printed by the launcher in steps 2, 3, 8 and 9 matches `\bbb\b` (case-insensitive).

- [ ] **Step 1: Write `fake-pi` and its unit test**

`standalone/e2e/fake-pi.test.ts` runs `fake-pi` with the transcript's first request on stdin, and checks that the recorded response comes back and the env log is written. Add `"standalone/**/*.test.ts"` to `npm test`.

- [ ] **Step 2: Write `run.sh` and `checks.mjs` for steps 1 to 10**

Write each check as `check "<what>" <command>`, which prints `ok`/`not ok` and exits at the first failure, as `scripts/tutor-dev/e2e/walk.mjs` does.

- [ ] **Step 3: Run it locally on Linux**

Run: `DCF=<devcontainer-features checkout> standalone/e2e/run.sh`
Expected: every check ok, ending with `standalone e2e: all checks passed`.

- [ ] **Step 4: Add the CI job and push the branch to see it run**

Ask the user before pushing; this plan's own constraint is not to push. If `loginctl enable-linger` doesn't give the runner a user systemd, run the job in a systemd-enabled container (`--privileged`, `/sbin/init`) and note it in the job.

- [ ] **Step 5: Commit**

```bash
git add standalone/e2e .github/workflows/ci.yaml standalone/tutor package.json
git commit -m "End-to-end test of the standalone Tutor on Linux"
```

### Task 22: The macOS checklist

**Files:**
- Create: `standalone/MACOS-CHECKLIST.md`

**Interfaces:**
- Produces: a checklist a person works through by hand for each release, until there is a Mac runner. Each line names the command and the expected result:
  1. `install.sh` from the release.
  2. `tutor up ~/my-course` on a Mac with Node from nodejs.org, and again with Node from Homebrew. The `PATH` in the launchd plist must find `node` and `git`.
  3. `launchctl print gui/$UID/com.leansoftwareproduction.tutor-server` shows it running.
  4. The machine plist's `EnvironmentVariables` hold both pi variables.
  5. The native modules load (`better-sqlite3`, `node-pty`, `@parcel/watcher`), checked by the server reaching healthy and a terminal opening in Tutor.
  6. `tutor login`, a Lesson 0 coach turn, and `~/.pi` unchanged.
  7. Reboot, then `tutor up`.
  8. A simulated BB update (re-run the machine installer), then `tutor up` repairs the environment.
  9. `tutor uninstall --purge`.
  10. `lsof -iTCP -sTCP:LISTEN` shows 127.0.0.1 only.

- [ ] **Step 1: Write the checklist from the spike's macOS results**

- [ ] **Step 2: Work through it once on a Mac and record the date and versions at the top**

- [ ] **Step 3: Commit**

```bash
git add standalone/MACOS-CHECKLIST.md
git commit -m "macOS release checklist for the standalone Tutor"
```

## Phase 7: Release (spec Order 7)

### Task 23: One version for the launcher, plugin and BB; cross-repo pins; the BB bug report

**Files:**
- Modify: `package.json`, `package-lock.json` (`npm version --no-git-tag-version 0.5.0`)
- Modify: `server/content/catalog.ts` (the tutorial's ref pinned to a tag or SHA, together with its starter's ref in its `course.yaml`)
- Modify: `README.md` (a "Standalone" install section: `curl … install.sh | sh`, then `tutor up`; the Codespace section unchanged apart from the BB version; settings `workspaceProject`, `coachProvider`, `courseCatalog`)
- Modify: `docs/IMPLEMENTATION.md` (the module map: `host/`, `layouts/`, `server/workspace/`, `server/content/`, `standalone/`)
- Modify: `test/pins.test.ts` (`TUTOR_VERSION` stamping is checked on the built asset; the catalog refs are tags or SHAs)

**Interfaces:**
- Consumes: everything.
- Produces: tag `v0.5.0` with `install.sh`, `tutor`, `bb-plugin-tutor-0.5.0.tgz` and `SHA256SUMS`.

- [ ] **Step 1: Check the tutorial course declares its layout**

Read the tutorial's `course.yaml` at the ref being pinned. If it has one, it must say `layout: capstone-factory` and name the starter. If it says neither, open a PR on the course repo adding them, and don't release until it is merged and the ref points at it. (A ledger-only course is `capstone-factory` already, per Decision 4, but it still needs a `course.yaml` to name its starter for fetching.)

- [ ] **Step 2: Run the whole proof**

```bash
npm run typecheck && npm test && bats standalone/test && bb plugin build .
DCF=… standalone/e2e/run.sh
DCF=… scripts/tutor-dev/e2e/run-all.sh   # the Codespace, with the bb Feature at 0.44.0 (Task 2, Step 6)
```

Then work through `standalone/MACOS-CHECKLIST.md`. Expected: all green. That covers acceptance criteria 1 to 10.

- [ ] **Step 3: Bump, commit, and stop for review**

```bash
npm version --no-git-tag-version 0.5.0
git add -A package.json package-lock.json server/content/catalog.ts README.md docs/IMPLEMENTATION.md test/pins.test.ts
git commit -m "Release 0.5.0: the standalone Tutor"
```

Tagging and pushing are the user's call. Follow the README's Release steps once they say so.

- [ ] **Step 4: Cross-repo follow-ups (ask before each)**

  1. **devcontainer-features:** bump the bb Feature to BB 0.44.0, and the tutor Feature's `pluginVersion` and `pluginSha256` to 0.5.0, in one PR, per `src/tutor/plugin-pin.sh`. Compute the SHA-256 yourself.
  2. **BB (`get-bb/bb`):** draft the issue "With `machineServerUrl` set to `http://localhost:<port>`, manual enrolment fails: the enrolment records 127.0.0.1, the installer compares against localhost, and reports 'This enrollment route is available only from the server machine'". Include the reproduction from the spike, plus any service-environment finding from Task 1's check 3. Show the draft to the user, and file it only when they say so, because it is outward-facing.

---

## Self-review notes

- **Spec coverage.** The tasks map to the spec as follows.

  | Spec section | Tasks |
  |---|---|
  | Decisions 1 and 2 | 16, 17 |
  | Decision 3 | 15 |
  | Decision 4 | 3, 5 |
  | Decision 5 | 5, 6 |
  | Decisions 6 and 7 | 6, 7, 13 |
  | Decision 8 | 16, 17 |
  | Decision 9 | 16 and Task 21 step 3 |
  | Decision 10 | 18 |
  | Decision 11 | 8, 10, 11 |
  | Decision 12 | 15 |
  | Decision 13 | 15, 20 |
  | The launcher table | 15 to 19 |
  | "Keeping Tutor's pi apart" | 1, 12, 18 |
  | The plugin split | 8 to 12 |
  | Course content | 6, 7, 13, 14 |
  | Security | 16, 17, 19, 21 |
  | Testing | 4, 8 to 11, 15 to 21 |
  | Acceptance criteria 1 to 10 | 21, 22, 23 |

- **Task sizing.** Tasks 4 and 6 are the largest. Each is a seam change that only makes sense whole. Their steps keep the suite green at the end, not in the middle.
- **Placeholder check.** The values this plan cannot know ahead of time come from the spike document, by name: the health path, the unit and plist globs, the uninstall command, pi's login and readiness checks, its version, and the RPC transcript. Each consuming task lists them under **Consumes**. Where this plan gives test bodies as a description rather than code, the arrange, act and assert are spelled out, and the file named is the pattern to copy.
