#!/usr/bin/env bash
# Brings up a FRESH container from devcontainer-features' committed
# .devcontainer/tutor entry point. Overrides only: BB ports 48886/48887 (never
# the host's 38886/38887), a host directory bind-mounted at /workspaces
# (Codespaces' /workspaces is writable by the user; a local Docker one is
# root-owned), and a loopback publish of 48886 via the tutor-dev relay.
# Everything else, including install.sh and the lifecycle hooks, runs exactly
# as committed.
#   up.sh [--purge]   --purge removes the previous container and /workspaces first
# Env: DCF (required), E2E_HOME, TUTORIAL_REF / STARTER_REF (pin the course /
#      the capstone-project-starter), E2E_PLUGIN_VERSION + E2E_PLUGIN_SHA256
#      (set the tutor Feature's pluginVersion / pluginSha256). See README.md.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
repo="$(e2e_dcf)"
name=tutor-e2e
label="tutor.e2e=$name"
ws_root="$E2E_HOME/workspaces"  # mounted at /workspaces
ws="$ws_root/course-codespace"  # the devcontainer workspace folder
devcontainer="${DEVCONTAINER:-$HOME/.devcontainers/bin/devcontainer}"

if [ "${1:-}" = "--purge" ]; then
    id="$(docker ps -aq --filter "name=^/${name}\$" --filter "label=$label")"
    [ -z "$id" ] || docker rm -f "$id" >/dev/null
    rm -rf "$ws_root"
fi

mkdir -p "$ws/.devcontainer"
# TUTORIAL_REF pins the course: clone it here first, so the feature's bootstrap
# finds /workspaces/tutorial and skips its own clone of the default branch.
if [ -n "${TUTORIAL_REF:-}" ] && [ ! -d "$ws_root/tutorial" ]; then
    git clone --quiet https://github.com/lean-software-production/tutorial.git "$ws_root/tutorial"
    git -C "$ws_root/tutorial" checkout --quiet "$TUTORIAL_REF"
fi
# STARTER_REF pins the capstone-project-starter the same way (only used by a
# checkout whose devcontainer.json sets the tutor Feature's starter option).
if [ -n "${STARTER_REF:-}" ] && [ ! -d "$ws_root/capstone-project-starter" ]; then
    git clone --quiet https://github.com/lean-software-production/capstone-project-starter.git "$ws_root/capstone-project-starter"
    git -C "$ws_root/capstone-project-starter" checkout --quiet "$STARTER_REF"
fi
rm -rf "$ws/.devcontainer/features"
cp -R "$repo/.devcontainer/tutor/features" "$ws/.devcontainer/features"
WS_ROOT="$ws_root" NAME="$name" node - "$repo/.devcontainer/tutor/devcontainer.json" > "$ws/.devcontainer/devcontainer.json" <<'JS'
const fs = require("fs");
const e = process.env;
const text = fs.readFileSync(process.argv[2], "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const config = JSON.parse(text);
Object.assign(config.features["./features/bb"], { serverPort: "48886", hostDaemonPort: "48887" });
if (e.E2E_PLUGIN_VERSION) config.features["./features/tutor"].pluginVersion = e.E2E_PLUGIN_VERSION;
if (e.E2E_PLUGIN_SHA256) config.features["./features/tutor"].pluginSha256 = e.E2E_PLUGIN_SHA256;
config.forwardPorts = [];
delete config.portsAttributes;
config.workspaceMount = `source=${e.WS_ROOT},target=/workspaces,type=bind`;
config.workspaceFolder = "/workspaces/course-codespace";
config.runArgs = ["--name", e.NAME, "-p", "127.0.0.1:48886:48896"];
process.stdout.write(JSON.stringify(config, null, 2) + "\n");
JS

"$devcontainer" up --workspace-folder "$ws" --id-label "$label" > "$E2E_HOME/up.json" 2> "$E2E_HOME/up.log" || {
    tail -n 60 "$E2E_HOME/up.log" >&2; exit 1; }
grep -q '"outcome":"success"' "$E2E_HOME/up.json" || { cat "$E2E_HOME/up.json" >&2; exit 1; }

docker cp "$E2E_DIR/../relay.mjs" "$name:/tmp/relay.mjs" >/dev/null
docker exec -d -u node "$name" sh -c 'exec setsid node /tmp/relay.mjs 48896 48886 >>/tmp/relay.log 2>&1 </dev/null'
for _ in $(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:48886/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS --max-time 2 http://127.0.0.1:48886/health && echo && echo "ready: http://127.0.0.1:48886"
