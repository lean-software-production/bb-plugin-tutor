# Standalone Tutor: a tutor server and a machine, both on the student's computer

Status: **proposed** 2026-10-02, revised after review the same day (see [Review](#review)). Today
Tutor runs only inside the `bb-tutor` Codespace, and only for the capstone course, whose factory
it assumes everywhere. This design does two things that touch the same code, so they go together:

- **Standalone.** A student on a Mac or Linux computer with Node and git runs `tutor up ~/my-course`,
  gets Tutor at `http://127.0.0.1:47386`, and keeps their work in an ordinary folder. Nothing else
  to install, no Docker, no Codespace.
- **Course-agnostic.** Tutor becomes a generic "learn to work with agents" tool. Its own Lesson 0
  needs no factory; the capstone's factory, specs, seeds and the move at 004 become one *course
  layout* that a fetched course turns on.

The server half is built to move: hosting Tutor later means running the same server elsewhere and
keeping only the machine on the student's computer. Terms follow [`GLOSSARY.md`](GLOSSARY.md).

BB is an implementation detail. Students see "Tutor", the `tutor` command and Tutor's pages; BB's
name stays out of the launcher's normal output.

## Decisions

1. **Two halves, two processes.** A **tutor server** (BB's server with this plugin and the fetched
   course) and a **machine** (BB's host daemon, which runs the agents, the student's code and
   Tutor's host entry). They are separate native user services, joined by BB's own machine
   enrolment, so the local setup has the same shape as the hosted one. The server never reads or
   writes the workspace itself.
2. **No Docker.** The machine has to run natively anyway, so Node and git are prerequisites
   whatever the server runs in; a container added a requirement without containing anything that
   matters.
3. **Mac and Linux only.** BB's host daemon supports macOS and Linux (Windows only through WSL2).
   Windows, a native installer and the BB desktop app are out of scope.
4. **Workspace, not factory.** Every course has a **workspace**: the student's folder, attached as
   the BB project, where threads run. A **course layout** is optional structure inside the
   workspace that a course declares; the capstone's factory is the `capstone-factory` layout.
   Tutor is gated on "workspace attached", and on "layout ready" only for lessons whose course
   declares a layout.
5. **Progress lives in the workspace.** By default in `.tutor/progress.yaml`; a layout may say
   where its progress goes, so the capstone keeps `ITERATION` and `spec/PROGRESS.yaml` and a
   student can still carry on with an agent outside Tutor.
6. **Tutor ships only Lesson 0.** The built-in "Using your tutor" lesson needs no factory and no
   network, and doubles as the fixture for tests. Every further lesson is **fetched content**:
   the student asks for it, and that fetch is where a licence check goes later.
7. **The workspace starts empty.** `tutor up` adds only `.git`, and Lesson 0 only `.tutor/`. Fetching a course with a layout
   seeds the workspace with that course's starter files.
8. **Server state outside the workspace.** The server's BB data is in `~/.tutor/server`; the
   machine's is in BB's canonical `~/.bb-machines/127.0.0.1-47386/`, because BB's installer only
   manages machines there.
9. **Localhost only.** Both services listen on `127.0.0.1` alone.
10. **The student signs Tutor's pi in themselves.** No model gateway in this version: `tutor login`
    runs pi's own login against a pi config kept apart from the student's own `~/.pi`. Coach
    threads are pinned to that pi. A gateway, with the licence key in place of the student's
    credentials, is a later design and replaces only `tutor login`.
11. **The plugin reaches the workspace through the machine.** Simple reads and guarded writes use
    BB's host-routed `sdk.files`; operations that must be whole (adopting a lesson, seeding) are a
    few coarse methods of the plugin's host entry. In the Codespace the machine is the Codespace
    itself, so it keeps working.
12. **The launcher is called `tutor`,** with the name in one variable so a course brand can rename
    it cheaply.
13. **Everything lives in this repo.** The launcher goes in `standalone/`, released with the plugin,
    so a plugin version names the BB version and launcher that go with it.

## Architecture

```
 student's Mac/Linux computer
 ┌───────────────────────────────────────────────────────────────────────┐
 │ tutor (launcher): up / login / open / status / stop / logs / uninstall│
 │                                                                       │
 │ tutor server  (user service)          machine  (user service)         │
 │ ┌───────────────────────────┐ enrol / ┌─────────────────────────────┐ │
 │ │ bb-server, pinned BB      │ HTTP    │ BB host daemon (same BB)    │ │
 │ │  + Tutor plugin           │◄───────►│  Tutor's host entry         │ │
 │ │  + Lesson 0, fetched      │         │  pi threads (Tutor's pi)    │ │
 │ │    course content         │         │  the student's code, tests  │ │
 │ │ 127.0.0.1:47386           │         │ 127.0.0.1:<daemon port>     │ │
 │ │ ~/.tutor/server           │         │ ~/.bb-machines/127.0.0.1-…  │ │
 │ └─────────────▲─────────────┘         └──────────────┬──────────────┘ │
 │      browser ─┘                                      │                │
 │                                         ~/my-course  ▼  (workspace)   │
 │ ~/.tutor/config, ~/.tutor/pi, ~/.tutor/bin                            │
 └───────────────────────────────────────────────────────────────────────┘
```

Hosted later: the left box moves to a server, `machineServerUrl` becomes its public URL, and the
right box is unchanged.

## The tutor server

`tutor up` installs and runs it; there is no image.

- **Install.** `npm install --prefix ~/.tutor/server/npm bb-app@<pinned>`, whose install scripts
  build `better-sqlite3`, `node-pty` and `@parcel/watcher` (npm runs them by default). The pinned BB
  version is a constant in the launcher, released with the plugin.
- **Run.** A user service (`~/Library/LaunchAgents/…tutor-server.plist` on macOS,
  `~/.config/systemd/user/tutor-server.service` on Linux) runs
  `bb-server --data-dir ~/.tutor/server --server-bind-host 127.0.0.1 --server-port 47386`.
  `bb-server` starts no host daemon, so the server has no hosts of its own: every thread runs on
  the enrolled machine.
- **Configure** on first start: `machineServerUrl http://127.0.0.1:47386` and
  `defaultMachineAccess direct`. It must be `127.0.0.1`, not `localhost`: with `localhost`, BB
  0.44.0's enrolment records `127.0.0.1`, its installer compares against `localhost`, decides the
  machine hasn't joined, and fails with "This enrollment route is available only from the server
  machine". This is to be reported to BB.
- **The plugin** is installed from the release's plugin archive, which the launcher carries, never
  from the network at run time.
- **It holds secrets**: BB's data directory has machine credentials and pi state. It is created
  `0700`.

## The launcher

`standalone/tutor` is one POSIX shell script, installed by
`curl -fsSL https://github.com/lean-software-production/bb-plugin-tutor/releases/latest/download/install.sh | sh`
into `~/.local/bin/tutor`; each release attaches `install.sh`, `tutor` and the plugin archive. Its
own state is `~/.tutor/config` (port, machine id, workspace, versions).

| Command | Does |
|---|---|
| `tutor up [folder]` | Starts or resumes everything. Safe to run again. |
| `tutor login` | Runs pi's login against Tutor's pi config. |
| `tutor open` | Opens Tutor in the browser. |
| `tutor status` | Server healthy, machine connected, workspace, pi signed in or not. |
| `tutor stop` | Stops both services; keeps everything. |
| `tutor logs` | Server and machine logs, for support. These are BB's own logs and say "bb". |
| `tutor uninstall [--purge]` | Removes both services and the machine's enrolment (with BB's installer `--uninstall`). `--purge` also removes `~/.tutor` and the machine directory. Never touches the workspace. |

`tutor up --server <url>` is reserved for the hosted Tutor; this version refuses it with a message.

### The first `tutor up ~/my-course`

1. **Check.** macOS or Linux; Node 22.19+, 24 or 26; npm; git. Each failure says what to install.
2. **Workspace.** Create the folder if it is missing; refuse a folder that is neither empty nor a
   Tutor workspace from an earlier `up` (one with `.tutor/`); `git init` it.
3. **Server.** Install the pinned `bb-app`, write and start the server service, wait for `/health`,
   configure it, install the plugin.
4. **Machine.** Start `bb machine create --provider manual` in the background (it prints the
   enrolment command and then waits for the machine to connect, so waiting on it first would
   deadlock). Read the command from its output file, keep the one-time header in a `0600` file and
   pass it to curl with `-H @file`, never in arguments or output. Run BB's installer, its output
   kept in `~/.tutor/install.log`; it sets up the machine's service. If the command expires before
   the installer runs, start again from `machine create`.
5. **pi.** Install the pinned pi into `~/.tutor/bin`. Add to the machine service's environment (a
   systemd drop-in, or the launchd plist's `EnvironmentVariables`, rewritten whenever BB's installer
   rewrites the plist) `PI_CODING_AGENT_DIR` and `BB_PI_BRIDGE_COMMAND`, as absolute paths to
   `~/.tutor/pi` and `~/.tutor/bin/pi`,
   and restart the machine service.
6. **Project.** Create the BB project from the workspace on that machine and set Tutor's
   `workspaceProject` to it.
7. **pi sign-in.** Check pi's readiness for `~/.tutor/pi`. If it isn't signed in, finish anyway
   and say "Run `tutor login` to connect Tutor to a model provider".
8. **Open** `http://127.0.0.1:47386`.

Later runs skip what `~/.tutor/config` and the checks show is done, restart what is stopped, and
repair what is missing (a service, the environment additions after a BB update rewrote the plist).
The default port is 47386 so a student already running BB on 38886 isn't disturbed; `--port`
changes it.

### Keeping Tutor's pi apart

BB's pi provider reads `PI_CODING_AGENT_DIR` from the daemon's environment and starts pi through
`BB_PI_BRIDGE_COMMAND` when set (both checked in BB 0.44.0's `provider-pi`). Setting them on the
machine service gives Tutor its own pi config without touching `~/.pi`. Coach threads are spawned
with the provider set to pi explicitly (`server/coach/threads.ts` passes none today), so Tutor never
falls back to another agent.

The reverse leak matters too: on Linux the machine service inherits the systemd user manager's
environment, which can hold the student's own provider keys (the spike found `OPENCODE_API_KEY`).
`PI_CODING_AGENT_DIR` keeps pi's files apart, not its environment, so the machine's drop-in also
unsets every provider credential by name, coach threads are pinned to the provider and model
chosen at `tutor login`, and `tutor status` names any key that still reaches Tutor's agents
(see the plan's amendments from the Linux spike).

Because the variables are daemon-wide, everything the machine runs inherits them, including a
course's own tools. The `capstone-factory` layout's tooling (`pi-rpc-acp`, which the factory's
tests use from homework 6) must choose its agent config explicitly rather than inherit Tutor's;
that layout's starter files carry the setting. **Not yet verified on a real machine:** that both
variables survive a service restart on both OSes, and that login, discovery and threads use
`~/.tutor/pi`. This is the plan's first task.

## Workspaces and course layouts

Today almost every path checks `factoryProject.status === "found"` and `resolveLayout` fails without
a factory folder. After this change:

- **`workspaceProject`** replaces `factoryProject` as the setting and the gate. Home, outline,
  tools, signals and views need a workspace attached, nothing more. The world model carries the
  workspace and, separately, the layout state.
- **A course declares its layout** in `course.yaml` (`layout: capstone-factory`). Lesson 0 declares
  none. A lesson of a course with a layout waits for "layout ready", with its own message.
- **The `capstone-factory` layout** is today's code, moved behind one interface: factory location
  (`tetris/.factory` through 003, `factory/` from 004), spec copying, seeds, stand-ins, the move at
  004, `ITERATION` and `spec/PROGRESS.yaml`. Nothing about it changes for the student.
- **Progress** without a layout is `.tutor/progress.yaml` in the workspace, in the same format as
  `PROGRESS.yaml`. With a layout, the layout says where.
- **Course text** that names the factory stays in the capstone course; Tutor's own copy (welcome
  page, Lesson 0, the coach skill's general parts) talks about the workspace and agents. The welcome
  page loses its Codespace-clone and BB wording.

## The plugin split

The server keeps the course and the decisions; the machine keeps the workspace.

- **Reads and simple writes** use BB's host-routed `sdk.files` with the workspace's `hostId`, which
  confines writes to the project and supports compare-and-swap: probing for `.tutor/` and the
  layout's marker files, reading progress, writing progress.
- **Whole operations** are host-entry methods (`experimental_defineHostEntry` in `host.ts`, called
  with `bb.hosts.experimental_client(...).call(method, args, { hostId })`), each run under a
  host-side lock so a failure never leaves half an operation:

| Host method | Does |
|---|---|
| `adoptLesson(root, lesson, bundle)` | The layout's spec copy and factory move (today's `spec-copy.ts`, `factory-move.ts`, including `git mv` and the skills link), plus the `ITERATION` and progress writes, as one operation with today's recovery behaviour. |
| `seedWorkspace(root, bundle)` | Writes a fetched course's starter files into the workspace; resumable, so an interrupted seed finishes on the next call. |

- **Every server-side path into the workspace goes**, including the ones the first draft missed:
  `resolveFactory`'s `pathExists`, world loading's `overlaps`/`resolveLayout`
  (`server/coach/world.ts:85`), the candidate probes (`server/rpc/candidates.ts`), and the
  workspace half of `coach-file.ts`. A machine that is offline makes the workspace "unreachable",
  with its own message, not "missing".
- **The coach file reaches the agent as content.** Prompts and the skill point the agent at a
  coach-file path today; a server path is meaningless on the machine, so the server reads the
  course's coach file and puts it in the thread's instructions (the workspace's own coach file the
  agent can read where it is).
- **Bundles.** Course files travel as a bundle: a list of entries, each a relative path, a kind
  (`file`, `symlink`), the mode's executable bit, and contents as base64 (or the link target). The
  host validates every path (relative, no `..`, inside the target) and refuses absolute or
  escaping links, as today's `spec-copy` does. This replaces the course paths `spec-copy` reads
  directly today (`lesson.dir`, the course's `stand-ins/`).
- **Size.** BB 0.44.0 documents host calls as 32 MiB in, 8 MiB out, 30-second default timeout.
  Lessons and starters are far smaller; the plan measures them, and there is no chunking unless the
  numbers call for it.
- **Pins.** The host-entry API is `experimental_`, so BB and `@get-bb/plugin-sdk` are pinned
  together, and each bump runs the end-to-end test.

## Course content

- **Built in:** Lesson 0, as today (`server/course/builtin/`), rewritten where it assumes the
  capstone ("lesson 1 is ready", "there is no factory yet"). It needs only the workspace. It is the
  fixture for every test that doesn't exercise fetching.
- **Fetched:** a Tutor tool, `tutor_fetch_course`, and an "Add the course" step in the outline after
  Lesson 0. The server clones the course repo, and the starter repo if the course declares one, at
  refs pinned by the plugin's settings, into `~/.tutor/server/content/`, then calls `seedWorkspace`
  with the starter's files (not its tool files or devcontainer). The fetched lessons follow Lesson 0
  in the outline. More than one course can be fetched; the outline lists each.
- **Licensing later:** a check at fetch time cannot protect content that sits in public
  repositories. Where gated content is hosted, and where the student's licence credential is stored,
  is the licence design's decision, not this one's.
- An explicit `coursePath` setting or the tutor Feature's config still wins over fetched content, so
  the Codespace keeps its own course checkout.

## Security

- Both listeners bind `127.0.0.1` only, and `tutor status` checks there are no others.
- Loopback is not authentication: any local process, and any user on a shared computer, can call
  BB's API, which reads files and runs commands. BB's Host/Origin checks stay on, and nothing in this
  design turns them off. Per-user authentication is required before the server is hosted.
- `~/.tutor/server` and the machine directory hold credentials and are `0700`; the enrolment header
  only ever sits in a `0600` file.

## Order

1. Verify pi's environment on real machines (both OSes): variables survive service restarts; login,
   discovery and coach threads use `~/.tutor/pi`.
2. Workspace and layouts: `workspaceProject`, the gates, the `capstone-factory` layout interface,
   `.tutor/progress.yaml`; Lesson 0 rewritten. The Codespace stays green.
3. The plugin split: `sdk.files` reads and writes, `adoptLesson` and `seedWorkspace`, bundles, coach
   file as content, coach threads pinned to pi.
4. Course fetching and the outline's "Add the course" step.
5. The launcher, its tests and `install.sh`: both services, enrolment, pi, the project.
6. The end-to-end test on Linux; the macOS checklist.
7. Release: launcher, plugin archive and BB pin under one version; bump the tutor Feature's plugin
   pin; report the `localhost` enrolment bug to BB.

## Testing

- **Layouts and host methods** against temp folders. Most of today's `spec-copy`, `factory-move` and
  progress tests move with the code into the `capstone-factory` layout's tests. Bundle validation
  gets its own tests (escaping paths, links, modes).
- **Server** tests use a fake host client and fake `sdk.files`, and fail if the server touches a
  workspace path itself. A course without a layout runs through Lesson 0 with no factory anywhere.
- **Launcher** tests (bats) stub `npm`, `curl`, `node`, `systemctl`/`launchctl`, `bb` and the
  installer: arguments, the state file, step skipping and repair on re-run, the background
  `machine create`, expiry, prerequisite messages, and that no secret reaches arguments or output.
- **End-to-end on Linux** in CI: `tutor up` on a temp folder; both services up; machine connected;
  workspace attached; **Lesson 0** offline: a coach thread starts on the machine and progress lands
  in `.tutor/progress.yaml`; **fetch** a small fixture course with the `capstone-factory` layout:
  the workspace is seeded, lesson 001 adopted (`spec/`, `ITERATION`), the factory's tests run on
  the machine, and lesson 004's move happens there; `tutor stop` then `tutor up` resumes;
  `tutor uninstall --purge` leaves no service file, no `~/.tutor`, no machine directory. pi is
  stubbed through `BB_PI_BRIDGE_COMMAND`: CI makes no model calls.
- **macOS**: a checklist by hand for each release (launchd services and their environment, `PATH`,
  native modules) until there is a Mac runner.

## Acceptance criteria

### 1. One command to a working Tutor

On a Mac or Linux computer with Node and git, `tutor up ~/my-course` ends with Tutor open at
`http://127.0.0.1:47386` and `tutor status` showing the server healthy and the machine connected.

### 2. Lesson 0 needs nothing else

With pi signed in, a student can do all of Lesson 0 with no course fetched and no factory; the
workspace then holds only `.git` and `.tutor/`.

### 3. The course arrives when asked

"Add the course" fetches it, seeds the workspace with its starter and shows its lessons after
Lesson 0. Before that, nothing from it is on the computer.

### 4. The work happens in the workspace

Adopting a capstone lesson writes `spec/` and `ITERATION` in the student's folder, and the factory's
tests run there. The server's directory never holds a copy of the workspace.

### 5. The student's own pi is untouched

`tutor login` and the coach threads use `~/.tutor/pi`; `~/.pi` is the same before and after.

### 6. Only localhost

Nothing Tutor starts listens on anything but `127.0.0.1`.

### 7. Stop, start, survive

`tutor stop` then `tutor up`, or a reboot then `tutor up`, brings back the same threads, progress
and workspace.

### 8. Clean removal

`tutor uninstall --purge` removes everything Tutor installed, and leaves the workspace as it was.

### 9. The Codespace still works

The `bb-tutor` Codespace, with the plugin at this version, coaches Lesson 0 and lesson 001 as
before.

### 10. BB stays out of sight

Nothing the launcher prints, apart from `tutor logs`, says "bb".

## Out of scope

- A model gateway and the licence key, including where licensed content is hosted.
- Hosting the tutor server (`tutor up --server <url>` is reserved), and per-user authentication,
  which hosting requires.
- Windows, a native installer, and a Tutor build of the BB desktop app.
- Unbranding BB's own web UI beyond what Tutor's theme already does.

## Review

The first draft (a Docker container for the server) was reviewed by two Codex threads,
BB threads `thr_xxn873a9mk` (gpt-6-sol) and `thr_mtzfcwusnx` (gpt-6-astra). Both recommended
dropping Docker; this revision takes gpt-6-sol's shape (native server plus an enrolled machine)
over gpt-6-astra's single `bb-app`, to keep the hosted shape from day one, and takes their verified
corrections: the host-call limits, the canonical machine directory, the background
`machine create`, the missed server-side paths, bundles that carry links and modes, adoption with
its progress writes as one operation, the coach file as content, pinning coach threads to pi,
pi's environment leaking into course tools, the fetch-first UI, and the security wording.
