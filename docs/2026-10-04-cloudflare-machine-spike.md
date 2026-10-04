# Spike 3: the student's machine through Cloudflare Access

Status: **done** (2026-10-04). A real GitHub Codespace has not been tried yet. A local devcontainer built with the same feature stood in for one (below).

Spike 2 ([docs/2026-10-03-hosted-tutor-spike.md](2026-10-03-hosted-tutor-spike.md)) reached the student's server over the tailnet. Instructors piloting Tutor will use a Codespace of `capstone-project-starter` as their "laptop", and a Codespace isn't on the tailnet. So this spike asked one question: **can a BB machine reach its server through the Cloudflare Access app that already guards the browser, using a service token?**

## What was run

| | |
|---|---|
| **Server** | `student-001` on `ew-lsp-001` (Spike 2), bb-app 0.45.0, `BB_APP_URL=https://student-001-tutor.leansoftware.ai` |
| **Access** | **The app** `ew-lsp-001-student-001` has two policies: the GitHub org (browser) and **Service Auth** for the service token `tutor-student-001-machine` (machine).<br>**The token** reached the scripts through `bb secret request` and was never printed. |
| **Machine 1** | This laptop, as a second machine of `student-001`, run by [`standalone/spike3/cf-machine.sh`](../standalone/spike3/cf-machine.sh) under a transient systemd unit. |
| **Machine 2** | A local devcontainer (`javascript-node:5-24-trixie`) with the `bb` feature's new `machine` mode (devcontainer-features branch `bb/machine-mode`). `devcontainer up --secrets-file` stood in for Codespaces secrets. There was no systemd, and the real lifecycle hooks ran. |

## Results

| # | Check | Result |
|---|---|---|
| 3.1 | The token gets through Access | PASS once the Service Auth policy was on the app: `/health` answered 200 with the token, and 302 to the login page without it. |
| 3.2 | Enrol through Access | PASS, with a workaround. `bb-app host-daemon join` requests its enroll key without `BB_SERVER_HEADERS`, so Access answered with its login page. Requesting the key ourselves (`POST /internal/hosts/enroll-key` with the token's headers), then starting the daemon with `BB_HOST_ENROLL_KEY`, works. The server hands enroll keys to loopback callers, and through cloudflared it sees one. |
| 3.3 | The daemon connects and stays connected | PASS. The daemon sends `BB_SERVER_HEADERS` on its WebSocket and HTTP calls. |
| 3.4 | Tutor reads a workspace on that machine | PASS. `getOverview` takes **0.7–0.8 s** (laptop) or **0.7 s** (container), steadier than the tailnet's 0.7–1.4 s. |
| 3.5 | A coach on that machine | PASS. Claude Code called `tutor_adopt_iteration`, `tutor_status` and `tutor_focus_rule`. |
| 3.6 | Long-running | PASS. The laptop's machine held **one session for 2 h 54 min** with no disconnect. The container held one for 1.5 h, after a restart. Cloudflare's WebSocket idle limits don't bite, because BB's heartbeats keep the connection busy. |
| 3.7 | The devcontainer feature (machine 2) | PASS. It connected **about 3 s** after start, and reconnected after `docker restart` plus the start hook. A scan of every process's argv and of every log found no token. Its CI scenario passes, as do the feature's existing scenarios (26 checks). |

## What it decides

1. **The student's machine reaches their server through Cloudflare Access with a service token.** It uses the same hostname as the browser. The tailnet isn't needed for students, so per-student tailnet grants and proxy sockets go.
2. **Each student needs:**
   - one Access app with two policies (the GitHub org, and Service Auth);
   - one service token, kept as Codespaces secrets with the server URL.
3. **The `bb` feature's `machine` mode is the student-side install.** It enrols and keeps the daemon running in a container without systemd, and keeps the token out of argv and logs. `capstone-project-starter` adds it beside its claude-code, codex and pi features.

## BB gaps (0.45.0)

- **`host-daemon join` doesn't send `BB_SERVER_HEADERS`** when it requests the enroll key (`requestMatchingHostEnrollKey`). The workaround is in the feature, and it's about 10 lines.
- **The `bb` CLI doesn't send `BB_SERVER_HEADERS`.** Students never use it. Operators reach a student's server over the tailnet or on the box.

Both are candidates for an upstream report. Nothing is filed yet.

## Left running

- **Machines:** the laptop's Cloudflare machine (unit `tutor-spike3-machine`, `cf-machine.sh teardown` removes it) and the container (`docker rm -f 6eb0ebdb2e64`, then `bb machine remove host_nteksyrxqn`).
- **Workspace setting:** `student-001` points at the container's workspace. `cf-machine.sh restore` points it back at Spike 2's.
- **The service token** `tutor-student-001-machine` lives in Cloudflare and in `~/.tutor-spike2/cf-access.env` (0600).
