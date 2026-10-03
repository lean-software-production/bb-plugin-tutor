#!/usr/bin/env bash
# Spike 2 checks, run on the laptop once box-setup.sh and laptop-enrol.sh have
# worked. Each prints PASS / FAIL / INFO lines, also kept in results.txt.
#
#   checks.sh memory            2. the student's server's memory (idle; again with a coach running)
#   checks.sh providers         4. which agents BB finds ready on this laptop's machine
#   checks.sh workspace         5. a workspace on the laptop, and how long host calls take
#   checks.sh coach <provider> [model]  6. a Lesson 0 coach on claude-code | codex | pi: Tutor's tools reach
#                                  it, and it forks a side chat
#   checks.sh connected         7. the machine is connected (run after a suspend, or a tailnet drop)
#   checks.sh browser           8. the public hostname answers, and only through Access
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

mid=$(machine_id) || true

check_memory() {
  local mem
  mem=$(ssh -o BatchMode=yes "$BOX" "systemctl show tutor-$STUDENT.service -p MemoryCurrent --value; free -m | awk '/^Mem:/{print \$7}'")
  result 2 INFO "tutor-$STUDENT uses $(( $(sed -n 1p <<<"$mem") / 1048576 )) MiB; the box has $(sed -n 2p <<<"$mem") MiB available"
}

check_providers() {
  [ -n "$mid" ] || die "not enrolled: run laptop-enrol.sh"
  sbb provider list --machine "$mid" --json >"$SPIKE2_HOME/providers.json"
  # shellcheck disable=SC2016 # JavaScript, not shell
  node -e '
    const rows = require(process.argv[1]);
    for (const p of rows) console.log(`${p.id}\t${p.available ? "available" : "not available"}\t${JSON.stringify(p.availability ?? p.status ?? p.health ?? "")}`);
  ' "$SPIKE2_HOME/providers.json" | while IFS=$'\t' read -r id state detail; do
    case "$id" in claude-code|codex|pi) result 4 INFO "$id: $state $detail" ;; esac
  done
  say "(all providers: $SPIKE2_HOME/providers.json)"
}

check_workspace() {
  [ -n "$mid" ] || die "not enrolled: run laptop-enrol.sh"
  mkdir -p "$WORKSPACE"
  [ -d "$WORKSPACE/.git" ] || git -C "$WORKSPACE" init -q
  local project
  project=$(sbb plugin config tutor get workspaceProject --json 2>/dev/null | json 'v.value ?? ""' 2>/dev/null) || project=""
  if [ -z "$project" ]; then
    project=$(sbb project create --name "$(basename "$WORKSPACE")" --root "$WORKSPACE" --machine "$mid" --json | json 'v.id ?? v.project?.id')
    sbb plugin config tutor set workspaceProject "$project" >/dev/null
  fi
  result 5 INFO "workspace $WORKSPACE is project $project on machine $mid"
  local times=() start end
  for _ in 1 2 3 4 5; do
    start=$(date +%s%N); rpc getOverview 'null' >"$SPIKE2_HOME/overview.json"; end=$(date +%s%N)
    times+=("$(( (end - start) / 1000000 ))")
  done
  local status
  status=$(json 'v.workspace?.status ?? v.result?.workspace?.status' <"$SPIKE2_HOME/overview.json")
  if [ "$status" = found ]; then
    result 5 PASS "the server reads the workspace through the laptop's machine; getOverview took ${times[*]} ms"
  else
    result 5 FAIL "the workspace is \"$status\" (overview in $SPIKE2_HOME/overview.json); getOverview took ${times[*]} ms"
  fi
}

