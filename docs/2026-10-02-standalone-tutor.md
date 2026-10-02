# Standalone Tutor: a tutor server in a container, a machine on the student's computer

Status: **proposed** 2026-10-02, for review. Today Tutor runs only inside the `bb-tutor` Codespace,
where the devcontainer Features install BB, the agents, the course and this plugin into one Linux
box. This design lets a student run Tutor with nothing but Docker, Node and git on a Mac or Linux
computer: one `tutor up ~/my-course` command, a page at `http://127.0.0.1:47386`, and their course
work in an ordinary folder on their own disk. It is also the first step to a hosted Tutor: the
server half is built so that it can later run somewhere else unchanged. Terms follow
[`GLOSSARY.md`](GLOSSARY.md).

BB is an implementation detail here. Students see "Tutor", the `tutor` command and Tutor's pages;
the words "bb", "machine" and "host daemon" stay out of everything the launcher prints.

## Decisions

1. **Two halves.** A **tutor server** (BB's server, this plugin, the course) runs in a container.
   A **machine** (BB's host daemon, pi, the factory's tools) runs natively on the student's
   computer and is the only thing that touches their files or runs their code. The server never
   reads or writes the workspace itself.
2. **Mac and Linux machines only.** BB's host daemon supports macOS and Linux (Windows only through
   WSL2). Windows, a native installer and the BB desktop app are out of scope.
3. **The workspace starts empty.** The student names an empty folder. "Fetch content" fills it.
4. **Server state lives in a named Docker volume** (`tutor-server-state`), not in a host folder:
   SQLite over Docker Desktop's file sharing risks locking trouble, and the volume survives the
   container. It is deleted only by `tutor uninstall --purge`.
5. **Localhost only.** The container publishes its port on `127.0.0.1` alone.
6. **The course is fetched, not shipped.** Neither the image nor the launcher contains course
   content. The server fetches the course and the starter when the student asks for content, and
   that fetch is the one place a licence check goes later.
7. **Tool files ship with the launcher, project files with the content.** `pi-rpc-acp` and
   `doctor` are installed onto the machine by `tutor up`; `tetris/`, the factory and the rest of
   the starter project arrive with "fetch content".
8. **The student authenticates the tutor's pi themselves.** There is no model gateway in this
   version: `tutor login` runs pi's own login against a pi config kept apart from the student's own
   `~/.pi`. A gateway, with the licence key in place of the student's credentials, is a later
   design and replaces only `tutor login`.
9. **The plugin talks to the workspace through a host entry.** File work on the factory moves out
   of the server into a few coarse methods of the plugin's host entry, which BB runs on the machine
   that holds the project. In the Codespace that is the Codespace itself, so the Codespace keeps
   working.
10. **The launcher is called `tutor`.** The name is one variable in the script, so a later course
    brand can rename it cheaply.
11. **Everything lives in this repo.** The image and the launcher go in `standalone/`, released
    with the plugin, so a plugin version always names the image and launcher that go with it.

## Architecture

```
 student's Mac/Linux computer                     tutor-server container
 ┌────────────────────────────────────┐          ┌──────────────────────────────┐
 │ tutor (launcher)                   │ docker   │ bb-server (pinned BB)        │
 │   up/login/open/status/stop/       ├──run────►│  + Tutor plugin (this repo)  │
 │   logs/uninstall                   │          │  + fetched course & starter  │
 │                                    │          │  no hosts of its own         │
 │ machine (BB host daemon)           │◄────────►│  state: tutor-server-state   │
 │   launchd / systemd user service   │  HTTP    └──────────────▲───────────────┘
 │   runs Tutor's host entry, pi,     │                         │ 127.0.0.1:47386
 │   the factory's tests, git         │      browser ───────────┘
 │                                    │
 │ ~/my-course        workspace       │
 │ ~/.tutor/config    launcher state  │
 │ ~/.tutor/machine   machine state,  │
 │                    pi config, bin/ │
 └────────────────────────────────────┘
```

## The tutor server image

`standalone/server/Dockerfile` builds `ghcr.io/lean-software-production/tutor-server:<plugin
version>`:

- From `node:24-trixie-slim`, with git and CA certificates. `bb-app` is installed globally at the
  pinned BB version, with `allow-scripts` for `better-sqlite3`, `node-pty` and `@parcel/watcher`.
- This plugin is built into the image and installed at first start from the copy in the image,
  never from the network.
- `/state` is created in the image and owned by `node`; it is BB's data dir. (Without this, Docker
  creates the volume root-owned and the server fails with `EACCES`.)
- It runs `bb-server --server-bind-host 0.0.0.0 --server-port 38886` as `node`. It starts no host
  daemon, so the server has no hosts of its own and every thread runs on an enrolled machine.
