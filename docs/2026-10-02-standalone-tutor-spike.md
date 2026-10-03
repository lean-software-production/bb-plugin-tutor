# Standalone Tutor spike: pi's environment on an enrolled machine

Status: **not run yet**. This is Task 1 of
[the implementation plan](2026-10-02-standalone-tutor-plan.md), done with the scripts in
[`standalone/spike/`](../standalone/spike/README.md). Fill in each section from
`~/tutor-spike-results-<os>/results.txt` on each OS. Leave out tokens, credentials and prompts.

## What was run

| | Linux | macOS |
|---|---|---|
| Date | | |
| OS and version | | |
| Node / npm | | |
| bb-app | 0.44.0 | 0.44.0 |
| pi (`@earendil-works/pi-coding-agent`) | | |
| Native modules built cleanly (`npm.log`) | | |

## Results

| # | Check | Linux | macOS |
|---|---|---|---|
| 1 | The machine daemon's environment has both variables | | |
| 2 | They survive a service restart | | |
| 3 | After re-running BB's installer: service file rewritten? variables kept? (INFO) | | |
| 4 | Tutor's pi has no credentials before login (INFO) | | |
| 5 | Login writes to Tutor's pi dir; `~/.pi` unchanged | | |
| 6 | Model discovery on the machine reads Tutor's pi dir | | |
| 7 | A pi thread starts pi through `BB_PI_BRIDGE_COMMAND` with Tutor's pi dir | | |
| 8 | Checks 1 and 7 after a reboot | | |

Failures, and the branch taken from the table in the plan's Task 1:

## Constants for later tasks

| Constant | Value (Linux) | Value (macOS) |
|---|---|---|
| `BB_SERVER_HEALTH_PATH` | | |
| `BB_SET_MACHINE_URL` | `bb settings general machineServerUrl http://127.0.0.1:<port>` and `bb settings general defaultMachineAccess direct`: confirm | |
| `BB_CLI_ENV` | `BB_SERVER_URL=http://127.0.0.1:<port>` (found in BB 0.44.0's CLI; `BB_DATA_DIR` does not pick the server): confirm | |
| `BB_ENROL_LINE_PATTERN` | | |
| `MACHINE_UNIT_GLOB` / `MACHINE_PLIST_GLOB` | | |
| The installer body holds the enrolment token? | | |
| `MACHINE_UNINSTALL` (did `--uninstall` remove everything?) | | |
| `PI_PACKAGE` / `PI_VERSION` | `@earendil-works/pi-coding-agent` / | |
| `PI_LOGIN` (exact steps) | | |
| `PI_READY` (`pi auth check --provider <p>` with `PI_CODING_AGENT_DIR` set?) | | |
| `bb machine list --json` shape (machine id field, provider field) | | |

## The BB↔pi exchange

How BB drives pi (from `pi-in.log` / `pi-out.log`): pi's `--mode rpc`, the argv BB passes, and
whether plugin tools reach pi through the RPC protocol or through an extension BB injects.
The redacted turn is in `standalone/e2e/fixtures/pi-rpc-transcript.jsonl`.

## Bundle sizes (for Task 9's ceiling)

| Bundle | Encoded size |
|---|---|
| Largest tutorial lesson | |
| Tutorial `stand-ins/` | |
| Starter (without `.git`, `.devcontainer`, `node_modules`) | |

## Corrections to the plan

Anything the spike showed the plan got wrong, and the tasks it changes.
