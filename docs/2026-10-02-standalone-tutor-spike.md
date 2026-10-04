# Standalone Tutor spike: pi's environment on an enrolled machine

Status: **Linux done** (2026-10-03). **macOS deferred**: run it before the launcher's macOS work (Tasks 16–19) or by the release checklist (Task 22) at the latest. This is Task 1 of
[the implementation plan](2026-10-02-standalone-tutor-plan.md), done with the scripts in
[`standalone/spike/`](../standalone/spike/README.md). Fill in each section from
`~/tutor-spike-results-<os>/results.txt` on each OS. Leave out tokens, credentials and prompts.

## What was run

| | Linux | macOS |
|---|---|---|
| Date | 2026-10-03 | |
| OS and version | Omarchy (Arch), Linux 7.2.5, systemd user session | |
| Node / npm | 25.2.1 / 11.6.2 (bb-app warns: it asks for ^22.19, ^24 or ^26; it ran anyway) | |
| bb-app | 0.44.0 | 0.44.0 |
| pi (`@earendil-works/pi-coding-agent`) | 0.85.1 | |
| Native modules built cleanly (`npm.log`) | yes (only the engine warning) | |

## Results

| # | Check | Linux | macOS |
|---|---|---|---|
| 1 | The machine daemon's environment has both variables | PASS | |
| 2 | They survive a service restart | PASS | |
| 3 | After re-running BB's installer: service file rewritten? variables kept? (INFO) | The saved installer re-ran **without a new enrolment** and left the unit unchanged; the drop-in survived; checks 1 and 9 still pass. So the installer is a reusable credential, not a one-time one. It didn't rewrite the unit, so a real update rewrite is still untested; `tutor up` repairs regardless | |
| 4 | Tutor's pi has no credentials before login (INFO) | no `auth.json`; 96 models listed, from `OPENCODE_API_KEY` in the shell (see check 9) | |
| 5 | Login writes to Tutor's pi dir; `~/.pi` unchanged | PASS (openrouter) | |
| 6 | Model discovery on the machine reads Tutor's pi dir | PASS: the machine lists openrouter models, which only Tutor's pi is signed in to. Right after `OPENCODE_API_KEY` was unset, BB still served a cached list with 114 opencode/opencode-go models; asked again later, it held `openrouter` only (419). BB caches the machine's pi model list for a while, so after `tutor login` or an environment repair the composer may show stale models briefly. Coach threads pin `coachModel`, so they don't depend on that list (amendment 4) | |
| 7 | A pi thread starts pi through `BB_PI_BRIDGE_COMMAND` with Tutor's pi dir | PASS: the thread's pi ran through `tee-pi` with Tutor's pi dir, defaulting to `openrouter/moonshotai/kimi-k2.6` | |
| 8 | Checks 1, 9 and 7 after a reboot | Reboot skipped. The unit is `enabled`, so it starts with the user's systemd manager; `Linger=no`, so it runs from login to logout. The variables live in the drop-in, and `UnsetEnvironment=` applies to whatever environment the manager has at boot, so check 2 covers them. A real reboot is left to the Mac run and the release checklist (acceptance criterion 7) | |
| 9 | No provider credential in the machine daemon's environment | First FAIL (`OPENCODE_API_KEY`, inherited from the systemd user manager); PASS after `apply-env.sh` added `UnsetEnvironment=` (82eb2e7) | |

Failures, and the branch taken from the table in the plan's Task 1:

## Constants for later tasks