- The entrypoint sets, before the server takes requests, `machineServerUrl` to
  `http://127.0.0.1:<published port>` (passed in as `TUTOR_PUBLIC_URL`) and `defaultMachineAccess`
  to `direct`. It must be `127.0.0.1`, not `localhost`: with `localhost`, BB 0.44.0's enrolment
  records `127.0.0.1`, its installer compares against `localhost`, decides the machine has not
  joined, and fails with "This enrollment route is available only from the server machine". This
  is to be reported to BB.
- It holds no secrets.

## The launcher

`standalone/tutor` is one POSIX shell script, installed by
`curl -fsSL https://github.com/lean-software-production/bb-plugin-tutor/releases/latest/download/install.sh | sh`
into `~/.local/bin/tutor`; each release attaches `install.sh` and `tutor` as assets. It keeps its own state in
`~/.tutor/config` (port, machine id, workspace, image tag).

| Command | Does |
|---|---|
| `tutor up [folder]` | Starts or resumes everything. Safe to run again. |
| `tutor login` | Runs pi's login for the tutor's own pi config. |
| `tutor open` | Opens the Tutor page in the browser. |
| `tutor status` | Server healthy, machine connected, workspace, agent signed in or not. |
| `tutor stop` | Stops the container and the machine service; keeps everything. |
| `tutor logs` | Server and machine logs, for support. |
| `tutor uninstall [--purge]` | Removes the service, the machine, the container and the image. `--purge` also removes `~/.tutor` and the volume. It never touches the workspace. |

`tutor up --server <url>` is reserved for the hosted Tutor; this version refuses it with a
message.

### The first `tutor up ~/my-course`

1. **Check.** Docker answers; Node is 22.19+, 24 or 26; git is present; the OS is macOS or Linux.
   Each failure says what to install.
2. **Workspace.** Create the folder if it is missing. Refuse a folder that is neither empty nor a
   Tutor workspace from an earlier `up`. `git init` it.
3. **Server.** `docker run -d --name tutor-server --restart unless-stopped -p
   127.0.0.1:47386:38886 -v tutor-server-state:/state -e TUTOR_PUBLIC_URL=http://127.0.0.1:47386
   tutor-server:<version>`, then wait for `/health`.
4. **Machine.** Ask the server (through `docker exec … bb machine create --provider manual`) for an
   enrolment command; keep its one-time header in a `0600` file, never in arguments or output; run
   BB's installer with `BB_DATA_DIR=~/.tutor/machine`, its output kept in
   `~/.tutor/machine/install.log`. The installer sets up the launchd or systemd user service.
5. **Tools.** Install `pi` (pinned) and the bundled `pi-rpc-acp` and `doctor` into
   `~/.tutor/machine/bin`, and make sure the machine service's environment has that directory on
   its `PATH` and `PI_CODING_AGENT_DIR=~/.tutor/machine/pi`.
6. **Project.** Create the BB project from the workspace on that machine and set Tutor's
   `factoryProject` to it.
7. **Agent.** Check pi's readiness for the tutor's pi config. If it isn't signed in, finish anyway
   and say "Run `tutor login` to connect Tutor to a model provider".
8. **Open** `http://127.0.0.1:47386`.

Later runs skip the steps `~/.tutor/config` and the checks show are done, restart what is stopped,
and repair a machine service that is missing.

The default port is 47386 so that a student already running BB on 38886 isn't disturbed;
`--port` changes it.

### Keeping the tutor's pi apart

BB runs pi threads on the machine, and BB reads pi's config from `~/.pi/agent`. The tutor's pi gets
its own config in `~/.tutor/machine/pi` through `PI_CODING_AGENT_DIR` in the machine service's
environment, so `tutor login` never changes the student's own pi. **Not yet verified:** that BB's pi
provider passes `PI_CODING_AGENT_DIR` through, and finds `pi` on the service's `PATH` (the Codespace
needed `post-create.sh` to link the ACP adapters into `/usr/local/bin` because BB's threads have a
fixed `PATH`). This is the plan's first task. If either fails, the launcher puts a `pi` wrapper that
sets the variable into `~/.tutor/machine/bin` and points BB's pi provider at it.

## The plugin split

The server keeps the course and the decisions; the machine keeps the workspace. They talk through
the host entry (`experimental_defineHostEntry` in `host.ts`, called with
`bb.hosts.experimental_client(...).call(method, args, { hostId })`), one method per operation, so
each operation runs whole on the machine in one round trip. These methods wrap today's modules,
which move largely unchanged:

| Host method | Wraps |
|---|---|
| `probeProject(root)` | `resolveLayout`, `findRepoRoot`, the candidate probes in `rpc/candidates.ts` |
| `readProgress(root)` | the reads in `progress/store.ts` (`ITERATION`, `spec/PROGRESS.yaml`) |
| `writeProgress(root, …)` | `progress/atomic-write.ts` |
| `adoptLesson(root, lesson, files)` | `progress/spec-copy.ts` and `progress/factory-move.ts`, including `git mv` and the skills link at 004 |
| `checkFactoryMove(root)` | `checkFactoryMove` |
| `seedWorkspace(root, files)` | new: writes the starter's project files into an empty workspace |

