#!/usr/bin/env bash
# Path-install BB plugins as part of container start. Meant to run INSIDE the
# container as a devcontainer postStartCommand, i.e. after the bb Feature's own
# postStartCommand (bb-feature-autostart) has brought the server up:
#
#   TUTOR_DEV_POST_START="/abs/path/scripts/tutor-dev/plugins-at-start.sh /abs/plugin-a /abs/plugin-b" \
#     scripts/tutor-dev/up.sh
#
# Idempotent across restarts: a plugin already installed from the same path is
# left alone (BB reloads installed plugins itself on every server start); a
# plugin installed from a different path is re-installed from this one.
# Needs BB_SERVER_URL / BB_DATA_DIR in the environment (the harness sets them
# as containerEnv). Logs with timings to $BB_DATA_DIR/.tutor-dev-plugins-at-start.log.
# Exits non-zero if the server's plugin API is not usable within
# $PLUGINS_AT_START_TIMEOUT seconds (default 120) or any install fails.
set -uo pipefail

log_file="${BB_DATA_DIR:-$HOME}/.tutor-dev-plugins-at-start.log"
t0=$(date +%s%3N)
log() { printf '%s +%sms %s\n' "$(date -u +%FT%TZ)" "$(( $(date +%s%3N) - t0 ))" "$*" | tee -a "$log_file" >&2; }

timeout_s="${PLUGINS_AT_START_TIMEOUT:-120}"
log "start: $# plugin path(s); BB_SERVER_URL=${BB_SERVER_URL:-<unset>}"

# 1. Wait until the plugin API answers (not just /health).
list_json=
deadline=$(( $(date +%s) + timeout_s ))
tries=0
while :; do
    tries=$((tries + 1))
    if list_json="$(bb plugin list --json 2>/dev/null)" && [ -n "$list_json" ]; then break; fi
    [ "$(date +%s)" -lt "$deadline" ] || { log "ERROR: bb plugin list not usable after ${timeout_s}s ($tries tries)"; exit 1; }
    sleep 1
done
log "plugin API ready after $tries try/tries"

status=0
for dir in "$@"; do
    [ -f "$dir/package.json" ] || { log "ERROR: $dir has no package.json"; status=1; continue; }
    id="$(node -e '
const name = require(process.argv[1]).name || "";
process.stdout.write(name.split("/").pop().replace(/^bb-plugin-/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
' "$dir/package.json")"
    root="$(printf '%s' "$list_json" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const p = (JSON.parse(s).plugins || []).find((x) => x.id === process.argv[1]);
  process.stdout.write(p ? `${p.rootDir || ""}\t${p.status || ""}` : "");
});' "$id")"
    if [ "${root%%$'\t'*}" = "$dir" ]; then
        log "$id: already installed from $dir (status ${root#*$'\t'}); skipping"
        continue
    fi
    log "$id: installing from $dir"
    if out="$(bb plugin install "$dir" --yes 2>&1)"; then
        log "$id: installed: $(printf '%s' "$out" | grep -E "^$id[@	]" | tail -n1)"
    else
        log "ERROR: $id install failed: $(printf '%s' "$out" | tail -n 5 | tr '\n' ' ')"
        status=1
    fi
done
log "done (exit $status)"
exit "$status"
