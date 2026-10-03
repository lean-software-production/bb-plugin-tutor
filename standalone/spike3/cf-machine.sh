#!/usr/bin/env bash
# Spike 3: a BB machine that reaches the student's server through Cloudflare
# Access with a service token (BB_SERVER_HEADERS), instead of the tailnet.
# Runs on this laptop as a second machine of student-001's server; the same
# steps then go into the capstone-project-starter Codespace.
#
#   cf-machine.sh health      1. with the token's headers, /health answers (not Access's login)
#   cf-machine.sh enrol       2. enrol through Access; the daemon runs as tutor-spike3-machine (systemd --user)
#   cf-machine.sh status      3. the machine is connected; the bb CLI works through Access too
#   cf-machine.sh workspace   4. the student's workspace on this machine; getOverview timings via Cloudflare
#   cf-machine.sh coach [agent]  5. a coach thread on this machine (claude-code unless named)
#   cf-machine.sh restore     point Tutor back at the tailnet machine's workspace (Spike 2's)
#   cf-machine.sh teardown    stop and remove this machine
#
# The token comes from $SPIKE2_HOME/cf-access.env (CF_ACCESS_CLIENT_ID,
# CF_ACCESS_CLIENT_SECRET), written by `bb secret request`. Its values never
# reach an argv, stdout or a log: they go to processes through 0600
# environment files only.
# shellcheck disable=SC1090,SC1091 # sources files made at run time
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/../spike2/lib.sh"

CF_URL="https://$PUBLIC_HOST"
CF_HOME="$SPIKE2_HOME/cf-machine"         # this machine's BB_DATA_DIR
CF_ENV="$SPIKE2_HOME/cf-machine.env"      # BB_SERVER_HEADERS and BB_DATA_DIR, 0600
CF_UNIT=tutor-spike3-machine
CF_DAEMON_PORT=${CF_DAEMON_PORT:-38931}   # the daemon's loopback control port, unique on this laptop
CF_WORKSPACE=${CF_WORKSPACE:-$HOME/tutor-spike3/student course}
BB_APP="$SPIKE2_HOME/npm/node_modules/.bin/bb-app"

# headers_env: write $CF_ENV from the token file, without printing either.
headers_env() {
  [ -f "$SPIKE2_HOME/cf-access.env" ] || die "no $SPIKE2_HOME/cf-access.env: run bb secret request first"
  (
    set -a; . "$SPIKE2_HOME/cf-access.env"; set +a
    umask 077
    node -e '
      const h = { "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET };
      if (!h["CF-Access-Client-Id"] || !h["CF-Access-Client-Secret"]) process.exit(1);
      // Single-quoted: systemd EnvironmentFile and bash both keep the JSON as it is.
      process.stdout.write("BB_SERVER_HEADERS=\x27" + JSON.stringify(h) + "\x27\n");
    ' >"$CF_ENV.tmp" || die "cf-access.env lacks CF_ACCESS_CLIENT_ID or CF_ACCESS_CLIENT_SECRET"
    printf 'BB_DATA_DIR=%s\n' "$CF_HOME" >>"$CF_ENV.tmp"
    mv "$CF_ENV.tmp" "$CF_ENV"
  )
}

# curl_headers: a 0600 curl config with the two headers, for curl -K.
curl_headers() {
  (
    set -a; . "$SPIKE2_HOME/cf-access.env"; set +a
    umask 077
    printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" >"$SPIKE2_HOME/cf-curl.conf"
  )
  printf '%s\n' "$SPIKE2_HOME/cf-curl.conf"
}

# cbb <args...>: the bb CLI for orchestrating the spike. bb-app 0.45.0's CLI
# does not send BB_SERVER_HEADERS (only the daemon does), so through Access it
# gets the login page: it goes over the tailnet (Spike 2's sbb) instead. The
# machine under test still reaches the server through Cloudflare only.
cbb() { sbb "$@"; }

crpc() { # crpc <method> <json>: a Tutor RPC through Access
  printf '%s' "$2" >"$SPIKE2_HOME/rpc-input.json"
  cbb plugin rpc call tutor "$1" --input-file "$SPIKE2_HOME/rpc-input.json" --json
}

cf_machine_id() { cat "$CF_HOME/host-id" 2>/dev/null; }

check_health() {
  local conf code
  conf=$(curl_headers)
  code=$(curl -s -o /dev/null -m 15 -K "$conf" -w '%{http_code} %{redirect_url}' "$CF_URL/health" | cut -d'?' -f1) || code=none
  case "$code" in
    200*) result 3.1 PASS "with the service token, $CF_URL/health answers 200 through Access" ;;
    *) result 3.1 FAIL "with the service token, $CF_URL/health answered: $code (Service Auth policy on the app?)" ;;
  esac
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$CF_URL/health") || code=none
  if [ "$code" = 302 ]; then result 3.1 PASS "without it, Access still redirects ($code)"; else result 3.1 FAIL "without the token: $code"; fi
}

