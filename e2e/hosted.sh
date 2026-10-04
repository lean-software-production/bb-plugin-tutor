#!/usr/bin/env bash
# The hosted Tutor end to end, on a real Linux computer, in stages. This
# replaces the retired all-on-the-laptop launcher's standalone/e2e/e2e.sh: the
# student's bb-server runs as its own Linux user (as on ew-lsp-001), loopback
# only, and this user's own bb-app host-daemon is the "Codespace" machine —
# the shape a hosted student gets, without Cloudflare Access (that's Spike 3;
# loopback callers get an enroll key with no token needed).
#
# Never run it where a real BB or Tutor server you care about is installed.
# Its own files go under $E2E_DIR (~/tutor-e2e-hosted by default): the
# controller's own BB CLI, the release archive, the workspace ("Codespace")
# checkout, the fixture course repos, logs and results.txt.
#
#   SERVER_USER  the Linux user the student server runs as. Defaults to
#                tutor-e2e-server, made (and sudo'd into) with useradd; CI
#                sets this. Set it to your own user (`id -un`) to skip
#                useradd/sudo entirely and run the server as yourself — for a
#                local run where you'd rather not need sudo.
#   PORT         the student server's port. Defaults to 47390 (the host
#                daemon listens on PORT+1, 47391), chosen to be unlikely to
#                clash with anything else on a dev laptop.
#   E2E_DIR      defaults to ~/tutor-e2e-hosted.
#
#   e2e/hosted.sh build       the plugin's built release archive from HEAD,
#                             with bb-app@<engines.bb> (the build is stamped
#                             with the CLI's SDK version)
#   e2e/hosted.sh server      the student's bb-server, as $SERVER_USER, loopback
#   e2e/hosted.sh machine     this user's bb-app host-daemon, joined over loopback
#   e2e/hosted.sh first-run   the hosted first run: offerWorkspace, createWorkspace
#   e2e/hosted.sh lessons     fetch the fixture course, install the scripted
#                             provider, then adopt/pass/complete lessons 001-004
#                             (the factory's tests run on the machine; the move at 004)
#   e2e/hosted.sh all         every stage above, in order
#
# Each stage prints ok / not ok lines (also appended to $E2E_DIR/results.txt)
# and stops at the first failure.
set -uo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(node -p 'require(process.argv[1]).version' "$REPO/package.json")
SERVER_USER=${SERVER_USER:-tutor-e2e-server}
PORT=${PORT:-47390}
DAEMON_PORT=$((PORT + 1))
SERVER_URL="http://127.0.0.1:$PORT"
E2E_DIR=${E2E_DIR:-$HOME/tutor-e2e-hosted}
WS="$E2E_DIR/workspace"
BBCLI="$E2E_DIR/bb-cli/node_modules/.bin"
export E2E_DIR

mkdir -p "$E2E_DIR"
RESULTS="$E2E_DIR/results.txt"

check() {
  local what=$1; shift
  if "$@"; then
    printf 'ok — %s\n' "$what" | tee -a "$RESULTS"
  else
    printf 'not ok — %s\n' "$what" | tee -a "$RESULTS"
    exit 1
  fi
}
quiet() { "$@" >/dev/null; }
info() { printf 'info — %s\n' "$*" | tee -a "$RESULTS"; }

# bb against the student's server, never a BB the shell already points at.
# Inside a BB thread every BB_* variable names that BB (BB_CLI re-runs
# another bb, BB_THREAD_ID makes `thread tell` send as a thread the student
# server lacks), so every inherited BB_* is stripped, not just a few.
bbx() {
  local unset=() name
  while read -r name; do unset+=(-u "$name"); done < <(compgen -e | grep '^BB_' || true)
  env "${unset[@]}" BB_SERVER_URL="$SERVER_URL" "$BBCLI/bb" "$@"
}
rpc() { # rpc <method> <json input> → stdout JSON
  local input="$E2E_DIR/rpc-input.json"
  printf '%s' "$2" >"$input"
  bbx plugin rpc call tutor "$1" --input-file "$input" --json
}
json() { node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const v=JSON.parse(r);const f=new Function("v","return ("+process.argv[1]+")");const o=f(v);process.stdout.write(typeof o==="string"?o:JSON.stringify(o))})' "$1"; }
contains() { printf '%s' "$1" | grep -q -- "$2"; }          # contains <text> <pattern>
machine_connected() { bbx machine list --json | grep -q '"connected"'; }
machine_id() { bbx machine list --json | json 'v.find(x=>x.status==="connected")?.id ?? ""'; }
# course_order <overview json> <ids>: the outline's courses, in order; on a
# mismatch it says what the outline held (the whole reply is in overview.json).
course_order() {
  printf '%s' "$1" >"$E2E_DIR/overview.json"
  printf '%s' "$1" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let o;try{const v=JSON.parse(r);o=v.result??v}catch{console.error("  not JSON: "+r.slice(0,300));process.exit(1)}const ids=(o.courses??[]).map(c=>c.course.id).join(",");if(ids===process.argv[1])process.exit(0);console.error("  outline: courses ["+ids+"], workspace "+JSON.stringify(o.workspace?.status)+", available ["+(o.available??[]).map(a=>a.id)+"], courseErrors "+JSON.stringify(o.courseErrors));process.exit(1)})' "$2"
}