| Constant | Value (Linux) | Value (macOS) |
|---|---|---|
| `BB_SERVER_HEALTH_PATH` | `/health` | |
| `BB_SET_MACHINE_URL` | `bb settings general machineServerUrl http://127.0.0.1:<port>` and `bb settings general defaultMachineAccess direct`: works | |
| `BB_CLI_ENV` | `BB_SERVER_URL=http://127.0.0.1:<port>` (found in BB 0.44.0's CLI; `BB_DATA_DIR` does not pick the server): works | |
| `BB_ENROL_LINE_PATTERN` | `curl … -H 'X-BB-Enrollment: <token>' <url> \| sh` (parsed by `setup.sh`) | |
| `MACHINE_UNIT_GLOB` / `MACHINE_PLIST_GLOB` | `~/.config/systemd/user/bb-host-daemon-127-0-0-1-<port>-<host id>.service` | |
| The installer body holds the enrolment token? | yes: never keep it | |
| `MACHINE_UNINSTALL` (did `--uninstall` remove everything?) | No: the installer ignored `--uninstall`, reinstalled, and waited 2 minutes for a machine the server had already removed. `teardown.sh` removed the unit, drop-in and machine directory itself. So uninstall is the launcher's own job (amendment 3) | |
| `PI_PACKAGE` / `PI_VERSION` | `@earendil-works/pi-coding-agent` / 0.85.1 | |
| `PI_LOGIN` (exact steps) | | |
| `PI_READY` (`pi auth check --provider <p>` with `PI_CODING_AGENT_DIR` set?) | yes | |
| `bb machine list --json` shape (machine id field, provider field) | `id`, `machineProviderId: "manual"` (setup found the machine by these) | |

## The BB↔pi exchange

What BB runs (Linux, BB 0.44.0, from `tee-pi`'s log):

- `<BB_PI_BRIDGE_COMMAND> --version`: the version probe, with stdin left open and a 15 s limit.
- Model discovery: `--mode rpc --no-session --extension /tmp/bb-provider-bridge-provider-pi-…/pi/bb-pi-extension.mjs`.
- A thread: `--mode rpc --session ~/.bb/pi-bridge-sessions/pi_<id>.jsonl --session-dir ~/.bb/pi-bridge-sessions --extension …/bb-pi-extension.mjs --append-system-prompt …/pi-append-….md --skill ~/.bb-machines/127.0.0.1-<port>/runtime/global-skills/<hash>/skills --model <provider>/<model> --thinking medium`.

BB injects its own pi extension (`bb-pi-extension.mjs`), so plugin tools don't reach pi through
the RPC protocol alone. That is the last row of the plan's Task 1 table: `fake-pi` only records its
environment and argv, and every check that needs coach tool calls uses the scripted provider
(Task 21). No transcript fixture is needed.

Note: BB keeps pi's thread sessions in `~/.bb/pi-bridge-sessions`, not in `PI_CODING_AGENT_DIR`. The
spec only requires credentials and config to stay apart from `~/.pi`, so this is fine, but
`tutor uninstall --purge` doesn't remove `~/.bb/pi-bridge-sessions`. Decide whether it should
(Task 19).

## Bundle sizes (for Task 9's ceiling)

| Bundle | Encoded size |
|---|---|
| Largest tutorial lesson | |
| Tutorial `stand-ins/` | |
| Starter (without `.git`, `.devcontainer`, `node_modules`) | |

## Corrections to the plan

Taken into the plan as "Amendments from the Linux spike run (2026-10-03)":

1. The `bb` CLI picks its server from `BB_SERVER_URL`, not `BB_DATA_DIR`.
2. npm has no `--allow-scripts` flag; its default install scripts build the native modules.
3. BB's installer body holds the enrolment token: the launcher never keeps it, and
   `tutor uninstall` removes the enrolment and the service file itself.
4. **Linux: the machine service inherits provider API keys from the systemd user manager** (here
   `OPENCODE_API_KEY`). `PI_CODING_AGENT_DIR` isolates pi's files, not its environment. Three
   changes follow:
   - the drop-in `UnsetEnvironment=`s pi's API-key variables by name;
   - coach threads are pinned to the provider and model chosen at `tutor login`;
   - `tutor status` names any key left.

   Check this on macOS too.
5. BB probes `<BB_PI_BRIDGE_COMMAND> --version` with stdin open and a 15 s limit, so any wrapper
   must answer one-shot commands at once.
6. The saved installer re-enrols without a new token, so it is a reusable credential: the
   launcher deletes it as soon as it has run. BB's installer has no working `--uninstall`.
7. Lingering stays off: the services run from login to logout.
8. Prerequisites: the run used Node 25, which bb-app 0.44.0's `engines` excludes (^22.19, ^24, ^26)
   although it worked. The launcher's check should refuse odd majors, as the spec lists only
   22.19+, 24 and 26, and say which to install.