check_enrol() {
  headers_env
  mkdir -p "$CF_HOME"; chmod 700 "$CF_HOME"
  if systemctl --user is-active --quiet "$CF_UNIT"; then say "$CF_UNIT is already running"; return 0; fi
  systemctl --user reset-failed "$CF_UNIT" 2>/dev/null || true
  # `bb-app host-daemon join` asks the server for an enroll key with a plain
  # fetch that leaves BB_SERVER_HEADERS off (bb-app 0.45.0,
  # requestMatchingHostEnrollKey), so Access answers with its login page. Make
  # that one request here, with the token, and hand the key to the daemon
  # through a 0600 environment file. cloudflared reaches bb from loopback, so
  # the server grants it.
  local keyenv="$SPIKE2_HOME/cf-enroll.env"
  if [ ! -s "$CF_HOME/auth.json" ]; then
    local conf; conf=$(curl_headers)
    # shellcheck disable=SC2016 # JavaScript, not shell
    (
      umask 077
      curl -fsS -m 30 -K "$conf" -H 'content-type: application/json' -d '{}' "$CF_URL/internal/hosts/enroll-key" \
        | node -e '
            let r = ""; process.stdin.on("data", (c) => (r += c)).on("end", () => {
              const k = JSON.parse(r);
              if (!k.enrollKey || !k.hostId) process.exit(1);
              process.stdout.write(`BB_HOST_ENROLL_KEY=${k.enrollKey}\nBB_HOST_ID=${k.hostId}\n`);
            });' >"$keyenv"
    ) || { rm -f "$keyenv"; result 3.2 FAIL "no enroll key through Access"; return 1; }
  else
    : >"$keyenv"
  fi
  systemd-run --user --unit "$CF_UNIT" --description "Tutor Spike 3: student-001's machine through Cloudflare Access" \
    -p EnvironmentFile="$CF_ENV" -p EnvironmentFile="$keyenv" -p Restart=on-failure \
    "$BB_APP" host-daemon --server-url "$CF_URL" --host-daemon-port "$CF_DAEMON_PORT" >/dev/null
  for _ in $(seq 1 90); do
    [ -s "$CF_HOME/auth.json" ] && grep -qh 'Connected to server' "$CF_HOME"/logs/host-daemon*.log 2>/dev/null && break
    sleep 1
  done
  if [ -s "$CF_HOME/auth.json" ]; then
    result 3.2 PASS "a machine enrolled through Access: $(cf_machine_id) (unit $CF_UNIT)"
  else
    result 3.2 FAIL "no auth.json after 90 s; journalctl --user -u $CF_UNIT:"
    journalctl --user -u "$CF_UNIT" -n 30 --no-pager | grep -v -i 'secret\|header\|enroll_key' | cut -c1-200
    return 1
  fi
}

check_status() {
  headers_env
  local id; id=$(cf_machine_id) || die "not enrolled: cf-machine.sh enrol"
  if cbb machine show "$id" --json | grep -q '"status": *"connected"'; then
    result 3.3 PASS "machine $id is connected through Access"
  else
    result 3.3 FAIL "machine $id: $(cbb machine show "$id" --json 2>&1 | head -c 300)"
  fi
  grep -ho '"time":[0-9]*,"component":"host-daemon"[^}]*"msg":"\(Connected to\|Disconnected from\) server"' "$CF_HOME"/logs/host-daemon*.log 2>/dev/null | tail -n 5 || true
}