# --- the student's own Linux user: run plain commands as ourselves when
# SERVER_USER is us, else sudo (useradd once, then sudo -u for every command
# that touches the student server's files or process).
if [ "$SERVER_USER" = "$(id -un)" ]; then
  SRV=(); SRVSUDO=()
else
  SRV=(sudo -u "$SERVER_USER"); SRVSUDO=(sudo)
fi
as_server() { "${SRV[@]}" "$@"; }
# ensure_server_user: idempotent; also sets $H (the server user's home), once.
ensure_server_user() {
  [ -n "${H:-}" ] && return 0
  if [ "$SERVER_USER" != "$(id -un)" ]; then
    id "$SERVER_USER" >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash "$SERVER_USER"
  fi
  H=$(getent passwd "$SERVER_USER" | cut -d: -f6)
}
no_workspace_copy() { # no_workspace_copy <filename>: true if none found outside content/ in the server's data dir
  [ -z "$(as_server find "$H/server" -path "$H/server/content" -prune -o -name "$1" -print)" ]
}
factory_tests_on_machine() { # runs `npm test` in the factory through a terminal on the enrolled machine
  local factory=$1 mid out
  mid=$(machine_id)
  out=$(bbx terminal create --machine "$mid" --cwd "$factory" --title "factory tests" --json -- sh -c 'npm test >.e2e-test.log 2>&1; echo $? >.e2e-test.status' 2>&1) || { printf '%s\n' "$out" >>"$RESULTS"; return 1; }
  for _ in $(seq 1 60); do [ -f "$factory/.e2e-test.status" ] && break; sleep 1; done
  local status; status=$(cat "$factory/.e2e-test.status" 2>/dev/null)
  rm -f "$factory/.e2e-test.status"
  [ "$status" = 0 ]
}
commit_all() { git -C "$WS" add -A && git -C "$WS" -c user.name=e2e -c user.email=e2e@example.invalid commit -qm "$1"; }

make_fixture() {
  local fx="$E2E_DIR/fixtures"
  rm -rf "$fx"; mkdir -p "$fx/course" "$fx/starter"
  local g=(git -c user.name=e2e -c user.email=e2e@example.invalid -c init.defaultBranch=main)
  # The starter: what a capstone-factory course seeds into the workspace.
  mkdir -p "$fx/starter/tetris/.factory" "$fx/starter/tetris/seeds" "$fx/starter/.agents/skills/coach-me" "$fx/starter/.github"
  printf '# The factory\n\nRun `npm test` here.\n' >"$fx/starter/tetris/.factory/AGENTS.md"
  printf '{ "name": "factory", "private": true, "scripts": { "test": "node --test" } }\n' >"$fx/starter/tetris/.factory/package.json"
  printf 'import { test } from "node:test";\ntest("the factory runs", () => {});\n' >"$fx/starter/tetris/.factory/factory.test.mjs"
  printf -- '---\nname: coach-me\ndescription: Coach the student one step at a time.\n---\nCoach one small step at a time.\n' >"$fx/starter/.agents/skills/coach-me/SKILL.md"
  printf 'name: ci\n' >"$fx/starter/.github/ci.yml"
  (cd "$fx/starter" && "${g[@]}" init -q && "${g[@]}" add -A && "${g[@]}" commit -qm starter && "${g[@]}" tag v1)
  # The course: four lessons, one Rule and one Example each.
  for n in 1 2 3 4; do
    local id; id=$(printf '%03d' "$n")
    local d="$fx/course/lessons/$id"
    mkdir -p "$d/features"
    printf '# Lesson %s — Step %s\n\nThe factory takes step %s.\n' "$n" "$n" "$n" >"$d/README.md"
    printf '# The factory, as of lesson %s\n\nIt can take %s steps.\n' "$n" "$n" >"$d/FACTORY.md"
    printf 'Feature: Step %s\n\n  Rule: The factory takes step %s\n\n    Example: Step %s runs\n      Given a factory\n      When it takes step %s\n      Then it works\n' "$n" "$n" "$n" "$n" >"$d/features/step.feature"
  done
  printf '# The sample seed\n' >"$fx/course/lessons/001/spec.md"
  {
    printf 'id: fixture\ntitle: Fixture course\ndescription: Four tiny lessons for the end-to-end test.\nlayout: capstone-factory\n'
    printf 'starter:\n  repo: file://%s/starter\n  ref: v1\n' "$fx"
    printf 'lessons:\n'
    for n in 1 2 3 4; do printf '  - { id: "%03d", title: Step %s, dir: lessons/%03d }\n' "$n" "$n" "$n"; done
  } >"$fx/course/course.yaml"
  (cd "$fx/course" && "${g[@]}" init -q && "${g[@]}" add -A && "${g[@]}" commit -qm course && "${g[@]}" tag v1)
}

