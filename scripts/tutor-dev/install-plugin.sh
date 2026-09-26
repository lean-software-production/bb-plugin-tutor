#!/usr/bin/env bash
# Install (first time) or rebuild + reload (every later time) a BB plugin from
# a host directory into the harness BB.
#
#   install-plugin.sh <plugin-dir> [--copy] [--no-build] [--npm-install]
#
# A directory under $TUTOR_DEV_MOUNT is visible inside the container at the
# same absolute path, so it is path-installed IN PLACE: edit on the host, then
# re-run this script to rebuild and reload. A directory outside the mount (or
# with --copy) is copied to /home/node/tutor-dev-plugins/<id> in the container
# and installed from there; re-running re-copies it.
#
#   --no-build     skip `bb plugin build` (path installs still build the app
#                  bundle on first install)
#   --npm-install  run `npm ci` (or `npm install` without a lockfile) inside the
#                  container first. Done automatically when node_modules is missing.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

dir= copy=false build=true npm_install=false
for arg in "$@"; do
    case "$arg" in
        --copy) copy=true ;;
        --no-build) build=false ;;
        --npm-install) npm_install=true ;;
        -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
        -*) td_die "unknown option: $arg" ;;
        *) [ -z "$dir" ] || td_die "only one plugin directory may be given"; dir="$arg" ;;
    esac
done
[ -n "$dir" ] || td_die "usage: install-plugin.sh <plugin-dir> [--copy] [--no-build] [--npm-install]"
[ -f "$dir/package.json" ] || td_die "$dir has no package.json"
host_dir="$(cd "$dir" && pwd -P)"
mount_real="$(cd "$TUTOR_DEV_MOUNT" && pwd -P)"
td_require_running

# Plugin id rule from the BB plugin guide: last package-name component minus
# the bb-plugin- prefix, lowercased, non-alphanumeric runs -> '-', trimmed.
plugin_id="$(node -e '
const name = require(process.argv[1]).name || "";
const id = name.split("/").pop().replace(/^bb-plugin-/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
if (!id) process.exit(1);
process.stdout.write(id);
' "$host_dir/package.json")" || td_die "cannot derive a plugin id from $host_dir/package.json"

case "$host_dir/" in
    "$mount_real"/*) $copy || container_dir="$host_dir" ;;
esac
if [ -z "${container_dir:-}" ]; then
    container_dir="/home/${TUTOR_DEV_USER}/tutor-dev-plugins/${plugin_id}"
    td_log "copying $host_dir -> ${TUTOR_DEV_NAME}:${container_dir}"
    docker exec -u "$TUTOR_DEV_USER" "$TUTOR_DEV_NAME" sh -c 'rm -rf -- "$1" && mkdir -p -- "$1"' _ "$container_dir"
    docker cp "$host_dir/." "$TUTOR_DEV_NAME:$container_dir" >/dev/null
    docker exec -u root "$TUTOR_DEV_NAME" chown -R "$TUTOR_DEV_USER:$TUTOR_DEV_USER" "$container_dir"
fi

in_plugin() { TUTOR_DEV_CWD="$container_dir" "$TUTOR_DEV_SCRIPTS/bb.sh" --exec "$@"; }

if $npm_install || ! in_plugin test -d node_modules; then
    td_log "installing npm dependencies inside the container"
    in_plugin sh -c 'if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi'
fi

if $build; then
    td_log "bb plugin build $container_dir"
    in_plugin bb plugin build "$container_dir"
fi

current_root="$("$TUTOR_DEV_SCRIPTS/bb.sh" plugin list --json | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const p = (JSON.parse(s).plugins || []).find((x) => x.id === process.argv[1]);
  process.stdout.write(p ? String(p.rootDir || "") : "");
});' "$plugin_id")"

if [ "$current_root" = "$container_dir" ]; then
    td_log "bb plugin reload $plugin_id"
    "$TUTOR_DEV_SCRIPTS/bb.sh" plugin reload "$plugin_id"
else
    [ -z "$current_root" ] || td_log "$plugin_id is currently installed from $current_root; installing $container_dir instead"
    td_log "bb plugin install $container_dir --yes"
    "$TUTOR_DEV_SCRIPTS/bb.sh" plugin install "$container_dir" --yes
fi

"$TUTOR_DEV_SCRIPTS/bb.sh" plugin list --json | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const p = (JSON.parse(s).plugins || []).find((x) => x.id === process.argv[1]);
  if (!p) { console.error(`[tutor-dev] ERROR: plugin ${process.argv[1]} is not installed`); process.exit(1); }
  console.log(`${p.id}\t${p.status}\t${p.rootDir}${p.statusDetail ? "\t" + JSON.stringify(p.statusDetail) : ""}`);
  if (!["running", "degraded"].includes(String(p.status))) process.exitCode = 3;
});' "$plugin_id" || td_die "plugin $plugin_id is not healthy; see: scripts/tutor-dev/bb.sh plugin logs $plugin_id"
