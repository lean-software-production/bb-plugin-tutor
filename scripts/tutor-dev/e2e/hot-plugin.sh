#!/usr/bin/env bash
# Replaces the installed plugin copy in tutor-e2e with this checkout's working
# tree (or E2E_PLUGIN_SRC), installs its runtime dependencies the way the tutor
# Feature does, then rebuilds and reloads it. run-all.sh calls it after every
# up.sh when E2E_PLUGIN=local; it also works on its own as a dev loop.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
[ -f "$E2E_PLUGIN_SRC/package.json" ] || e2e_die "E2E_PLUGIN_SRC=$E2E_PLUGIN_SRC has no package.json"
dir="$("$E2E_DIR/bb.sh" plugin list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).plugins.find(x=>x.id==="tutor");if(!p)process.exit(1);process.stdout.write(p.rootDir)})')" \
    || e2e_die "the tutor plugin is not installed in tutor-e2e"
case "$dir" in /?*/?*) ;; *) e2e_die "refusing to replace the plugin at an unexpected rootDir '$dir'" ;; esac
docker exec -u root tutor-e2e find "$dir" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
# Feature 0.6 links the plugin's node_modules to a root-owned shared copy
# (/usr/local/share/tutor/plugin/node_modules); drop the link, not its target,
# so npm ci below installs a private node_modules the node user owns.
docker exec -u root tutor-e2e sh -c '[ ! -L "$1/node_modules" ] || rm "$1/node_modules"' _ "$dir"
tar -C "$E2E_PLUGIN_SRC" --exclude=./node_modules --exclude=./dist --exclude=./.git \
    --exclude=./.tutor-dev --exclude=./.tutor-e2e --exclude=./docs --exclude=./scripts --exclude=./.github --exclude=./.claude --exclude=./.mcp.json \
    -cf - . | docker exec -i -u root tutor-e2e tar -C "$dir" -xf -
docker exec -u root tutor-e2e chown -R node:node "$dir"
"$E2E_DIR/bb.sh" --exec sh -c 'cd "$1" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error' _ "$dir"
"$E2E_DIR/bb.sh" plugin build "$dir" >/dev/null
"$E2E_DIR/bb.sh" plugin reload tutor | sed -n 1,2p
