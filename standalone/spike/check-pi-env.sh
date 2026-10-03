#!/bin/sh
# Task 1's checks, run in stages. Each check prints PASS/FAIL/INFO and
# appends it to $SPIKE_HOME/results.txt, which feeds the spike document.
#
#   check-pi-env.sh before-login   checks 1, 2, 4; remembers ~/.pi's checksum
#   check-pi-env.sh login          runs Tutor's pi against $SPIKE_HOME/pi: type /login, then /quit
#   check-pi-env.sh after-login    checks 5, 6, 7   (needs SPIKE_PROVIDER, see below)
#   check-pi-env.sh rewrite        check 3: re-run BB's installer, see what survives, repair
#   check-pi-env.sh after-reboot   check 8: checks 1 and 7 again after a reboot
#
# SPIKE_PROVIDER: a pi provider you sign in to with `login` but NOT in your own
# ~/.pi (for example openai-codex when ~/.pi only has anthropic). Check 6 uses
# it to tell which pi directory model discovery read.
set -eu
. "$(dirname "$0")/lib.sh"

checksum() { if [ -f "$1" ]; then cksum <"$1"; else echo absent; fi; }
# How many times tee-pi has started pi so far.
launches() { if [ -f "$LOGS/pi-env.log" ]; then grep -c '^===' "$LOGS/pi-env.log" || true; else echo 0; fi; }
OWN_AUTH="$HOME/.pi/agent/auth.json"

# Check 1: the running machine daemon's environment holds both variables.
check_env() {
  label=$1
  case "$(os_kind)" in
    linux)
      unit=$(machine_unit_name)
      pid=$(systemctl --user show -p MainPID --value "$unit")
      [ -n "$pid" ] && [ "$pid" != 0 ] || { result "$label" FAIL "machine service $unit is not running"; return; }
      envs=$(tr '\0' '\n' <"/proc/$pid/environ")
      ;;
    macos)
      envs=$(launchctl print "gui/$(id -u)/$(machine_label)" 2>/dev/null | sed -n '/environment = {/,/}/p')
      ;;
  esac
  if printf '%s\n' "$envs" | grep -q "PI_CODING_AGENT_DIR.*$PI_DIR" \
    && printf '%s\n' "$envs" | grep -q "BB_PI_BRIDGE_COMMAND.*$TEE_PI"; then
    result "$label" PASS "the machine daemon's environment has PI_CODING_AGENT_DIR and BB_PI_BRIDGE_COMMAND"
  else
    result "$label" FAIL "the machine daemon's environment lacks one or both variables"
  fi
}

# Check 7: a pi thread spawned on the machine starts pi through tee-pi with Tutor's pi dir.
check_thread() {
  label=$1
  mid=$(machine_id) || { result "$label" FAIL "no machine id (set SPIKE_MACHINE_ID)"; return; }
  if [ ! -s "$SPIKE_HOME/project.id" ]; then
    [ -d "$SPIKE_HOME/ws/.git" ] || git -C "$SPIKE_HOME/ws" init -q
    spike_bb project create --name tutor-spike --root "$SPIKE_HOME/ws" --machine "$mid" --json \
      | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);console.log(d.id??d.project?.id)})' \
      >"$SPIKE_HOME/project.id"
  fi
  project=$(cat "$SPIKE_HOME/project.id")
  before=$(launches)
  spike_bb thread spawn --project "$project" --machine "$mid" --provider pi \
    --prompt "Reply with the single word: ok" --json >"$LOGS/thread-$label.json" 2>&1 \
    || { result "$label" FAIL "thread spawn failed; see $LOGS/thread-$label.json"; return; }
  for _ in $(seq 1 120); do
    [ "$(launches)" -gt "$before" ] && break
    sleep 1
  done
  if [ "$(launches)" -le "$before" ]; then
    result "$label" FAIL "pi was never started through tee-pi within 120 s (BB_PI_BRIDGE_COMMAND ignored?)"
    return
  fi
  if tail -n 4 "$LOGS/pi-env.log" | grep -qx "PI_CODING_AGENT_DIR=$PI_DIR"; then
    result "$label" PASS "the thread started pi through tee-pi with PI_CODING_AGENT_DIR=$PI_DIR"
  else
    result "$label" FAIL "pi started through tee-pi but with $(tail -n 4 "$LOGS/pi-env.log" | grep PI_CODING_AGENT_DIR)"
  fi
}

before_login() {
  checksum "$OWN_AUTH" >"$SPIKE_HOME/own-auth.cksum"
  say "Remembered ~/.pi/agent/auth.json: $(cat "$SPIKE_HOME/own-auth.cksum")"
  check_env 1
  restart_machine
  sleep 3
  check_env 2
  # Check 4: Tutor's pi sees no credentials before login. API keys in your
  # shell's environment would still show models; note any in the document.
  if [ -f "$PI_DIR/auth.json" ]; then
    result 4 FAIL "$PI_DIR/auth.json already exists before login"
  else
    PI_CODING_AGENT_DIR="$PI_DIR" "$PI_REAL" --list-models </dev/null >"$LOGS/models-before-login.txt" 2>&1 || true
    result 4 INFO "no auth.json in $PI_DIR; --list-models printed $(wc -l <"$LOGS/models-before-login.txt" | tr -d ' ') lines (see $LOGS/models-before-login.txt; API keys in your environment count too)"
  fi
}