check_coach() {
  local provider=${1:?checks.sh coach <claude-code|codex|pi> [model]} model=${2:-}
  [ -n "$mid" ] || die "not enrolled: run laptop-enrol.sh"
  # One coach thread per lesson: archive the last one, so this provider gets its own.
  local previous
  previous=$(cat "$SPIKE2_HOME/coach.thread" 2>/dev/null) || previous=""
  [ -z "$previous" ] || sbb thread archive "$previous" >/dev/null 2>&1 || true
  sbb plugin config tutor set coachProvider "$provider" >/dev/null
  sbb plugin config tutor set coachModel "$model" >/dev/null
  local thread
  thread=$(rpc openCoach '{"courseId":"tutor","lessonId":"000"}' | json 'v.threadId ?? v.result?.threadId ?? ""')
  [ -n "$thread" ] || { result 6 FAIL "$provider: openCoach opened no thread"; return 1; }
  printf '%s\n' "$thread" >"$SPIKE2_HOME/coach.thread"
  result 6 INFO "$provider (model: ${model:-default}): coach thread $thread (https://$PUBLIC_HOST)"
  sbb thread wait "$thread" --timeout 300s >/dev/null 2>&1 || true
  printf 'Before anything else: call the tutor_status tool and reply with the first line it returns.\n' >"$SPIKE2_HOME/tell.txt"
  sbb thread tell "$thread" --message-file "$SPIKE2_HOME/tell.txt" >/dev/null
  sbb thread wait "$thread" --timeout 300s >/dev/null 2>&1 || true
  sbb thread log "$thread" --all --json >"$SPIKE2_HOME/coach-$provider.log.json" 2>&1 || true
  # A completed toolCall item naming a tutor_* tool: the prompt itself says
  # "tutor_status", so a plain grep of the log would always match.
  local tools
  tools=$(node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const names = new Set();
    for (const e of Array.isArray(d) ? d : []) {
      const item = e.type === "item/completed" ? e.data?.item : null;
      if (item?.type === "toolCall" && /^tutor_/.test(item.tool ?? "")) names.add(item.tool);
    }
    console.log([...names].join(" "));
  ' "$SPIKE2_HOME/coach-$provider.log.json" 2>/dev/null) || tools=""
  if [[ " $tools " == *" tutor_status "* ]]; then
    result 6 PASS "$provider: the coach called Tutor's tools: $tools (log: $SPIKE2_HOME/coach-$provider.log.json)"
  else
    result 6 FAIL "$provider: no tutor_status call in the thread's log ($SPIKE2_HOME/coach-$provider.log.json)"
  fi
  local side
  side=$(rpc startSideChat '{"courseId":"tutor","lessonId":"000","ruleKey":null}' 2>&1 | json 'v.sideChatId ?? v.result?.sideChatId ?? ""' 2>/dev/null) || side=""
  if [ -n "$side" ]; then
    result 6 PASS "$provider: a side chat forked from the coach ($side)"
  else
    result 6 FAIL "$provider: no side chat forked"
  fi
}

check_connected() {
  [ -n "$mid" ] || die "not enrolled: run laptop-enrol.sh"
  if sbb machine show "$mid" --json | grep -q '"status": *"connected"'; then
    result 7 PASS "machine $mid is connected"
  else
    result 7 FAIL "machine $mid is not connected: $(sbb machine show "$mid" --json | json 'v.status ?? v.machine?.status')"
  fi
}

check_browser() {
  local code
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code} %{redirect_url}' "https://$PUBLIC_HOST/health") || code="none"
  case "$code" in
    30[0-9]*cloudflareaccess.com*) result 8 PASS "https://$PUBLIC_HOST sends a visitor to Cloudflare Access ($code)" ;;
    200*) result 8 FAIL "https://$PUBLIC_HOST answers WITHOUT Access: stop cloudflared's route now" ;;
    *) result 8 INFO "https://$PUBLIC_HOST answered: $code" ;;
  esac
  say "Now open https://$PUBLIC_HOST in a browser, log in through Access, and check the outline and a coach thread work."
}

case "${1:-}" in
  memory) check_memory ;;
  providers) check_providers ;;
  workspace) check_workspace ;;
  coach) shift; check_coach "$@" ;;
  connected) check_connected ;;
  browser) check_browser ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac
