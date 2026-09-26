#!/usr/bin/env bash
# The whole proof from nothing, for the tutor Feature and this plugin together:
# a fresh container from devcontainer-features' .devcontainer/tutor, the
# feature's own checks, the polish checks across a container restart, the
# test-only scripted provider, the factory, the Playwright walk and the
# polish browser checks (polish.mjs). Log it yourself, e.g. > run-all.log 2>&1.
# Env (see README.md):
#   DCF=/path        the devcontainer-features checkout under test (required)
#   E2E_PLUGIN=local (default) swap this checkout's working tree (or
#                    E2E_PLUGIN_SRC) in over the Feature's pinned release after
#                    every up.sh; E2E_PLUGIN=release tests the release as built
#   TUTORIAL_REF / STARTER_REF   pin the course / the starter (see up.sh)
#   E2E_PLUGIN_VERSION / E2E_PLUGIN_SHA256   the tutor Feature's plugin options
#   E2E_HOME=/path   workspace, logs and shots (default <repo>/.tutor-e2e)
#   E2E_SHOTS=/path  where screenshots go (default $E2E_HOME/shots)
# The factory path is the tutor Feature's `factory` option in the checkout's
# .devcontainer/tutor/devcontainer.json: /workspaces/my-factory (tutor/mvp,
# made by make-factory.sh) or the starter's tetris/.factory (cloned by the
# Feature's bootstrap). walk.mjs and make-factory.sh follow $FACTORY.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
repo="$(e2e_dcf)"
export DCF="$repo"
E2E_PLUGIN="${E2E_PLUGIN:-local}"
case "$E2E_PLUGIN" in local|release) ;; *) e2e_die "E2E_PLUGIN must be local or release; received '$E2E_PLUGIN'" ;; esac
cd "$E2E_DIR"
swap_plugin() { [ "$E2E_PLUGIN" = release ] || { echo "== plugin: swap in $E2E_PLUGIN_SRC"; ./hot-plugin.sh; }; }

FACTORY="$(node -e '
const fs = require("fs");
const text = fs.readFileSync(process.argv[1], "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
process.stdout.write(JSON.parse(text).features["./features/tutor"].factory || "/workspaces/my-factory");
' "$repo/.devcontainer/tutor/devcontainer.json")"
export FACTORY
echo "== checkout $repo ($(git -C "$repo" rev-parse --abbrev-ref HEAD) $(git -C "$repo" rev-parse --short HEAD)); factory $FACTORY"
if [ "$E2E_PLUGIN" = local ]; then
    echo "== plugin: local $E2E_PLUGIN_SRC ($(git -C "$E2E_PLUGIN_SRC" describe --always --dirty 2>/dev/null || echo 'not a git checkout'))"
else
    echo "== plugin: the tutor Feature's release (pluginVersion ${E2E_PLUGIN_VERSION:-default})"
fi
mkdir -p "$E2E_SHOTS"

"$repo/.devcontainer/tutor/sync-features.sh" --check
./up.sh --purge
swap_plugin

echo "== feature checks"
./bb.sh --exec bb-feature-status
./bb.sh --exec git -C /workspaces/tutorial rev-parse --short HEAD
case "$FACTORY" in
    */.factory) ./bb.sh --exec bash -c 'cd "$1" && echo "starter $(git rev-parse --show-toplevel) at $(git rev-parse --short HEAD)"' _ "$FACTORY" ;;
esac
./bb.sh plugin list --json | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const p = JSON.parse(s).plugins.find((x) => x.id === "tutor");
  console.log("tutor plugin:", p && p.status, p && p.rootDir);
  if (!p || p.status !== "running") process.exit(1);
});'
./bb.sh settings ui get sidebar.threadListProvider --json | grep '"tutor/course-outline"'
cat "$E2E_HOME/workspaces/.bb-state/.tutor-feature/autostart.log"

echo "== polish: first start (agents, theme, plugins off), then a container restart"
node polish.mjs first-start
docker stop tutor-e2e >/dev/null
./up.sh
swap_plugin
node polish.mjs restart

echo "== test-only: scripted provider as the default provider"
docker cp "$repo/test/tutor/fixtures/scripted-provider" tutor-e2e:/home/node/scripted-provider
docker exec -u root tutor-e2e chown -R node:node /home/node/scripted-provider
./bb.sh --exec bash -c 'cd /home/node/scripted-provider && rm -rf node_modules && npm ci --omit=dev --no-audit --no-fund --loglevel=error && bb plugin install "$PWD" --yes && bb settings general defaultProviderId scripted'

echo "== factory $FACTORY"
./make-factory.sh

echo "== walk"
node walk.mjs

echo "== polish: theme in the browser, simple navigation, heartbeat + keep-alive, lost connection"
node polish.mjs ui
