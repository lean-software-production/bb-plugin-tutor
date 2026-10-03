# Spike 2: a hosted Tutor server per student, the laptop as its machine

Status: **done on Linux** (2026-10-03). The laptop suspend (check 7) is untested, and so is a Mac laptop as the machine.

Done with the scripts in [`standalone/spike2/`](../standalone/spike2/README.md). The raw lines are in `~/.tutor-spike2/results.txt` on the laptop.

## The direction tested

The change of direction comes from 2026-10-03, after the all-on-the-laptop launcher (Tasks 2–20) was built:
- Every student gets **their own BB server**, running as its own Linux user on a hosted VM. There is no installable local server, not even on a Mac.
- The **workspace lives on the student's laptop**, which is the server's BB machine.
- Coach threads use **the coding agent the student has already signed in to**: Claude Code, Codex or pi. Tutor no longer installs its own pi.

## What was run

| | |
|---|---|
| Server | `ew-lsp-001` (OVH, Debian 13). User `student-001`, running `tutor-student-001.service` (bb-server 0.45.0 on `127.0.0.1:38888`) in `bbmachines.slice` with `MemoryMax=3G` |
| Tutor plugin | 0.4.0, the built archive from the end-to-end build (SDK 0.6.15) |
| Machine | this laptop (`candace`, Linux), enrolled to `http://100.124.90.17:38888` over the tailnet through the `systemd-socket-proxyd` socket |
| Browser | `https://student-001-tutor.leansoftware.ai` → cloudflared on the box → `127.0.0.1:38888`, behind the Access app `ew-lsp-001-student-001` (the reusable "lean-software-production GitHub org" policy) |
| Tailnet policy | a separate grant: `candace` → `tag:bb-server:38888`, which the boxes don't get |

## Results

| # | Check | Result |
|---|---|---|
| 1 | Server reachable over the tailnet | PASS, once the policy granted 38888. The 2026-10-03 policy (#29) had narrowed the bb ports to 38886 and 38896 |
| 2 | Memory | About 270–330 MiB, both idle and after four coach threads. Memory doesn't limit how many students a VM holds |
| 3 | Laptop enrols over the tailnet | PASS: `bb machine create --provider manual`, run from the laptop against the tailnet URL. Connections through the proxy reach bb from loopback, so the 0.45.0 rule that enrolment keys go to loopback callers only doesn't get in the way. The enrolment token never left the laptop |
| 4 | The machine service finds the student's agents | PASS. BB builds the machine's PATH from the user's login shell (`provider.env-resolved`, `"source": "shell"`), so CLIs installed with mise were found. Tutor needs no PATH setup. `bb provider list --machine` reported claude-code, codex and pi as available |
| 5 | Workspace on the laptop, read from the server | PASS. `getOverview` takes **0.7–1.4 s** over the hop |
| 6 | A coach on each agent | **Claude Code and Codex: PASS.** Each used Tutor's skill, called `tutor_status` / `tutor_focus_rule` and emitted Tutor's directives; Claude also adopted Lesson 0. Side chats forked. **pi: PASS only with an explicit model.** Its own default, `opencode/big-pickle`, answered 403 "OpenCode's free tier can only be used from within OpenCode". With `opencode-go/glm-5.3-flash` it passed |
| 7 | Machine reconnects | Tailnet drop: **PASS.** The daemon lost the server after 30 s without a heartbeat reply, retried every 10–20 s, and reconnected by itself about 100 s after it lost the server. Laptop suspend: not tested |
| 8 | Browser over HTTPS, behind Access | PASS. An anonymous request is redirected to Access, never served. Logged in, the theme, the outline and the coach threads all work |

## What it decides

1. **The layout works.** A per-student server on a shared VM, the laptop as its machine over the tailnet, and the browser through Cloudflare Access. That combination is the infrastructure repo's existing pattern for the shared bb (`roles/ew_bb/README.md`).
2. **Use the student's own agent.** Tutor's own pi, `tutor login`, the `PI_CODING_AGENT_DIR` drop-in, stripping provider keys and the model pin are all unnecessary on the laptop. BB already finds and drives claude-code, codex and pi.
3. **"Available" doesn't mean usable.** BB said pi was available, but its default model could not run from BB. The plugin needs to:
   - let the student choose the coach's agent and, when needed, its model;
   - turn a provider error such as that 403 into words a student can act on.
4. **The laptop needs almost nothing from Tutor.** The machine comes from BB's own installer, enrolled against the student's server. The workspace folder and its project can be made by the plugin's first-run flow. Whether any laptop command is still needed is a question for the spec.
5. **Host-call latency is visible.** An outline load is about 1 s over the hop. The plugin's workspace reads should be batched, or cached between loads.
6. **Isolation is not provided.** BB loads the student's own agent configuration: `~/.claude` (CLAUDE.md, hooks, skills, plugins) and `~/.codex`. In this short run the Claude coach used only Tutor's skill. A longer session, or a heavier configuration, may differ.

## Facts for the plan

- **bb-app 0.45.0 refuses unknown hosts.** It answers `403 forbidden_host` unless Host is localhost, an IP, or the one hostname in `BB_APP_URL`. Every student server needs `BB_APP_URL=https://<its public hostname>`.
- **`bb machine join-code` is gone in 0.45.0.** `bb machine create --provider manual` (with BB's installer) works against an unpaired server, including through the tailnet proxy.
- **Commands run as the student need a working directory the student can enter.** Running bb's CLI from `ew-admin`'s home under sudo fails with EACCES.
- **The `bb` CLI must not inherit a BB terminal's `BB_*` variables** (fixed in the launcher, `524dcb2`).
- **Per student, provisioning needs:**
  - a Linux user, a port and a loopback system unit (with `BB_APP_URL`);
  - a tailnet proxy socket;
  - a tailnet grant from the student's devices to that port only;
  - an Access app, a CNAME and an ingress rule.

  The Access app must exist before the route goes live. That is all Ansible / infrastructure work, plus the policy (pasted by hand today).

## What's on the box and in Cloudflare now

The spike setup is still live. `standalone/spike2/teardown.sh` removes the server, the user and the laptop's machine. By hand, remove:
- the cloudflared rule (the box's previous config is kept as `/etc/cloudflared/config.yml.before-tutor-spike2`);
- the CNAME;
- the Access app;
- the tailnet grant.

The infrastructure repo has the policy and cloudflared changes on the branch `tailnet/tutor-spike2-student-001`.
