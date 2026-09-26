# Shared configuration for the tutor-dev harness. Sourced by the other scripts;
# not executable on its own. Every value can be overridden from the environment.
# shellcheck shell=bash

TUTOR_DEV_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUTOR_DEV_REPO="$(cd "$TUTOR_DEV_SCRIPTS/../.." && pwd)"

# Container name and devcontainer id-label value. Change it to run a second,
# independent harness on the same host (pick a different TUTOR_DEV_PORT too).
TUTOR_DEV_NAME="${TUTOR_DEV_NAME:-tutor-dev-bb}"
# The BB server port *inside* the container, and the host loopback port that
# publishes it. They are deliberately the same number: the browser's Origin is
# then http://127.0.0.1:<port>, which BB's origin guard accepts as its own
# loopback origin without any appUrl override.
TUTOR_DEV_PORT="${TUTOR_DEV_PORT:-47886}"
# In-container TCP relay port (0.0.0.0) that the published host port targets.
TUTOR_DEV_RELAY_PORT="${TUTOR_DEV_RELAY_PORT:-$((TUTOR_DEV_PORT + 10))}"
TUTOR_DEV_DAEMON_PORT="${TUTOR_DEV_DAEMON_PORT:-$((TUTOR_DEV_PORT + 1))}"
# Generated devcontainer workspace + BB state live here (git-ignored).
TUTOR_DEV_HOME="${TUTOR_DEV_HOME:-$TUTOR_DEV_REPO/.tutor-dev}"
# Host directory bind-mounted read-write at the SAME absolute path inside the
# container. Plugins under it are path-installed in place (edit on host, reload).
TUTOR_DEV_MOUNT="${TUTOR_DEV_MOUNT:-$(dirname "$TUTOR_DEV_REPO")}"
TUTOR_DEV_IMAGE="${TUTOR_DEV_IMAGE:-mcr.microsoft.com/devcontainers/javascript-node:5-24-trixie}"
# The bb Feature source directory (devcontainer-features' src/bb) the harness
# builds from. Required by up.sh: this repo does not carry the Feature. Once the
# bb Feature is published to GHCR, that published Feature becomes the default.
TUTOR_DEV_BB_FEATURE="${TUTOR_DEV_BB_FEATURE:-}"
# Empty = use the bb Feature's own default version.
TUTOR_DEV_BB_VERSION="${TUTOR_DEV_BB_VERSION:-}"
# Optional devcontainer postStartCommand (a command line run inside the
# container after bb-feature-autostart), e.g. a script that path-installs plugins.
TUTOR_DEV_POST_START="${TUTOR_DEV_POST_START:-}"
TUTOR_DEV_USER=node
TUTOR_DEV_WORKSPACE="$TUTOR_DEV_HOME/workspace"
TUTOR_DEV_STATE="$TUTOR_DEV_HOME/state"
TUTOR_DEV_URL="http://127.0.0.1:${TUTOR_DEV_PORT}"
TUTOR_DEV_LABEL="tutor-dev.harness=${TUTOR_DEV_NAME}"

if [ -z "${DEVCONTAINER:-}" ]; then
    if command -v devcontainer >/dev/null 2>&1; then DEVCONTAINER=devcontainer
    else DEVCONTAINER="$HOME/.devcontainers/bin/devcontainer"; fi
fi

td_log() { printf '[tutor-dev] %s\n' "$*" >&2; }
td_die() { printf '[tutor-dev] ERROR: %s\n' "$*" >&2; exit 1; }

# Validates TUTOR_DEV_BB_FEATURE and prints it as an absolute path.
td_bb_feature() {
    local how="set TUTOR_DEV_BB_FEATURE to the src/bb directory of a devcontainer-features checkout (https://github.com/lean-software-production/devcontainer-features/tree/main/src/bb)"
    [ -n "$TUTOR_DEV_BB_FEATURE" ] || td_die "TUTOR_DEV_BB_FEATURE is not set; $how"
    [ -d "$TUTOR_DEV_BB_FEATURE" ] || td_die "TUTOR_DEV_BB_FEATURE=$TUTOR_DEV_BB_FEATURE is not a directory; $how"
    [ -f "$TUTOR_DEV_BB_FEATURE/install.sh" ] && [ -f "$TUTOR_DEV_BB_FEATURE/devcontainer-feature.json" ] \
        || td_die "TUTOR_DEV_BB_FEATURE=$TUTOR_DEV_BB_FEATURE has no install.sh and devcontainer-feature.json; $how"
    node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).id === "bb" ? 0 : 1)' \
        "$TUTOR_DEV_BB_FEATURE/devcontainer-feature.json" 2>/dev/null \
        || td_die "TUTOR_DEV_BB_FEATURE=$TUTOR_DEV_BB_FEATURE is not the bb Feature (its devcontainer-feature.json id is not \"bb\"); $how"
    (cd "$TUTOR_DEV_BB_FEATURE" && pwd)
}

td_guard_ports() {
    local p
    for p in "$TUTOR_DEV_PORT" "$TUTOR_DEV_RELAY_PORT" "$TUTOR_DEV_DAEMON_PORT"; do
        [[ "$p" =~ ^[0-9]+$ ]] && [ "$p" -ge 1024 ] && [ "$p" -le 65535 ] || td_die "port '$p' is not in 1024-65535"
        case "$p" in 38886|38887) td_die "port $p is reserved for the host's own BB; choose another TUTOR_DEV_PORT" ;; esac
    done
    [ "$TUTOR_DEV_PORT" != "$TUTOR_DEV_RELAY_PORT" ] && [ "$TUTOR_DEV_PORT" != "$TUTOR_DEV_DAEMON_PORT" ] \
        && [ "$TUTOR_DEV_RELAY_PORT" != "$TUTOR_DEV_DAEMON_PORT" ] || td_die "server, daemon and relay ports must differ"
}

# Prints the id of the harness container (running or stopped), if it exists
# and carries our label. A same-named container without the label is refused.
td_container_id() {
    local id
    id="$(docker ps -aq --filter "name=^/${TUTOR_DEV_NAME}\$" --filter "label=${TUTOR_DEV_LABEL}")"
    if [ -z "$id" ] && [ -n "$(docker ps -aq --filter "name=^/${TUTOR_DEV_NAME}\$")" ]; then
        td_die "a container named ${TUTOR_DEV_NAME} exists but is not a tutor-dev harness container; refusing to touch it"
    fi
    printf '%s' "$id"
}

td_running() {
    [ "$(docker inspect -f '{{.State.Running}}' "$TUTOR_DEV_NAME" 2>/dev/null)" = true ]
}

td_require_running() {
    [ -n "$(td_container_id)" ] && td_running || td_die "harness container ${TUTOR_DEV_NAME} is not running; run scripts/tutor-dev/up.sh"
}

# docker exec as the remote user with the bb CLI pointed at the harness BB.
td_exec() {
    local tty=()
    [ -t 0 ] && [ -t 1 ] && tty=(-t)
    docker exec -i "${tty[@]}" -u "$TUTOR_DEV_USER" \
        -e "BB_SERVER_URL=${TUTOR_DEV_URL}" -e "BB_DATA_DIR=${TUTOR_DEV_STATE}" -e "BB_HOST_DAEMON_PORT=${TUTOR_DEV_DAEMON_PORT}" \
        -w "$TUTOR_DEV_MOUNT" "$TUTOR_DEV_NAME" "$@"
}
