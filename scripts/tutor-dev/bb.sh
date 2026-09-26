#!/usr/bin/env bash
# Run the bb CLI inside the harness container, pointed at the harness BB.
#   scripts/tutor-dev/bb.sh status
#   scripts/tutor-dev/bb.sh plugin list
#   scripts/tutor-dev/bb.sh --exec bash      # any other command (e.g. a shell)
# The working directory inside the container is $TUTOR_DEV_MOUNT (same path as
# on the host). Set TUTOR_DEV_CWD to run from another directory.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
td_require_running
if [ "${1:-}" = --exec ]; then shift; cmd=("$@"); else cmd=(bb "$@"); fi
[ "${#cmd[@]}" -gt 0 ] || td_die "usage: bb.sh <bb args...> | bb.sh --exec <command...>"
if [ -n "${TUTOR_DEV_CWD:-}" ]; then
    tty=(); [ -t 0 ] && [ -t 1 ] && tty=(-t)
    exec docker exec -i "${tty[@]}" -u "$TUTOR_DEV_USER" \
        -e "BB_SERVER_URL=${TUTOR_DEV_URL}" -e "BB_DATA_DIR=${TUTOR_DEV_STATE}" -e "BB_HOST_DAEMON_PORT=${TUTOR_DEV_DAEMON_PORT}" \
        -w "$TUTOR_DEV_CWD" "$TUTOR_DEV_NAME" "${cmd[@]}"
fi
td_exec "${cmd[@]}"
