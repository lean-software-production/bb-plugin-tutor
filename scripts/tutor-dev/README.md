# tutor-dev: a local BB plugin harness

These scripts run a disposable BB inside a dev container that is built from a
local copy of the bb Feature (standalone mode, `autoStart: true`). The bb
Feature lives in
[devcontainer-features](https://github.com/lean-software-production/devcontainer-features/tree/main/src/bb),
not in this repo, so point `TUTOR_DEV_BB_FEATURE` at the `src/bb` directory of a
checkout of it.
You can install a plugin from a host directory, drive the BB CLI inside the
container, and screenshot any BB route with host-side Playwright chromium.
The harness never touches a BB running on the host.

| Script | What it does |
| --- | --- |
| `up.sh [--rebuild] [--no-cache]` | Builds and starts the container, or reuses it. It confirms `bb-feature-status` inside the container, then `/health` through the published port. Prints the BB URL. |
| `down.sh [--rm \| --purge]` | Stops the container. `--rm` removes it and keeps BB state. `--purge` also deletes the generated workspace and the BB state. |
| `bb.sh <args…>` | Runs `bb <args…>` inside the container against the harness BB, for example `bb.sh status` or `bb.sh plugin logs tutor`. `bb.sh --exec <cmd…>` runs any other command, for example `bb.sh --exec bash`. |
| `install-plugin.sh <dir> [--copy] [--no-build] [--npm-install]` | Installs the plugin on first run. Every later run rebuilds it and reloads it. It then prints the plugin's status and exits non-zero if the status is not `running` or `degraded`. |
| `shot.mjs <route> <out.png> [--wait-for <sel>] [--settle ms] [--size WxH] [--full-page] [--dark] [--verbose]` | Screenshots `http://127.0.0.1:$TUTOR_DEV_PORT<route>` with headless chromium. Browser console errors, failed requests and HTTP 4xx/5xx responses are echoed to stderr. |

| `plugins-at-start.sh <plugin-dir>…` | Runs **inside** the container as a `postStartCommand` (set `TUTOR_DEV_POST_START`). Waits for `bb plugin list` to answer, then path-installs each directory that is not already installed from that path. Idempotent across restarts; logs timings to `$BB_DATA_DIR/.tutor-dev-plugins-at-start.log`. |

`relay.mjs` and `lib.sh` are internal: `relay.mjs` is the in-container TCP
relay and `lib.sh` holds the shared config.

The Feature-plus-plugin end-to-end walk lives in [`e2e/`](e2e/README.md).

## Quick start

```sh
git clone https://github.com/lean-software-production/devcontainer-features.git ../devcontainer-features
export TUTOR_DEV_BB_FEATURE="$PWD/../devcontainer-features/src/bb"
scripts/tutor-dev/up.sh                                   # first build takes about 50 s, then about 2 s
scripts/tutor-dev/bb.sh status
scripts/tutor-dev/install-plugin.sh .                     # path-installed in place (any plugin dir works)
node scripts/tutor-dev/shot.mjs / ../shots/home.png --wait-for 'text=New thread'
node scripts/tutor-dev/shot.mjs /plugins/<id>/<navPanel path> ../shots/page.png --wait-for 'text=Some heading'
# edit the plugin on the host, then:
scripts/tutor-dev/install-plugin.sh .                     # rebuild and reload
scripts/tutor-dev/bb.sh plugin logs tutor
```

`up.sh` stops with an error naming the fix when `TUTOR_DEV_BB_FEATURE` is
unset, missing, or not the bb Feature (it checks for `install.sh` and a
`devcontainer-feature.json` whose `id` is `bb`). The other scripts do not need
it. Once the bb Feature is published to GHCR, the published Feature is meant
to become the default, and `TUTOR_DEV_BB_FEATURE` an override for testing
local Feature changes.

Docker, `devcontainer` and chromium all need real host access. In a sandboxed
agent shell, run these with the sandbox disabled.

## How it fits together

- **Feature under test.** `up.sh` copies `$TUTOR_DEV_BB_FEATURE` to
  `$TUTOR_DEV_HOME/workspace/.devcontainer/features/bb` on every run, because
  Dev Containers only accepts local Features beneath the consuming
  `.devcontainer`. It then generates `devcontainer.json` next to it. The image
  is `javascript-node:5-24-trixie`, like the Feature's own test scenarios. The
  bb version comes from the Feature's default unless `TUTOR_DEV_BB_VERSION` is
  set.
- **Reaching BB from the host.** The Feature binds BB to `127.0.0.1` inside the
  container, and the harness leaves it that way. Setup:
  - BB's server port inside the container is `TUTOR_DEV_PORT` (default
    47886). Its host daemon is on `TUTOR_DEV_PORT+1` and is never published.
  - `relay.mjs` listens on `0.0.0.0:TUTOR_DEV_PORT+10` inside the container
    and pipes raw TCP to `127.0.0.1:TUTOR_DEV_PORT`.
  - Docker publishes `127.0.0.1:TUTOR_DEV_PORT` on the host to that relay port.

  The host browser therefore opens `http://127.0.0.1:47886`, and the Host and
  Origin headers it sends are exactly BB's own loopback origin. BB's origin
  guard accepts `http://127.0.0.1:<serverPort>` natively, so the harness needs
  no `appUrl` override, `--host-resolver-rules` or header rewriting.
  WebSockets and terminals work because the relay is plain TCP. Foreign
  origins are still rejected with 403.
- **Why the ports differ from the host's BB.** Inside the harness the web app
  probes `http://127.0.0.1:<hostDaemonPort>/status` from the browser. With
  default ports, a host-side browser would reach the host's own BB (38886 and
  its daemon on 38887). The scripts refuse 38886 and 38887, and `shot.mjs`
  hides the expected connection-refused daemon probes unless you pass
  `--verbose`.
- **Mounts and state.** `TUTOR_DEV_MOUNT` defaults to the parent of this repo
  checkout. It is bind-mounted read-write at the
  **same absolute path** inside the container, and it is the container's
  workspace folder. BB state (`dataDir`) lives in `$TUTOR_DEV_HOME/state`
  (default `<repo>/.tutor-dev/state`, which is git-ignored), so it survives
  `down.sh`, `down.sh --rm` and container recreation. The container user
  `node` is remapped to your host uid, so files BB or the build write into the
  mount belong to you.
- **Plugin installs.** A plugin directory under the mount is path-installed in
  place, and BB reads it live from your checkout. A plugin directory outside
  the mount, or any directory passed with `--copy`, is copied to
  `/home/node/tutor-dev-plugins/<id>`. A copied plugin is lost when the
  container is recreated; re-run `install-plugin.sh`. When the plugin has no
  `node_modules`, `npm ci` runs inside the container and writes into the
  plugin directory. `bb plugin build` fetches its toolchain once per BB state.
- **Idempotence.** `up.sh` hashes the generated config and the copied Feature.
  It reuses a running container, starts a stopped one, and recreates the
  container (keeping state) only when that hash changes. A recreate happens
  after you edit the bb Feature source or change `TUTOR_DEV_*`. The relay is (re)started on
  every `up.sh` and exits quietly if it is already running.
- **Naming.** The container is `tutor-dev-bb` with the devcontainer id-label
  `tutor-dev.harness=tutor-dev-bb`. The scripts only touch a container that
  has both the name and the label.

## Configuration (environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `TUTOR_DEV_BB_FEATURE` | none (required by `up.sh`) | The bb Feature source directory: `src/bb` in a devcontainer-features checkout. Copied into the generated workspace on every `up.sh`. |
| `TUTOR_DEV_NAME` | `tutor-dev-bb` | Container name and id-label value. Set it, and a different `TUTOR_DEV_PORT`, to run a second harness. |
| `TUTOR_DEV_PORT` | `47886` | BB server port inside the container, and the host loopback port it is published on. |
| `TUTOR_DEV_DAEMON_PORT` | port+1 | BB host-daemon port. Loopback inside the container only. |
| `TUTOR_DEV_RELAY_PORT` | port+10 | In-container relay port that the published port targets. |
| `TUTOR_DEV_HOME` | `<repo>/.tutor-dev` | Generated workspace and BB state. Must sit inside the mount. |
| `TUTOR_DEV_MOUNT` | parent of the repo | Host directory bind-mounted at the same path. |
| `TUTOR_DEV_IMAGE` | `mcr.microsoft.com/devcontainers/javascript-node:5-24-trixie` | Base image. |
| `TUTOR_DEV_BB_VERSION` | empty | Overrides the Feature's `version` option. |
| `TUTOR_DEV_POST_START` | empty | Command line written as the generated `postStartCommand`. It runs after the bb Feature's `bb-feature-autostart`, which blocks until the server and daemon are ready. Example: `TUTOR_DEV_POST_START="$PWD/scripts/tutor-dev/plugins-at-start.sh /abs/plugin"`. |
| `PLAYWRIGHT_MODULE` | `~/ensembleworks/node_modules/playwright` | Playwright package that `shot.mjs` uses. |

## Container environment

The generated config sets `BB_SERVER_URL`, `BB_DATA_DIR` and `BB_HOST_DAEMON_PORT`
as `containerEnv`, and `bb.sh` passes the same three to `docker exec`. The
bb CLI needs `BB_HOST_DAEMON_PORT` for anything that talks to the local host
daemon (for example `bb project create --root …`). Without it the CLI assumes
the default daemon port and fails with "Cannot reach local host daemon".

Keep scratch git repos for BB projects under the mount, for example
`work/spike/scratch-repo`, not under `/home/node`. `/home/node` lives in the
container filesystem, so it is lost when `up.sh` recreates the container.

## Troubleshooting

- BB launcher log: `$TUTOR_DEV_HOME/state/.bb-feature/launcher.log`.
- Relay log: `scripts/tutor-dev/bb.sh --exec cat /tmp/tutor-dev-relay.log`.
- `devcontainer up` output: `$TUTOR_DEV_HOME/devcontainer-up.{json,log}`.
- A plugin fails to load: run `bb.sh plugin list` and `bb.sh plugin logs <id>`.
- To start from nothing, run `down.sh --purge && up.sh --no-cache`.

## Security notes

- Nothing from the host's provider credentials (`~/.claude`, `~/.codex`,
  `~/.pi` or tokens) is mounted or copied into the container. Sign in to a
  provider inside the harness BB only if a test really needs it.
- Only the host loopback interface is published. The relay does make BB
  reachable from other containers on the default Docker bridge network. That
  is acceptable for a local dev harness, but it is not a Codespaces-equivalent
  boundary.
