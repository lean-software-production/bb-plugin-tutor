#!/usr/bin/env bash
# bb CLI (or any command with --exec) inside the e2e container, as the remote user.
set -euo pipefail
env_args=(-e BB_SERVER_URL=http://127.0.0.1:48886 -e BB_HOST_DAEMON_PORT=48887 -e BB_DATA_DIR=/workspaces/.bb-state)
tty=(); [ -t 0 ] && [ -t 1 ] && tty=(-t)
if [ "${1:-}" = "--exec" ]; then shift; exec docker exec -i "${tty[@]}" -u node "${env_args[@]}" -w /workspaces tutor-e2e "$@"; fi
exec docker exec -i "${tty[@]}" -u node "${env_args[@]}" -w /workspaces tutor-e2e bb "$@"
