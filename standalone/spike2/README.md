# Spike 2: a hosted Tutor server, the student's laptop as its machine

The direction since 2026-10-03:
- **One BB server per student.** Each runs as its own Linux user on a hosted VM.
- **The workspace lives on the student's laptop**, which is the server's BB machine. The laptop is Linux for now; a Mac comes later.
- **Coach threads use whichever agent the student has already signed in to:** Claude Code, Codex or pi. Tutor no longer installs its own pi.
- **There is never a local server on the student's laptop**, Mac or Linux.

Spike 2 tries this layout with one hand-made student (`student-001`) on `ew-lsp-001`, before anything goes into Ansible. Each check should end with what the plan does if it fails.

**How the student reaches their server.** These are the infrastructure repo's own conventions (`roles/ew_bb/README.md`):

| Leg | Route | Who lets you in |
|---|---|---|
| Browser | `https://student-001-tutor.leansoftware.ai` → cloudflared → `127.0.0.1:38888` | a Cloudflare Access app (bb has no auth of its own) |
| Machine | `http://100.124.90.17:38888` → `systemd-socket-proxyd` → `127.0.0.1:38888` | the tailnet policy, which already grants port 38888 to this laptop (`candace`) |

**The scripts.**
- They're Bash, and run from this laptop.
- They reach the box as `ew-admin@ew-lsp-001-tailnet`, using sudo there.
- Settings are in `lib.sh`. Each can be overridden with an environment variable (`STUDENT`, `PORT`, `BB_VERSION`, …).
- Results are appended to `~/.tutor-spike2/results.txt`.

## Before you start

- **The plugin build:** `standalone/e2e/e2e.sh build` writes `~/tutor-e2e/release/bb-plugin-tutor-<version>-built.tgz`.
- **Port 38888 must be free on the box.** `box-setup.sh` refuses if anything else is listening on it.
- **Cloudflare (step 2):** an API token with Access:Edit, and DNS for `leansoftware.ai` in the LSP account, or the Zero Trust dashboard. Both are in 1Password `Shared` under the tag `ew-fleet`.

## Runbook

**1. The server on the box.** This changes the production box, so run it only with the go-ahead.

```
standalone/spike2/box-setup.sh
```

It does the following:
- creates the user `student-001` (no password, no sudo);
- installs `bb-app@0.45.0` in `~student-001/tutor/npm`;
- writes `tutor-student-001.service`, a system unit with `User=student-001`, like `bb.service`. It runs in `bbmachines.slice` (the burst tier) with `MemoryHigh=2G` / `MemoryMax=3G`;
- writes `tutor-student-001-tailnet-proxy.socket` on `100.124.90.17:38888`;
- installs Tutor's plugin, and sets `machineServerUrl` to the tailnet URL;
- selects the Sketchbook theme and turns off the plugins a student doesn't need.

Check 1 passes when the laptop gets an answer from `http://100.124.90.17:38888/health`.

**2. The browser route.** This is done by hand, in this order, because bb has no authentication:
1. **Access app first.** Create an Access app `ew-lsp-001-student-001` for `student-001-tutor.leansoftware.ai`. Attach the reusable "lean-software-production GitHub org" policy, as `ew-lsp-001-bb` does.
2. **The CNAME.** Point `student-001-tutor` in `leansoftware.ai` at the tunnel. Use flarectl or the dashboard, not `cloudflared tunnel route dns`, because that targets the wrong zone (see the config's header).
3. **The ingress rule.** Add it in the infrastructure repo's `instances/ew-lsp-001/cloudflared-config.yml`, above the final `http_status:404`, then copy the file to `/etc/cloudflared/config.yml` on the box:
   ```yaml
   # SPIKE 2 (2026-10-03): a per-student Tutor server, hand-installed by
   # bb-plugin-tutor standalone/spike2. bb has no auth: the Access app
   # "ew-lsp-001-student-001" MUST exist before this route goes live.
   # Back out: standalone/spike2/teardown.sh, then this comment + the two lines below.
   - hostname: student-001-tutor.leansoftware.ai
     service: http://localhost:38888
   ```
4. `sudo systemctl restart cloudflared`. This briefly interrupts the box's other hostnames (canvas, bb, fabro).
5. `standalone/spike2/checks.sh browser` (check 8). It should show a redirect to Access, never a 200.

**3. Enrol this laptop.**

```
standalone/spike2/laptop-enrol.sh
```

It runs `bb machine create --provider manual` against the student's server and runs the installer it prints. BB 0.45.0 has no join codes, so the infrastructure README's `machine join-code` steps no longer work. The enrolment token never appears in an argv or any output. BB's installer writes a systemd user unit for `100.124.90.17-38888`. The script records that unit's PATH, which check 4 depends on.

**4. The checks.**

```
standalone/spike2/checks.sh memory            # 2: idle memory
standalone/spike2/checks.sh providers         # 4: claude-code / codex / pi: ready?
standalone/spike2/checks.sh workspace         # 5: workspace on the laptop; host-call times
standalone/spike2/checks.sh coach claude-code # 6: tools reach the coach; side chat forks
standalone/spike2/checks.sh coach codex
standalone/spike2/checks.sh coach pi
standalone/spike2/checks.sh memory            # 2 again, after three coach threads
# suspend the laptop for a few minutes, wake it, then:
standalone/spike2/checks.sh connected         # 7
# turn Tailscale off for a minute, on again, then:
standalone/spike2/checks.sh connected         # 7
```

In the browser (check 8), confirm that:
- the outline shows Lesson 0;
- a coach thread replies;
- the theme is Sketchbook.

Also note how much your own `~/.claude` (CLAUDE.md, hooks, skills) steers the Claude coach. That's the isolation trade-off, so write it down.

## What each check decides

| # | Check | If it fails |
|---|---|---|
| 1 | The server answers over the tailnet | Debug the proxy and the tailnet policy; nothing else can run. |
| 2 | Memory per student server | Sets how many students fit on a VM; the `MemoryMax` goes into Ansible. |
| 3 | The laptop enrols over the tailnet | Use another way to reach the machine (`tailscale serve`, or Access with a service token); the per-student plan stalls until one works. |
| 4 | BB finds the student's agents from its systemd service | The laptop setup must give the machine's unit a PATH (mise/nvm shims), or tell the student how. |
| 5 | Host calls over the hop are quick enough | If they're slow, batch the plugin's workspace reads; the outline's load time is the measure. |
| 6 | Each agent gets Tutor's tools and forks side chats | An agent that fails is not offered as a coach; Tutor lists only those that pass. |
| 7 | The machine comes back after a suspend or a tailnet drop | Decide what "reconnecting" means and what Tutor shows while it happens. |
| 8 | HTTPS through Access, never without it | Stop the route at once if it answers without Access. |

## Back out

```
standalone/spike2/teardown.sh
```

It removes the laptop's machine (from the server, then its systemd unit and `~/.bb-machines/100.124.90.17-38888`) and `~/.tutor-spike2`. On the box it removes the units, then the `student-001` user and home. The workspace folder is left alone.

Then by hand:
1. Remove the ingress rule, from the box's `/etc/cloudflared/config.yml` and from the infrastructure repo.
2. Restart cloudflared.
3. Delete the CNAME, then the Access app.