# tell <thread> <line>…: send the lines to the coach thread and wait for its turn to finish.
tell() {
  local thread=$1; shift
  printf '%s\n' "$@" >"$E2E_DIR/tell.txt"
  bbx thread tell "$thread" --message-file "$E2E_DIR/tell.txt" >/dev/null || return 1
  sleep 1
  bbx thread wait "$thread" --timeout 120s >/dev/null 2>&1
}
iteration_is() { [ "$(tr -d '\n' <"$1/ITERATION" 2>/dev/null)" = "$2" ]; }
example_keys() { # example_keys <lesson>: every Example key of the fixture lesson, one per line
  rpc getLessonDetail "{\"courseId\":\"fixture\",\"lessonId\":\"$1\"}" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const v=JSON.parse(r);const d=v.result??v;for(const f of d.lesson.features)for(const ru of f.rules)for(const e of ru.examples)console.log(e.key)})'
}

# --- stages -------------------------------------------------------------

stage_build() { # the plugin's built archive, with the CLI the build is stamped with
  rm -rf "$E2E_DIR/release"; mkdir -p "$E2E_DIR/release"
  local bb_version; bb_version=$(node -p 'require(process.argv[1]).engines.bb.replace(">=","")' "$REPO/package.json")
  check "bb-app@$bb_version is fetched for the build" \
    npm install --prefix "$E2E_DIR/bb-cli" --no-save --no-audit --no-fund --silent "bb-app@$bb_version"
  check "the plugin release archive builds from HEAD" \
    env PATH="$BBCLI:$PATH" "$REPO/scripts/release-archive.sh" HEAD "$E2E_DIR/release"
  check "it checks out, and the built archive is written" \
    env PATH="$BBCLI:$PATH" "$REPO/scripts/check-release-archive.sh" "$E2E_DIR/release/bb-plugin-tutor-$VERSION.tgz"
}

stage_server() { # the student server, as its own Linux user (as on ew-lsp-001), loopback only
  ensure_server_user
  "${SRV[@]}" npm install --prefix "$H/npm" --no-audit --no-fund --silent "bb-app@0.45.0"
  check "bb-server installs for $SERVER_USER" test -x "$H/npm/node_modules/.bin/bb-server"
  "${SRV[@]}" bash -c "cd '$H' && nohup '$H/npm/node_modules/.bin/bb-server' --data-dir '$H/server' --server-bind-host 127.0.0.1 --server-port $PORT >'$H/server.log' 2>&1 & disown"
  for _ in $(seq 1 60); do curl -fsS "$SERVER_URL/health" -o /dev/null 2>/dev/null && break; sleep 1; done
  check "the student server is healthy" curl -fsS "$SERVER_URL/health" -o /dev/null
  "${SRVSUDO[@]}" install -m 644 "$E2E_DIR/release/bb-plugin-tutor-$VERSION-built.tgz" "$H/plugin.tgz"
  "${SRV[@]}" tar -xzf "$H/plugin.tgz" -C "$H"
  check "Tutor's plugin installs" \
    "${SRV[@]}" env BB_SERVER_URL="$SERVER_URL" "$H/npm/node_modules/.bin/bb" plugin install "$H/bb-plugin-tutor-$VERSION" --yes
}

