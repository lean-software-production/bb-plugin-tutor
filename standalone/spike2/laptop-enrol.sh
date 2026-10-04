#!/usr/bin/env bash
# Spike 2, step 3: enrol this laptop as the student's BB machine, over the
# tailnet. Installs bb-app $BB_VERSION's CLI under $SPIKE2_HOME, runs
# `bb machine create --provider manual` against the student's server, and runs
# the installer it prints (as the launcher's machine_installer_run does).
#
# The enrolment header ("X-BB-Enrollment: <token>") goes from create's output
# to a 0600 file with sed and is only ever handed to curl as -H @file: it never
# reaches an argv, stdout or a log. BB's installer body holds the token too, so
# it is deleted as soon as it has run.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

mkdir -p "$SPIKE2_HOME"
chmod 700 "$SPIKE2_HOME"
if [ "$(cat "$SPIKE2_HOME/npm/.bb-app-version" 2>/dev/null)" != "$BB_VERSION" ]; then
  npm install --prefix "$SPIKE2_HOME/npm" --no-audit --no-fund --silent "bb-app@$BB_VERSION"
  printf '%s' "$BB_VERSION" >"$SPIKE2_HOME/npm/.bb-app-version"
fi
curl -fsS -m 10 "$SERVER_URL/health" -o /dev/null || die "the server does not answer at $SERVER_URL: run box-setup.sh"

if [ -n "$(machine_id)" ] && sbb machine show "$(machine_id)" --json 2>/dev/null | grep -q '"status": *"connected"'; then
  say "already enrolled and connected: $(machine_id)"
  exit 0
fi

out="$SPIKE2_HOME/enrol.out" header="$SPIKE2_HOME/enrol.header" installer="$SPIKE2_HOME/machine-installer.sh"
create_pid=""
cleanup() {
  [ -z "$create_pid" ] || kill "$create_pid" 2>/dev/null || true
  rm -f "$out" "$header" "$installer"
}
trap cleanup EXIT
(umask 077; : >"$out")

# Blocks until the machine connects, so it runs in the background.
(sbb machine create --provider manual --key "spike2-$(hostname -s)") >"$out" 2>&1 &
create_pid=$!

line=""
for _ in $(seq 1 60); do
  line=$(grep -m1 'X-BB-Enrollment' "$out" 2>/dev/null) || line=""
  [ -n "$line" ] && break
  kill -0 "$create_pid" 2>/dev/null || break
  sleep 1
done
[ -n "$line" ] || die "no enrolment command from bb machine create (its output, token-free lines only: $(grep -v -i enrol "$out" | head -n 5))"

(umask 077; printf '%s\n' "$line" | sed -n "s/.*['\"]\\(X-BB-Enrollment:[^'\"]*\\)['\"].*/\\1/p" >"$header")
url=$(printf '%s\n' "$line" | grep -o 'https\{0,1\}://[^ '"'"'"|]*' | head -n 1) || url=""
{ [ -s "$header" ] && [ -n "$url" ]; } || die "couldn't read the enrolment command"
case "$url" in "$SERVER_URL"/*) ;; *) die "the installer URL is not on $SERVER_URL (machineServerUrl not set?)" ;; esac

(umask 077; curl -fsSL -H @"$header" "$url" -o "$installer")
status=0
sh "$installer" >"$SPIKE2_HOME/install.log" 2>&1 || status=$?
rm -f "$installer" "$header"
[ "$status" -eq 0 ] || die "BB's installer failed: see $SPIKE2_HOME/install.log"

for _ in $(seq 1 90); do kill -0 "$create_pid" 2>/dev/null || break; sleep 1; done
wait "$create_pid" || die "bb machine create did not finish cleanly"
create_pid=""

id=$(sbb machine list --json | node -e '
  let r = ""; process.stdin.on("data", (c) => (r += c)).on("end", () => {
    const d = JSON.parse(r); const rows = Array.isArray(d) ? d : (d.machines ?? d.hosts ?? []);
    const m = rows.filter((x) => (x.machineProviderId ?? x.provider ?? x.providerId) === "manual").sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
    if (m === undefined) process.exit(1); console.log(m.id);
  });') || die "no manual machine on the server after enrolling"
printf '%s\n' "$id" >"$SPIKE2_HOME/machine_id"
result 3 PASS "this laptop is machine $id on $SERVER_URL"

unit=$(grep -l "$TAILNET_IP-$PORT" "$HOME"/.config/systemd/user/*.service 2>/dev/null | head -n 1) || unit=""
if [ -n "$unit" ]; then
  result 3 INFO "the machine runs as $(basename "$unit"); its PATH: $(grep -o 'PATH=[^"]*' "$unit" | head -n 1 || echo '(none set: systemd --user default)')"
else
  result 3 INFO "no systemd user unit names $TAILNET_IP-$PORT: see $SPIKE2_HOME/install.log"
fi
