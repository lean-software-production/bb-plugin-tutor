# The Tutor end-to-end walk

`run-all.sh` is the whole proof from nothing, and it tests the **tutor Feature
and this plugin together**. It builds a fresh container from the Codespaces
entry point in devcontainer-features
([`.devcontainer/tutor`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor)),
so the bb, agent CLI and tutor Features install and start exactly as they are
committed. It then drives BB with host-side Playwright chromium through about
140 checks:

- the Feature's own checks: BB status, the course checkout, the tutor plugin
  running, and the outline selected as the sidebar;
- the polish checks (`polish.mjs`) on first start and again after a container
  restart: agents and providers, the paper theme, plugins switched off, and a
  hand re-enable that survives;
- a test-only scripted provider installed as the default provider, so coach
  turns are deterministic and need no credentials;
- the factory, then the walk (`walk.mjs`): the course outline, the coach in
  BB's thread view with its lesson and Rule cards, jumping to a Rule's section,
  and side chats. When the project is a starter clone's top folder, the walk
  goes on through lessons 001 to 003 and adopts 004, then checks that Tutor
  moved the factory to `factory/` exactly as the starter's `fetch.sh` does in
  a second clone. The Rule card, the outline and lesson complete are also shot
  dark, checked against the Sketchbook geometry, and (Rule card, outline)
  checked for the kit's wobble outlines. Step 11b checks that a page asking for
  less motion sees a passed Rule's swash and the ribbon hold still.
  `E2E_BROWSER=firefox` runs the walk in Firefox (its browser must be installed:
  `npx playwright install firefox`);
- the polish browser checks: theme screenshots, simple navigation, heartbeat
  and keep-alive, and the lost-connection notice.

The walk stops at the first failed check and exits non-zero.

## What it needs

- **A devcontainer-features checkout, in `DCF`.** It provides
  `.devcontainer/tutor` (the config and its synced local Features) and the
  scripted provider in `test/tutor/fixtures/scripted-provider`, which its own
  `test/tutor/standalone.sh` also uses. There is no default.
- **A tutor Feature that can install a plugin release.** The Feature downloads
  the plugin release it pins (`src/tutor/plugin-pin.sh`) at image build. Until
  a release is pinned there, the build stops with a message. Set
  `E2E_PLUGIN_VERSION` and `E2E_PLUGIN_SHA256` to a published release to
  build anyway.
- Docker, the `devcontainer` CLI (`DEVCONTAINER`, default
  `~/.devcontainers/bin/devcontainer`), network access, and Playwright
  (`PLAYWRIGHT_MODULE`, default `~/ensembleworks/node_modules/playwright`). In
  a sandboxed agent shell, run the walk with the sandbox disabled.

## Which plugin is tested

- `E2E_PLUGIN=local` (the default) tests this checkout's working tree. After
  each `up.sh`, `hot-plugin.sh` replaces the plugin copy the Feature installed
  with the working tree (or `E2E_PLUGIN_SRC`). It then runs
  `npm ci --omit=dev --ignore-scripts` inside the container, as the Feature
  does, and rebuilds and reloads the plugin. The Feature's install, its
  start-up hook and the first-start state still come from the release it
  built with, so a change to what the Feature does on install is not covered.
- `E2E_PLUGIN=release` leaves the Feature's release in place. Use it to check
  a release, or a devcontainer-features change, exactly as a Codespace gets
  it.

## Running it

```sh
DCF=../devcontainer-features TUTORIAL_REF=<tutorial sha> \
  scripts/tutor-dev/e2e/run-all.sh > .tutor-e2e/run-all.log 2>&1
```

The container is `tutor-e2e`. BB runs on `127.0.0.1:48886` and its host daemon
on 48887, so it never collides with a host BB on 38886 or 38887, or with the
tutor-dev harness on 47886. `up.sh --purge` removes the previous `tutor-e2e`
container and workspace first. The scripts only touch a container that has
both that name and the `tutor.e2e=tutor-e2e` label.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DCF` | none (required) | devcontainer-features checkout under test. |
| `E2E_PLUGIN` | `local` | `local` or `release`, as above. |
| `E2E_PLUGIN_SRC` | this repo | Plugin source that `E2E_PLUGIN=local` swaps in. |
| `E2E_PLUGIN_VERSION`, `E2E_PLUGIN_SHA256` | the Feature's pin | Set the tutor Feature's `pluginVersion` and `pluginSha256`. |
| `TUTORIAL_REF`, `STARTER_REF` | default branches | Pin the course and the capstone-project-starter. They are cloned into the workspace before the Feature's bootstrap runs. |
| `E2E_HOME` | `<repo>/.tutor-e2e` (git-ignored) | Workspace bind-mounted at `/workspaces`, `up.json` and `up.log`. |
| `E2E_SHOTS` | `$E2E_HOME/shots` | Screenshots. |
| `PROJECT` | from the checkout's `devcontainer.json` | The BB project's folder: the tutor Feature's `starter` (the starter clone's top folder, plugin 0.2.0), else its legacy `factory`. Normally left to `run-all.sh`. `FACTORY` is still read when `PROJECT` is unset. |

## The pieces

| File | What it does |
| --- | --- |
| `run-all.sh` | The whole proof, in order. |
| `up.sh [--purge]` | Builds or restarts `tutor-e2e` from `$DCF/.devcontainer/tutor`. It overrides only the ports, the `/workspaces` mount and the loopback publish (through `../relay.mjs`), plus the optional plugin version. |
| `bb.sh <args…>` / `bb.sh --exec <cmd…>` | Runs the bb CLI, or any command, inside the container as the remote user. |
| `hot-plugin.sh` | Swaps the working tree in over the installed plugin, then rebuilds and reloads it. Also useful on its own as a dev loop against a running `tutor-e2e`. |
| `make-factory.sh` | Readies the project at `$PROJECT` and runs the Feature's start-up hook. |
| `walk.mjs [step-prefix…]`, `polish.mjs first-start\|restart\|ui` | The Playwright checks. Pass step prefixes to `walk.mjs`, or set `POLISH_ONLY`, to run part of a check against a container that is already up. |
| `sketch-check.mjs [surface…] [--dark] [--size WxH] [--tag T] [--browser B] [--reduced-motion]` | Shoots each Tutor surface after the walk and checks the Sketchbook geometry (patches inside the page, the loop, drawings on patches in dark). |
| `lib.mjs`, `env.sh` | Shared helpers and settings. |

Nothing here reads or copies host credentials. The only provider used is the
scripted one.
