# Hosted Tutor: a server per student, the student's Codespace as its machine

Status: **proposed** 2026-10-04. This supersedes the delivery half of
[the standalone design](2026-10-02-standalone-tutor.md). That design put the server and the machine
on the student's computer, behind a `tutor` launcher. This one hosts the server and keeps only the
machine with the student.

The course half of the standalone design stays as written and is built (Tasks 2–14):
- workspaces and course layouts;
- the built-in Lesson 0;
- fetched courses;
- the plugin split between server and host entry.

The evidence is three spikes:
- [Spike 1](2026-10-02-standalone-tutor-spike.md) (pi on an enrolled machine);
- [Spike 2](2026-10-03-hosted-tutor-spike.md) (a per-student server on `ew-lsp-001`, a machine over the tailnet);
- [Spike 3](2026-10-04-cloudflare-machine-spike.md) (the machine through Cloudflare Access, and the `bb` devcontainer feature's `machine` mode).

Terms follow [`GLOSSARY.md`](GLOSSARY.md).

**Who it's for first.** The other instructors, playing students. **Success** means they get from "here's your link" through Lesson 0 and into the capstone course, and come away thinking Tutor is worth continuing to invest in.

## Decisions

1. **A server per student, hosted.** Each student has their own BB server with Tutor. It runs as their own Linux user on a hosted Linux VM, `ew-lsp-001` to start. There is never a server on the student's computer, Mac or Linux.
2. **The student's machine is their Codespace.** For the pilot, each instructor creates a Codespace of [`capstone-project-starter`](https://github.com/lean-software-production/capstone-project-starter). That Codespace is their server's only BB machine: the workspace, the coding agents and Tutor's host entry run there. A Linux laptop, then a Mac, come later as machines, using the same server side.
3. **The workspace is the Codespace's checkout** (`/workspaces/capstone-project-starter`). The capstone course's starter is already there. When the course is added, seeding keeps those files (`seeded.kept`), and Lesson 0's `.tutor/` sits beside them.
4. **The coach uses the student's own agent.** It takes the first of Claude Code, Codex and pi that BB reports signed in on the machine; the student signs in once inside the Codespace. A `coachProvider` setting overrides the choice. This is built (`e39cf35`). Tutor no longer installs or signs in a pi of its own.
5. **One hostname per student, behind Cloudflare Access.** The hostname is `https://<student>-tutor.leansoftware.ai`, and both the browser and the machine use it. Its Access app has two policies:
   - the GitHub org, for people;
   - Service Auth, for the student's machine.

   bb has no authentication of its own, so Access is the only thing in front of it.
6. **The machine authenticates with a service token per student.** It's sent as `BB_SERVER_HEADERS` and kept as the student's Codespaces secrets. Students need no tailnet. The tailnet stays for operators.
7. **The `bb` devcontainer feature's `machine` mode is the whole student-side install.** It enrols once and keeps the host daemon running in a container without systemd. The starter's devcontainer adds it beside its `claude-code`, `codex` and `pi` features. The student runs no Tutor command.
8. **Provisioning is the operator's, by hand-run automation.** For the pilot, an operator adds a student with the infrastructure repo's tools, then sends them their link and their three secrets. Self-serve sign-up is later.
9. **The plugin creates the workspace's project.** On first run, Tutor offers the connected machine's checkout and, once the student confirms, creates the BB project for it. This reverses "Tutor never creates projects": a hosted student has no other way to make one, because the `bb` CLI can't pass Access and BB's own project screens would show BB to a student.
10. **The all-on-the-laptop delivery is retired.** That covers:
    - the `tutor` launcher (`standalone/tutor`, `install.sh`, the release's launcher assets);
    - Tutor's own pi and `tutor login`;
    - the `tutor` devcontainer feature and the `bb-tutor` Codespace.

    The end-to-end checks and the scripted provider stay, retargeted at the hosted shape.
11. **Pins.** BB and `@get-bb/plugin-sdk` are pinned together: bb-app 0.45.0, SDK 0.6.15. Every student server, and the `bb` feature's `version` in the starter, use the same bb-app version, because a daemon speaks its server's protocol.

## Architecture

```
 instructor's browser ──https──▶ Cloudflare (Access: GitHub org) ─┐
                                                                    │ cloudflared on ew-lsp-001
 instructor's Codespace                                             ▼
   bb host daemon ──https + service token──▶ Cloudflare (Access: Service Auth) ──▶ 127.0.0.1:<port>
   (bb feature, machine mode)                                       student's bb-server (tutor-<student>.service,
   workspace /workspaces/capstone-project-starter                   Linux user <student>, Tutor plugin)
   claude / codex / pi (signed in by the instructor)
```

- **The server** reads and writes the workspace only through the machine (`sdk.files`, the host entry's `adoptLesson` and `seedWorkspace`), as the standalone design already requires.
- **cloudflared reaches the server from loopback,** so BB's rule that enroll keys go only to loopback callers lets a machine enrol through Access.

## The student's server

Each student server has:

| Piece | What it is |
|---|---|
| Linux user | `<student>`: no password, no sudo, not an SSH login |
| Port | A loopback port from an append-only list, as the infrastructure repo already allocates ports for people's machines |
| Unit | `tutor-<student>.service`: a system unit with `User=<student>` that runs `bb-server --data-dir ~/tutor/server --server-bind-host 127.0.0.1 --server-port <port>`. It has `BB_APP_URL=https://<student>-tutor.leansoftware.ai`, without which bb 0.45 answers `403 forbidden_host`, and runs in `bbmachines.slice` with `MemoryMax=3G` |
| Plugins | Tutor's built plugin. The Sketchbook theme is selected and the plugins a student doesn't need are switched off (the list in Spike 2's setup). |
| Edge | A cloudflared ingress rule; a CNAME in `leansoftware.ai`; an Access app with the two policies; a service token |

**Memory:** each server uses 270–410 MiB (Spike 2), so a handful of instructors fits on `ew-lsp-001` alongside production. A cohort needs its own VM.

**Provisioning** lives in the infrastructure repo, following its conventions:
- **On the box:** a role (`ew_tutor`) with a student list (name, uid, port) that converges the user, the bb-app install, the unit and the plugin.
- **At the edge:** the Cloudflare steps, through the same API token and 1Password items as `playbooks/cloudflare-access.yml`. The ingress rule goes in `instances/ew-lsp-001/cloudflared-config.yml`, and cloudflared restarts once per change.
- **Order matters:** the Access app, with both policies, must exist before the ingress rule goes live, because bb has no auth.

What an operator sends a student: their link, and three values to add as Codespaces secrets for `capstone-project-starter`:
- `BB_MACHINE_SERVER_URL`;
- `BB_MACHINE_ACCESS_CLIENT_ID`;
- `BB_MACHINE_ACCESS_CLIENT_SECRET`.

Removing a student reverses all of it, in the opposite order:
1. the ingress rule;
2. the CNAME and the Access app;
3. the token;
4. the unit, the user and their home.

## The student's Codespace

The starter's `devcontainer.json` gains:

```jsonc
"ghcr.io/lean-software-production/devcontainer-features/bb:1": {
  "version": "0.45.0", "mode": "machine", "autoStart": true
}
```

The instructor's steps:
1. Add the three secrets (GitHub → Settings → Codespaces), for the starter repo.
2. Create a Codespace of the starter.
3. In its terminal, sign in to an agent: `claude` (or `codex`, or `pi` then `/login`).
4. Open their link.

The feature does the rest on every start, as documented in its `NOTES.md`:
- **First start:** it fetches the enroll key itself, because `host-daemon join` drops the headers. On later starts, the machine's own credential is used.
- **The daemon:** `bb-app host-daemon --supervise`, in its own session.
- **The token:** kept in 0600 files only.

**An idle Codespace stops,** and its machine drops off the server. Resuming the Codespace brings the daemon back, and BB reconnects by itself (Spike 2, check 7).

## The plugin's changes

1. **Hosted first run.**
   - **No workspace yet:** the first-run page finds the student's connected machine, probes `/workspaces/*` through the host entry for the starter's checkout, and offers it. On confirm, it creates the project (`sdk.projects.create` with that machine and folder) and records `workspaceProject`.
   - **No connected machine:** the page says to open the Codespace, and that it connects by itself.
   - The existing candidate list stays for a workspace that already has a project.
2. **The agent, explained.**
   - **None of Claude Code, Codex or pi is ready:** the outline and the coach button say so, with the sign-in command BB reports for each (`loginCommand`), instead of quietly using BB's default agent.
   - **A coach turn fails with a provider error:** for example pi's free-tier 403 from Spike 2. The thread's failure reaches the student in Tutor's words, with the fix: sign in to another agent, or pick a model.
3. **An unreachable workspace says why.** When the machine is offline, the message reads "Your Codespace is asleep or stopped. Open it and Tutor reconnects by itself", not a generic "unreachable".
4. **Fewer host calls per page.** An outline load takes about 0.7 s through Cloudflare. The world's workspace reads (progress, markers, layout) are batched into one host-entry call per load, and the target is under 0.3 s server-side.
5. **Codespace-only paths go.** The tutor Feature config file and the `coursePath` default `/workspaces/tutorial` are no longer read; a configured `coursePath` still works for development.

## Security

- **bb has no authentication.** Access is the only thing in front of each server: the browser policy names the GitHub org, and the machine policy names one service token. A route must never answer without Access. The provisioning check asserts a 302 to Access for an anonymous request.
- **The service token lets anyone who holds it drive that one student's server,** that is, run agents in that student's Codespace. It sits in the Codespace's environment, so the student's own agents can read it. That's acceptable for a pilot of instructors. Tokens are per student and revocable, and rotating one means a Codespaces secret update and a restart.
- **The student's own agent configuration is loaded** (`~/.claude`, `~/.codex`, `~/.pi` in the Codespace). Tutor's coach can be steered by the student's own instructions, skills and hooks. In a fresh Codespace there are almost none, which is another reason the pilot uses Codespaces.
- **On the box,** each student is an unprivileged user, and their server listens on loopback only. `ew-admin` operates the boxes, as today.

## Order

1. **The `bb` feature's machine mode.** Review and merge `bb/machine-mode` in devcontainer-features, and publish `bb` 1.1.0. Then add it to `capstone-project-starter`'s devcontainer, with the getting-started guide's new steps (secrets, agent sign-in, the link).
2. **The plugin.** Changes 1–5 above, test first. The end-to-end harness moves to the hosted shape (Testing).
3. **Provisioning.**
   - The `ew_tutor` role and the Cloudflare steps in the infrastructure repo.
   - `student-001`, the hand-made spike server, is re-created by them, and Spike 2's and 3's hand-made pieces are removed.
   - The policy and cloudflared changes on the branch `tailnet/tutor-spike2-student-001` merge, minus the tailnet grant, which students no longer need.
4. **Retirement.**
   - Remove `standalone/tutor`, `install.sh`, the launcher's release assets and its bats tests, and the spike scripts once their findings are in this document.
   - In devcontainer-features: deprecate the `tutor` feature and `bb`'s standalone mode for Tutor.
5. **The pilot.** Provision the instructors, send the links, collect what they think.

## Testing

- **Unit and integration:** the plugin's suite (`npm test`), with fakes for `system.providerStates`, `projects.create` and an offline machine.
- **End to end, in CI.** One runner, two Linux users:
  - one runs `bb-server` with the built plugin, as a student server would;
  - the other runs `bb-app host-daemon` against it over loopback, as the Codespace does. Access isn't in the loop, because CI can't hold a Cloudflare token.

  It runs today's Stage B unchanged: the scripted provider, then adopting, passing and completing the fixture's lessons 001–004, including the move at 004. Before that, the hosted first run creates the project.
- **The feature's CI** (devcontainer-features): its `machine` scenario, plus the existing ones.
- **By hand, before the pilot,** against a provisioned student:
  - the Access route: browser login, an anonymous 302, and a 200 with the token;
  - a real Codespace of the starter: it connects, the first run creates the workspace, and a Claude coach adopts Lesson 0;
  - the capstone course: added, then lesson 001 adopted;
  - resuming a stopped Codespace;
  - removing the student.

## Acceptance criteria

1. **From a link to a coach.** An instructor with their link and three secrets, starting from a new Codespace of the starter, signs in to Claude Code and opens the link. Their Lesson 0 coach replies, without any command from Tutor and without BB's name on Tutor's pages.
2. **The workspace is the Codespace.** Lesson 0's `.tutor/` is written in `/workspaces/capstone-project-starter`, and adding the capstone course keeps the starter files already there.
3. **The agent is theirs.** The coach runs on the first of Claude Code, Codex or pi they've signed in to. With none signed in, Tutor says which commands to run.
4. **Asleep and back.** After the Codespace stops and resumes, Tutor reconnects by itself. While it's stopped, Tutor says the Codespace is asleep.
5. **Only through Access.** Every student hostname redirects anonymous requests to Access. The machine's token reaches only that student's server.
6. **Provisioned and removed by the tools.** Adding and removing a student is the infrastructure repo's commands, with no hand edits on the box.

## Out of scope

- **Other machines:** a Linux or Mac laptop as the student's machine. The server side is the same, and the laptop needs its own installer for BB's machine with the token.
- **Self-serve sign-up,** automatic provisioning, and per-student VMs.
- **Authentication beyond Access,** and isolating the coach from the student's own agent configuration.
- **A model gateway or licence checks,** as in the standalone design.
- **Fixing BB's two header gaps** (`host-daemon join`, the `bb` CLI). The workarounds stand until BB fixes them; a report upstream needs the go-ahead.
