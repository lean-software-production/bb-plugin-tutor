#!/usr/bin/env bash
# Spike 2, step 1: the student's Tutor server on the box. Creates the Linux
# user $STUDENT, installs bb-app $BB_VERSION and Tutor's built plugin as that
# user, runs the server on 127.0.0.1:$PORT (tutor-$STUDENT.service) and
# exposes it on the tailnet IP (tutor-$STUDENT-tailnet-proxy.socket).
# Idempotent: run it again after a change. Changes the production box: run it
# only with the go-ahead. Back out with teardown.sh.
#
# The plugin comes from the end-to-end build ($PLUGIN_TGZ, default
# ~/tutor-e2e/release/bb-plugin-tutor-<version>-built.tgz): run
# standalone/e2e/e2e.sh build first.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

version=$(node -p 'require(process.argv[1]).version' "$here/../../package.json")
PLUGIN_TGZ=${PLUGIN_TGZ:-$HOME/tutor-e2e/release/bb-plugin-tutor-$version-built.tgz}
[ -f "$PLUGIN_TGZ" ] || die "no built plugin at $PLUGIN_TGZ: run standalone/e2e/e2e.sh build"

remote_tgz=/tmp/tutor-spike2-plugin.tgz
scp -q -o BatchMode=yes "$PLUGIN_TGZ" "$BOX:$remote_tgz"
on_box setup.sh STUDENT="$STUDENT" PORT="$PORT" TAILNET_IP="$TAILNET_IP" BB_VERSION="$BB_VERSION" \
  SERVER_URL="$SERVER_URL" PUBLIC_HOST="$PUBLIC_HOST" PLUGIN_TGZ="$remote_tgz" QUIET_PLUGINS="'$QUIET_PLUGINS'"

if curl -fsS -m 10 "$SERVER_URL/health" -o /dev/null; then
  result 1 PASS "the server answers over the tailnet at $SERVER_URL"
else
  result 1 FAIL "the server does not answer over the tailnet at $SERVER_URL"
fi
