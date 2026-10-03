#!/bin/sh
# Task 1, steps 1–6: a tutor-shaped server and an enrolled machine on port
# 47399, with Tutor's pi kept in $SPIKE_HOME/pi. Run it, then
# check-pi-env.sh. Undo everything with teardown.sh.
#
# The one-time enrolment header is written to a 0600 file and passed to curl
# with -H @file; it is never printed, logged or put in an argument.
set -eu
. "$(dirname "$0")/lib.sh"

os_kind >/dev/null
command -v node >/dev/null || die "Node is not installed."
command -v npm >/dev/null || die "npm is not installed."
command -v git >/dev/null || die "git is not installed."

umask 077
mkdir -p "$SPIKE_HOME/server" "$SPIKE_HOME/bin" "$PI_DIR" "$LOGS" "$SPIKE_HOME/ws"
chmod 700 "$SPIKE_HOME" "$SPIKE_HOME/server" "$PI_DIR"

if curl -fsS "http://127.0.0.1:$SPIKE_PORT/health" >/dev/null 2>&1; then
  die "Something already answers on port $SPIKE_PORT. Run teardown.sh first."
fi

say "1/6 Installing bb-app@$BB_VERSION and $PI_PACKAGE@$PI_VERSION into $SPIKE_HOME (log: $LOGS/npm.log)"
# npm runs install scripts by default, so better-sqlite3, node-pty and
# @parcel/watcher build their native parts. Note any build failures.
npm install --prefix "$SPIKE_HOME/npm" "bb-app@$BB_VERSION" "$PI_PACKAGE@$PI_VERSION" >"$LOGS/npm.log" 2>&1 \
  || die "npm install failed; see $LOGS/npm.log"
ln -sf "$SPIKE_HOME/npm/node_modules/.bin/pi" "$PI_REAL"
cp "$(dirname "$0")/tee-pi" "$TEE_PI"
chmod 755 "$TEE_PI"

say "2/6 Starting bb-server on 127.0.0.1:$SPIKE_PORT (log: $LOGS/server.log)"
# A plain background process: the spike tests the machine's service, not the server's.
nohup "$BB_BIN/bb-server" --data-dir "$SPIKE_HOME/server" --server-bind-host 127.0.0.1 --server-port "$SPIKE_PORT" \
  >"$LOGS/server.log" 2>&1 &
echo $! >"$SPIKE_HOME/server.pid"

health=""
for _ in $(seq 1 60); do
  for path in /health /api/health; do
    if curl -fsS "http://127.0.0.1:$SPIKE_PORT$path" >/dev/null 2>&1; then health=$path; break 2; fi
  done
  sleep 1
done
[ -n "$health" ] || die "The server didn't answer on /health or /api/health within 60 s; see $LOGS/server.log"
result setup INFO "server healthy at $health (record as BB_SERVER_HEALTH_PATH)"

say "3/6 Configuring the server: machineServerUrl 127.0.0.1 (never localhost), direct machine access"
spike_bb settings general machineServerUrl "$SERVER_URL" >>"$LOGS/bb.log" 2>&1 \
  || die "Setting machineServerUrl failed; see $LOGS/bb.log"
spike_bb settings general defaultMachineAccess direct >>"$LOGS/bb.log" 2>&1 \
  || die "Setting defaultMachineAccess failed; see $LOGS/bb.log"
result setup INFO "bb settings general machineServerUrl/defaultMachineAccess worked (record as BB_SET_MACHINE_URL)"

say "4/6 Creating the manual machine in the background (it waits until the machine connects)"
: >"$SPIKE_HOME/create.out"
chmod 600 "$SPIKE_HOME/create.out"
spike_bb machine create --provider manual --key spike-machine >"$SPIKE_HOME/create.out" 2>&1 &
create_pid=$!

line=""
for _ in $(seq 1 60); do
  line=$(grep -m1 'X-BB-Enrollment' "$SPIKE_HOME/create.out" 2>/dev/null || true)
  [ -n "$line" ] && break
  kill -0 "$create_pid" 2>/dev/null || break
  sleep 1
done
[ -n "$line" ] || die "No enrolment command appeared within 60 s. Look at $SPIKE_HOME/create.out (it may hold a secret; don't paste it)."

say "5/6 Enrolling: header into a 0600 file, installer downloaded and run (log: $LOGS/install.log)"
# Header: the quoted X-BB-Enrollment: … text. URL: the first http(s) URL on the line.
printf '%s\n' "$line" | sed -n "s/.*['\"]\(X-BB-Enrollment:[^'\"]*\)['\"].*/\1/p" >"$SPIKE_HOME/enrol.header"
url=$(printf '%s\n' "$line" | grep -o 'https\{0,1\}://[^ '"'"'"|]*' | head -n 1)
if [ ! -s "$SPIKE_HOME/enrol.header" ] || [ -z "$url" ]; then
  rm -f "$SPIKE_HOME/enrol.header"
  die "Couldn't read the enrolment line's shape. Enrol by hand from $SPIKE_HOME/create.out (header in a 0600 file, curl -H @file), then run apply-env.sh. Note the line's shape in the spike document, without the token."
fi
result setup INFO "enrolment line parsed: curl -H 'X-BB-Enrollment: …' <url> | sh (record as BB_ENROL_LINE_PATTERN)"

curl -fsSL -H @"$SPIKE_HOME/enrol.header" "$url" -o "$SPIKE_HOME/machine-installer.sh"
token=$(sed 's/^X-BB-Enrollment:[[:space:]]*//' "$SPIKE_HOME/enrol.header")
if grep -qF "$token" "$SPIKE_HOME/machine-installer.sh"; then
  result setup INFO "the installer body CONTAINS the enrolment token: the launcher must not keep it (record in MACHINE_UNINSTALL)"
else
  result setup INFO "the installer body does not contain the enrolment token: the launcher may keep it for --uninstall"
fi
unset token
sh "$SPIKE_HOME/machine-installer.sh" >"$LOGS/install.log" 2>&1 \
  || { rm -f "$SPIKE_HOME/enrol.header"; die "BB's installer failed; see $LOGS/install.log (expired? run teardown.sh and setup.sh again)"; }
rm -f "$SPIKE_HOME/enrol.header"

wait "$create_pid" || die "machine create exited non-zero; see $SPIKE_HOME/create.out (may hold a secret)"
rm -f "$SPIKE_HOME/create.out"

unit=$(machine_unit_file) || die "Couldn't find the machine's service file mentioning 127.0.0.1-$SPIKE_PORT. Record where BB's installer put it."
result setup INFO "machine service file: $unit (record as MACHINE_UNIT_GLOB / MACHINE_PLIST_GLOB)"
result setup INFO "machine id: $(machine_id || echo unknown — set SPIKE_MACHINE_ID)"

say "6/6 Giving the machine Tutor's pi"
sh "$(dirname "$0")/apply-env.sh"

say ""
say "Done. Next: sh $(dirname "$0")/check-pi-env.sh before-login"