login() {
  say "Starting Tutor's pi with PI_CODING_AGENT_DIR=$PI_DIR."
  say "Type /login, sign in to SPIKE_PROVIDER (a provider your own ~/.pi doesn't have), then /quit."
  say "Write down the exact steps: they become PI_LOGIN in the spike document."
  PI_CODING_AGENT_DIR="$PI_DIR" "$PI_REAL"
}

after_login() {
  [ -n "${SPIKE_PROVIDER:-}" ] || die "Set SPIKE_PROVIDER to the provider you signed in to with 'login'."
  # Check 5: credentials landed in Tutor's pi dir, and ~/.pi didn't change.
  own_before=$(cat "$SPIKE_HOME/own-auth.cksum" 2>/dev/null || echo unknown)
  own_now=$(checksum "$OWN_AUTH")
  if [ -s "$PI_DIR/auth.json" ] && [ "$own_before" = "$own_now" ]; then
    result 5 PASS "login wrote $PI_DIR/auth.json and ~/.pi/agent/auth.json is unchanged"
  elif [ ! -s "$PI_DIR/auth.json" ]; then
    result 5 FAIL "no $PI_DIR/auth.json after login (login wrote elsewhere?)"
  else
    result 5 FAIL "$OWN_AUTH changed during login ($own_before → $own_now)"
  fi
  if PI_CODING_AGENT_DIR="$PI_DIR" "$PI_REAL" auth check --provider "$SPIKE_PROVIDER" </dev/null >"$LOGS/auth-check-tutor.txt" 2>&1; then
    result 5 INFO "pi auth check --provider $SPIKE_PROVIDER passes for Tutor's pi (candidate PI_READY)"
  else
    result 5 INFO "pi auth check --provider $SPIKE_PROVIDER fails for Tutor's pi; see $LOGS/auth-check-tutor.txt"
  fi

  # Check 6: model discovery on the machine reads Tutor's pi dir.
  own_has=no
  if "$PI_REAL" auth check --provider "$SPIKE_PROVIDER" </dev/null >/dev/null 2>&1; then own_has=yes; fi
  mid=$(machine_id) || die "no machine id (set SPIKE_MACHINE_ID)"
  spike_bb provider models pi --machine "$mid" --json >"$LOGS/discovery.json" 2>&1 || true
  if grep -qi "$SPIKE_PROVIDER" "$LOGS/discovery.json"; then
    if [ "$own_has" = no ]; then
      result 6 PASS "the machine's pi models include $SPIKE_PROVIDER, which only Tutor's pi is signed in to"
    else
      result 6 INFO "$SPIKE_PROVIDER found, but your own ~/.pi is signed in to it too: inconclusive, pick another provider"
    fi
  else
    result 6 FAIL "the machine's pi models don't include $SPIKE_PROVIDER (see $LOGS/discovery.json): discovery may read ~/.pi"
  fi

  check_thread 7
  say "Now copy one coach turn from $LOGS/pi-in.log and pi-out.log into standalone/e2e/fixtures/pi-rpc-transcript.jsonl, credentials redacted."
}

rewrite() {
  unit=$(machine_unit_file)
  before=$(checksum "$unit")
  if [ ! -f "$SPIKE_HOME/machine-installer.sh" ]; then
    die "No saved installer (it held the token and wasn't kept?). Record that, and skip check 3."
  fi
  if sh "$SPIKE_HOME/machine-installer.sh" >"$LOGS/reinstall.log" 2>&1; then
    result 3 INFO "re-running BB's saved installer worked without a new enrolment"
  else
    result 3 INFO "re-running BB's saved installer failed (see $LOGS/reinstall.log): an update rewrite needs another route; note what"
  fi
  after=$(checksum "$(machine_unit_file)")
  [ "$before" = "$after" ] && changed=unchanged || changed=rewritten
  case "$(os_kind)" in
    linux)
      if [ -f "$unit.d/tutor.conf" ]; then kept="the drop-in survived"; else kept="the drop-in is GONE"; fi
      ;;
    macos)
      if /usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:PI_CODING_AGENT_DIR' "$(machine_unit_file)" >/dev/null 2>&1; then
        kept="EnvironmentVariables survived"
      else
        kept="EnvironmentVariables are GONE"
      fi
      ;;
  esac
  result 3 INFO "service file $changed; $kept"
  restart_machine
  sleep 3
  check_env 3
  say "Repairing with apply-env.sh (what tutor up will do):"
  sh "$(dirname "$0")/apply-env.sh"
  check_env 3
}

after_reboot() {
  check_env 8
  check_thread 8
}

case "${1:-}" in
  before-login) before_login ;;
  login) login ;;
  after-login) after_login ;;
  rewrite) rewrite ;;
  after-reboot) after_reboot ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