check_workspace() {
  headers_env
  local id; id=$(cf_machine_id) || die "not enrolled: cf-machine.sh enrol"
  mkdir -p "$CF_WORKSPACE"
  [ -d "$CF_WORKSPACE/.git" ] || git -C "$CF_WORKSPACE" init -q
  local old project
  old=$(cbb plugin config tutor --json 2>/dev/null | json 'v.values?.workspaceProject ?? ""' 2>/dev/null) || old=""
  [ -f "$SPIKE2_HOME/tailnet-workspace-project" ] || printf '%s\n' "$old" >"$SPIKE2_HOME/tailnet-workspace-project"
  project=$(cat "$SPIKE2_HOME/cf-workspace-project" 2>/dev/null) || project=""
  if [ -z "$project" ]; then
    project=$(cbb project create --name "$(basename "$CF_WORKSPACE") (via Cloudflare)" --root "$CF_WORKSPACE" --machine "$id" --json | json 'v.id ?? v.project?.id')
    printf '%s\n' "$project" >"$SPIKE2_HOME/cf-workspace-project"
  fi
  cbb plugin config tutor set workspaceProject "$project" >/dev/null
  local times=() start end status
  for _ in 1 2 3 4 5; do
    start=$(date +%s%N); crpc getOverview 'null' >"$SPIKE2_HOME/overview-cf.json"; end=$(date +%s%N)
    times+=("$(( (end - start) / 1000000 ))")
  done
  status=$(json 'v.workspace?.status ?? v.result?.workspace?.status' <"$SPIKE2_HOME/overview-cf.json")
  if [ "$status" = found ]; then
    result 3.4 PASS "the workspace $CF_WORKSPACE is read through the Cloudflare machine; getOverview (the CLI over the tailnet, the machine via Cloudflare) took ${times[*]} ms"
  else
    result 3.4 FAIL "the workspace is \"$status\"; getOverview took ${times[*]} ms"
  fi
}

check_coach() {
  headers_env
  local agent=${1:-claude-code} previous thread
  previous=$(cat "$SPIKE2_HOME/coach.thread" 2>/dev/null) || previous=""
  [ -z "$previous" ] || cbb thread archive "$previous" >/dev/null 2>&1 || true
  cbb plugin config tutor set coachProvider "$agent" >/dev/null
  cbb plugin config tutor set coachModel "" >/dev/null
  thread=$(crpc openCoach '{"courseId":"tutor","lessonId":"000"}' | json 'v.threadId ?? v.result?.threadId ?? ""')
  [ -n "$thread" ] || { result 3.5 FAIL "openCoach opened no thread"; return 1; }
  printf '%s\n' "$thread" >"$SPIKE2_HOME/coach.thread"
  cbb thread wait "$thread" --timeout 300s >/dev/null 2>&1 || true
  cbb thread log "$thread" --all --json >"$SPIKE2_HOME/coach-cf-$agent.log.json" 2>&1 || true
  local tools
  tools=$(node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const names = new Set();
    for (const e of Array.isArray(d) ? d : []) { const it = e.type === "item/completed" ? e.data?.item : null; if (it?.type === "toolCall" && /^tutor_/.test(it.tool ?? "")) names.add(it.tool); }
    console.log([...names].join(" "));' "$SPIKE2_HOME/coach-cf-$agent.log.json" 2>/dev/null) || tools=""
  if [ -n "$tools" ]; then
    result 3.5 PASS "$agent coach on the Cloudflare machine ($thread) called: $tools"
  else
    result 3.5 FAIL "$agent coach ($thread) called no tutor_* tool: $SPIKE2_HOME/coach-cf-$agent.log.json"
  fi
  cbb plugin config tutor set coachProvider "" >/dev/null
}

restore() {
  headers_env
  local old; old=$(cat "$SPIKE2_HOME/tailnet-workspace-project" 2>/dev/null) || die "nothing to restore"
  cbb plugin config tutor set workspaceProject "$old" >/dev/null
  say "workspaceProject is $old again (Spike 2's tailnet machine)"
}

teardown() {
  local id; id=$(cf_machine_id) || id=""
  if [ -n "$id" ] && [ -f "$CF_ENV" ]; then cbb machine remove "$id" --yes >/dev/null 2>&1 || say "couldn't remove $id from the server"; fi
  systemctl --user stop "$CF_UNIT" 2>/dev/null || true
  systemctl --user reset-failed "$CF_UNIT" 2>/dev/null || true
  rm -rf "$CF_HOME" "$CF_ENV" "$SPIKE2_HOME/cf-curl.conf" "$SPIKE2_HOME/cf-enroll.env" "$SPIKE2_HOME/cf-workspace-project"
  say "removed the Cloudflare machine; the workspace $CF_WORKSPACE is left alone"
}

case "${1:-}" in
  health) check_health ;;
  enrol) check_enrol ;;
  status) check_status ;;
  workspace) check_workspace ;;
  coach) shift; check_coach "$@" ;;
  restore) restore ;;
  teardown) teardown ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