- `resolveFactory` no longer checks `pathExists(source.path)` on the server; it asks
  `probeProject` on the project source's `hostId`. A machine that is offline makes the factory
  "unreachable", with its own message, not "missing".
- Course files are read on the server and sent in the call: `adoptLesson` gets the lesson's spec
  and seed files as `{ path: contents }`. The course is never a checkout on the student's machine.
- `coach-file` splits: the course's coach file is read on the server, the factory's on the machine.
- The heartbeat stays on the server. It exists for the Codespace's keep-alive and does nothing
  without one.
- **Risks:** the host-entry API is `experimental_` and may change between BB releases, so BB stays
  pinned and each bump runs the end-to-end test. The payload limit of `host.call` is unknown; the
  plan measures it first, and if lesson files can exceed it, `adoptLesson` sends files in chunks.

### Fetch content

A Tutor tool, `tutor_fetch_content`, and a button on the first-run page. The server:

1. Clones `courseRepo` and `starterRepo` at their pinned refs into `/state/content/` (or updates
   them). The repos and refs are plugin settings whose defaults each plugin release pins. Today both are public GitHub repos; the licence check goes here later.
2. Calls `seedWorkspace` with the starter's project files, leaving out the tool files and the
   devcontainer.
3. Shows the outline, ready to start lesson 001.

An explicit `coursePath` setting or Feature config still wins over fetched content, so the
Codespace keeps its own course checkout.

## Order

1. Verify the pi config and `PATH` question on a real machine; pick the wrapper fallback if needed.
2. Measure the `host.call` payload limit.
3. The host entry and the server changes, with fake-host tests, keeping the Codespace green.
4. Fetch content and `seedWorkspace`.
5. The tutor server image and its smoke test.
6. The launcher, its tests and `install.sh`.
7. The end-to-end test on Linux; the macOS checklist.
8. Release: image, launcher and plugin under one version; bump the tutor Feature's plugin pin.

## Testing

- **Host methods** run against temp folders. Most of today's `spec-copy` and `factory-move` tests
  move with the code.
- **Server** tests use a fake host client and check that no factory path is touched on the
  server.
- **Launcher** tests (bats) stub `docker`, `curl`, `node` and the installer: arguments, the state
  file, step skipping on re-run, prerequisite messages, and that no secret reaches arguments or
  output.
- **Image smoke test** in CI: build, run, `/health` answers, the server has no hosts, the machine
  URL is `127.0.0.1`, Tutor is loaded.
- **End-to-end on Linux** in CI: `tutor up` on a temp folder; machine connected; project attached;
  fetch content seeds the workspace; adopting lesson 001 writes `spec/` on the machine; a command
  run from the server lands in the workspace; `tutor stop` then `tutor up` resumes;
  `tutor uninstall --purge` leaves no service file, no `~/.tutor`, no container and no volume.
  pi is stubbed: CI makes no model calls.
- **macOS**: a checklist run by hand for each release (launchd, Docker Desktop) until there is a
  Mac runner.

## Acceptance criteria

### 1. One command to a working Tutor

On a Mac or Linux computer with Docker, Node and git, `tutor up ~/my-course` ends with the Tutor
page open at `http://127.0.0.1:47386` and `tutor status` showing the server healthy and the
machine connected.

### 2. Content arrives when asked

In an empty workspace, asking Tutor to fetch content fills the folder with the starter project and
shows the outline. Nothing from the course is on disk before that.

### 3. The work happens on the student's computer

Adopting a lesson writes `spec/` and `ITERATION` in the student's folder, and the factory's tests
run there. The container never holds a copy of the workspace.

### 4. The student's own pi is untouched

`tutor login` and the tutor's threads use `~/.tutor/machine/pi`; `~/.pi` is the same before and
after.

### 5. Only localhost

Nothing listens on anything but `127.0.0.1` on the student's computer.

### 6. Stop, start, survive

`tutor stop` then `tutor up`, or a reboot then `tutor up`, brings back the same threads, progress
and workspace.

### 7. Clean removal

`tutor uninstall --purge` removes everything Tutor installed, and leaves the workspace as it was.

### 8. The Codespace still works

The `bb-tutor` Codespace, with the plugin at this version, coaches lesson 001 as before.

### 9. BB stays out of sight

Nothing the launcher prints says "bb", "machine" or "host daemon".

## Out of scope

- A model gateway and the licence key (a later design; it replaces `tutor login`).
- Hosting the tutor server (`tutor up --server <url>` is reserved).
- Windows, a native installer, and a Tutor build of the BB desktop app.
- Making BB's own web UI unbranded beyond what Tutor's theme already does.