stage_machine() { # the "Codespace": enrolled with the built-in "manual" machine
  # provider, over loopback (no Access in CI). offerHostedWorkspace only
  # offers a machine whose machineProviderId is non-null — a bare
  # `bb-app host-daemon join` self-enrolls with machineProviderId null (it's
  # the server granting a key to itself, not the manual provider), so Tutor's
  # first run would never see it. Point server-to-machine access at this
  # loopback URL directly (else the manual provider's enrollment command
  # waits on bb connect, which needs a signed-in bb account) and go through
  # `bb machine create --provider manual`, as the real "connect your machine"
  # flow does.
  rm -rf "$E2E_DIR/machine"; mkdir -p "$E2E_DIR/machine"; mkdir -p "$WS"; git -C "$WS" init -q
  check "machine enrollment is pointed at this server" quiet bbx settings general machineServerUrl "$SERVER_URL"
  check "direct access needs no bb account sign-in" quiet bbx settings general defaultMachineAccess direct
  local out="$E2E_DIR/machine-create.out"; : >"$out"
  bbx machine create --provider manual --key "hosted-e2e-$PORT-$$" >"$out" 2>&1 &
  local create_pid=$!
  local header=""
  for _ in $(seq 1 30); do
    header=$(grep -m1 'X-BB-Enrollment' "$out" 2>/dev/null) || header=""
    [ -n "$header" ] && break
    kill -0 "$create_pid" 2>/dev/null || break
    sleep 1
  done
  check "bb machine create prints an enrollment command" test -n "$header"
  local token; token=$(printf '%s\n' "$header" | grep -o 'X-BB-Enrollment: [^'"'"']*' | cut -d' ' -f2)
  curl -fsS -H "X-BB-Enrollment: $token" "$SERVER_URL/install.sh" -o "$E2E_DIR/machine-install.sh"
  # install.sh's own first line: `export BB_ENROLLMENT='{"hostId":...,"serverUrl":...,"credential":...,"expiresAt":...}'`
  local enrollment; enrollment=$(sed -n "1p" "$E2E_DIR/machine-install.sh" | sed "s/^export BB_ENROLLMENT='//; s/'\$//")
  check "the enrollment command carries this host's bootstrap" contains "$enrollment" '"serverUrl"'
  check "this user enrolls as the manual-provider machine" \
    env BB_ENROLLMENT="$enrollment" BB_DATA_DIR="$E2E_DIR/machine" "$BBCLI/bb" machine enroll --bootstrap-env BB_ENROLLMENT
  BB_DATA_DIR="$E2E_DIR/machine" nohup "$BBCLI/bb-app" host-daemon join --server-url "$SERVER_URL" --host-daemon-port "$DAEMON_PORT" >"$E2E_DIR/machine.log" 2>&1 &
  for _ in $(seq 1 60); do machine_connected && break; sleep 1; done
  check "the machine is connected" machine_connected
  kill "$create_pid" 2>/dev/null || true
}

stage_first_run() {
  check "the workspace folder setting points at the checkout" quiet bbx plugin config tutor set workspaceFolder "$WS"
  local offer; offer=$(rpc offerWorkspace null)
  check "the first run offers the checkout" contains "$offer" '"status": "offer"'
  local host; host=$(printf '%s' "$offer" | json 'v.hostId ?? v.result?.hostId')
  check "createWorkspace makes it the workspace" contains "$(rpc createWorkspace "{\"hostId\":\"$host\",\"folder\":\"$WS\"}")" '"found"'
}

stage_fetch() {
  ensure_server_user
  make_fixture
  local catalog; catalog=$(printf '[{"id":"fixture","title":"Fixture course","description":"Four tiny lessons.","repo":"file://%s/fixtures/course","ref":"v1"}]' "$E2E_DIR")
  check "the fixture catalog is set" quiet bbx plugin config tutor set courseCatalog "$catalog"
  local before; before=$(rpc getOverview 'null')
  check "the fixture course is offered" contains "$before" '"fixture"'
  check "nothing of it is on the computer yet" as_server test ! -e "$H/server/content/fixture"
  local out; out=$(rpc fetchCourse '{"courseId":"fixture"}')
  printf '%s\n' "$out"
  check "fetchCourse returns the course's first lesson" contains "$out" '"001"'
  check "the starter is seeded into the workspace" test -f "$WS/tetris/.factory/AGENTS.md"
  check "but not its .github" test ! -e "$WS/.github"
  check "the seed is recorded as complete" grep -q '"complete": *true' "$WS/.tutor/seeds/fixture.json"
  check "the course is in the server's content folder" as_server test -f "$H/server/content/fixture/course/course.yaml"
  check "the server's folder holds no copy of the workspace" no_workspace_copy AGENTS.md
  local after; after=$(rpc getOverview 'null')
  check "the outline lists Lesson 0, then the fixture course" course_order "$after" "tutor,fixture"
  info "Stage B (scripted provider) adopts 001–004 and checks the move at 004"
}

