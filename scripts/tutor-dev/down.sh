#!/usr/bin/env bash
# Stop the tutor-dev harness container.
#   down.sh            stop it (keeps container + BB state; up.sh restarts it)
#   down.sh --rm       remove the container (keeps BB state under $TUTOR_DEV_HOME/state)
#   down.sh --purge    remove the container AND the generated workspace + BB state
# Only ever touches the container named $TUTOR_DEV_NAME carrying the harness label.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
mode=stop
case "${1:-}" in
    "") ;;
    --rm) mode=rm ;;
    --purge) mode=purge ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) td_die "unknown argument: $1" ;;
esac
id="$(td_container_id)"
if [ -z "$id" ]; then
    td_log "no harness container ${TUTOR_DEV_NAME}"
elif [ "$mode" = stop ]; then
    docker stop "$id" >/dev/null && td_log "stopped ${TUTOR_DEV_NAME}"
else
    docker rm -f "$id" >/dev/null && td_log "removed ${TUTOR_DEV_NAME}"
fi
if [ "$mode" = purge ]; then
    case "$TUTOR_DEV_HOME" in */.tutor-dev|*/.tutor-dev/) ;; *) td_die "refusing to purge unexpected TUTOR_DEV_HOME $TUTOR_DEV_HOME" ;; esac
    rm -rf -- "$TUTOR_DEV_HOME"
    td_log "purged $TUTOR_DEV_HOME"
fi
if [ "$mode" != stop ]; then rm -f -- "$TUTOR_DEV_HOME/applied-config.sha256"; fi