stage_scripted() {
  local dir="$E2E_DIR/scripted-provider"
  rm -rf "$dir"; mkdir -p "$dir"
  cp "$REPO"/e2e/scripted-provider/{bridge.ts,host.ts,server.ts,package.json,package-lock.json,tsconfig.json} "$dir/"
  check "the scripted provider's dependencies install" bash -c "cd '$dir' && npm ci --omit=dev >'$E2E_DIR/scripted-npm.log' 2>&1"
  check "it installs in the student server" bbx plugin install "$dir" --yes
  check "coach threads now use it" quiet bbx plugin config tutor set coachProvider scripted
  check "with its own default model" quiet bbx plugin config tutor set coachModel ""
  info "turns are logged in ${H:-the server users home}/server/plugins/scripted-provider/bridge-data/turns.ndjson"
}

stage_lessons() {
  ensure_server_user
  check "the fixture course is in the outline" course_order "$(rpc getOverview 'null')" "tutor,fixture"
  # The coach commits the starter before its first lesson, as the tool's text tells it to.
  git -C "$WS" status --porcelain | grep -q . && commit_all "Add the Fixture course starter"
  local n id thread factory key
  for n in 1 2 3 4; do
    id=$(printf '%03d' "$n")
    thread=$(rpc startNextLesson "{\"courseId\":\"fixture\",\"lessonId\":\"$id\"}" | json 'v.threadId ?? v.result?.threadId ?? ""')
    check "lesson $id: its coach thread starts ($thread)" test -n "$thread"
    bbx thread wait "$thread" --timeout 120s >/dev/null 2>&1
    check "lesson $id: the coach adopts it" tell "$thread" "CALL tutor_adopt_iteration {\"iteration\":\"$id\"}"
    if [ "$n" -lt 4 ]; then factory="$WS/tetris/.factory"; else factory="$WS/factory"; fi
    if [ "$n" = 4 ]; then
      check "lesson 004: the factory moved to factory/" test -f "$WS/factory/AGENTS.md" -a ! -e "$WS/tetris/.factory"
      check "lesson 004: as a git rename" bash -c "git -C '$WS' status --porcelain | grep -q '^R.*tetris/.factory/AGENTS.md -> factory/AGENTS.md'"
    fi
    check "lesson $id: spec/ holds its README and features" test -f "$factory/spec/README.md" -a -d "$factory/spec/features"
    check "lesson $id: ITERATION reads \"$id WIP\"" iteration_is "$factory" "$id WIP"
    check "lesson $id: the factory's tests run on the machine" factory_tests_on_machine "$factory"
    for key in $(example_keys "$id"); do
      check "lesson $id: the coach marks $key passing" tell "$thread" "CALL tutor_mark_example {\"example\":\"$key\",\"status\":\"passing\",\"evidence\":\"npm test passed on the machine\"}"
    done
    check "lesson $id: progress records it" grep -q "status: passing" "$factory/spec/PROGRESS.yaml"
    check "lesson $id: the coach completes it" tell "$thread" "CALL tutor_complete_iteration {\"iteration\":\"$id\",\"summary\":\"Step $n works.\"}"
    check "lesson $id: ITERATION reads \"$id Done\"" iteration_is "$factory" "$id Done"
    commit_all "Lesson $id"
  done
  check "the server's folder holds no copy of the workspace" no_workspace_copy ITERATION
}

stage_lessons_all() {
  stage_fetch
  stage_scripted
  stage_lessons
}

case "${1:-}" in
  build) stage_build ;;
  server) stage_server ;;
  machine) stage_machine ;;
  first-run) stage_first_run ;;
  lessons) stage_lessons_all ;;
  all) stage_build; stage_server; stage_machine; stage_first_run; stage_lessons_all ;;
  *) sed -n '2,33p' "$0"; exit 2 ;;
esac
