#!/usr/bin/env bash
# The standalone Tutor end to end, on a real Linux computer, in stages (Task 21).
# It uses the real defaults a student gets: ~/.local/bin/tutor, ~/.tutor,
# port 47386, ~/.bb-machines/127.0.0.1-47386. Never run it where a real Tutor
# is installed. Its own files go in $E2E_DIR (~/tutor-e2e): the workspace
# "my course" (with a space, on purpose), the fixture course repos, logs and
# results.txt.
#
#   standalone/e2e/e2e.sh build      release assets from this checkout (HEAD for the plugin)
#   standalone/e2e/e2e.sh install    install.sh from those assets
#   standalone/e2e/e2e.sh up         tutor up, then tutor status
#   ~/.local/bin/tutor login --provider <p> --model <m>   (by hand: pi's /login, then /quit)
#   standalone/e2e/e2e.sh login      or: restore a saved sign-in ($E2E_DIR/pi-auth.json) instead
#   standalone/e2e/e2e.sh lesson0    a Lesson 0 coach thread runs Tutor's pi on the machine
#   standalone/e2e/e2e.sh fetch      add the fixture course: starter seeded, lessons listed
#   standalone/e2e/e2e.sh scripted   (Stage B) install the scripted provider; coach threads use it
#   standalone/e2e/e2e.sh lessons    (Stage B) adopt, pass and complete fixture lessons 001-004;
#                                    the factory's tests run on the machine; the move at 004
#   standalone/e2e/e2e.sh restart    tutor stop, tutor up: everything comes back
#   standalone/e2e/e2e.sh uninstall  tutor uninstall --purge: nothing left, workspace untouched
#
# Each stage prints ok / not ok lines (also appended to $E2E_DIR/results.txt)
# and stops at the first failure.
set -uo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
E2E_DIR=${E2E_DIR:-$HOME/tutor-e2e}
TUTOR_HOME=$HOME/.tutor
PORT=47386
TUTOR=$HOME/.local/bin/tutor
WS="$E2E_DIR/my course"
RELEASE="$E2E_DIR/release"
VERSION=$(node -p 'require(process.argv[1]).version' "$REPO/package.json")
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

# bb against the tutor server, never a BB the shell already points at. Inside
# a BB thread every BB_* variable names that BB (BB_CLI re-runs another bb,
# BB_THREAD_ID makes `thread tell` send as a thread the tutor server lacks).
bbx() {
  local unset=() name
  while read -r name; do unset+=(-u "$name"); done < <(compgen -e | grep '^BB_' || true)
  env "${unset[@]}" BB_SERVER_URL="http://127.0.0.1:$PORT" "$TUTOR_HOME/server/npm/node_modules/.bin/bb" "$@"
}
rpc() { # rpc <method> <json input> → stdout JSON
  local input="$E2E_DIR/rpc-input.json"
  printf '%s' "$2" >"$input"
  bbx plugin rpc call tutor "$1" --input-file "$input" --json
}
json() { node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const v=JSON.parse(r);const f=new Function("v","return ("+process.argv[1]+")");const o=f(v);process.stdout.write(typeof o==="string"?o:JSON.stringify(o))})' "$1"; }
config_get() { grep "^$1=" "$TUTOR_HOME/config" 2>/dev/null | tail -n 1 | cut -d= -f2-; }
says_no_bb() { ! grep -iqw bb "$1"; }
own_pi_sum() { if [ -f "$HOME/.pi/agent/auth.json" ]; then cksum <"$HOME/.pi/agent/auth.json"; else echo absent; fi; }
tree_sum() { (cd "$WS" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 cksum | cksum); }
launches() { if [ -f "$E2E_DIR/pi-launches.log" ]; then grep -c '^===' "$E2E_DIR/pi-launches.log" || true; else echo 0; fi; }
contains() { printf '%s' "$1" | grep -q -- "$2"; }          # contains <text> <pattern>
has_line() { printf '%s' "$1" | grep -qx -- "$2"; }         # has_line <text> <exact line>
plugin_running() { bbx plugin list --json | grep -q '"tutor"'; }
thread_on_machine() { bbx thread show "$1" --json | grep -q -- "$2"; }
thread_exists() { bbx thread show "$1" --json >/dev/null 2>&1; }
theme_is() { bbx theme show --json | grep -q "\"themeId\": *\"$1\""; }
plugins_off() { local list; list=$(bbx plugin list --json) || return 1; for id in "$@"; do printf '%s' "$list" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const p=(JSON.parse(r).plugins??[]).find(x=>x.id===process.argv[1]);process.exit(p&&p.enabled===false?0:p?1:0)})' "$id" || return 1; done; }
server_down() { ! curl -fsS "http://127.0.0.1:$PORT/health" -o /dev/null 2>&1; }
# course_order <overview json> <ids>: the outline's courses, in order; on a
# mismatch it says what the outline held (the whole reply is in overview.json).
course_order() {
  printf '%s' "$1" >"$E2E_DIR/overview.json"
  printf '%s' "$1" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let o;try{const v=JSON.parse(r);o=v.result??v}catch{console.error("  not JSON: "+r.slice(0,300));process.exit(1)}const ids=(o.courses??[]).map(c=>c.course.id).join(",");if(ids===process.argv[1])process.exit(0);console.error("  outline: courses ["+ids+"], workspace "+JSON.stringify(o.workspace?.status)+", available ["+(o.available??[]).map(a=>a.id)+"], courseErrors "+JSON.stringify(o.courseErrors));process.exit(1)})' "$2"
}
up() { # tutor up with the recording pi; output kept for the "no bb" check
  install -m 755 "$REPO/standalone/e2e/record-pi" "$E2E_DIR/bin/record-pi"
  TUTOR_PI_COMMAND="$E2E_DIR/bin/record-pi" "$TUTOR" up "$@" >"$E2E_DIR/up.out" 2>&1
}

built_sdk() { tar -xzOf "$RELEASE/bb-plugin-tutor-$VERSION-built.tgz" "bb-plugin-tutor-$VERSION/dist/app.meta.json" | json 'v.sdkVersion'; }

stage_build() {
  rm -rf "$RELEASE"; mkdir -p "$RELEASE"
  # The build is stamped with the bb CLI's own SDK version, so build with the
  # BB the launcher installs, not whichever bb this shell has.
  local bb_version sdk
  bb_version=$(sed -n 's/^BB_VERSION=//p' "$REPO/standalone/tutor")
  sdk=$(node -p 'require(process.argv[1]).devDependencies["@get-bb/plugin-sdk"]' "$REPO/package.json")
  check "bb-app@$bb_version is fetched for the build" \
    npm install --prefix "$E2E_DIR/bb-cli" --no-save --no-audit --no-fund --silent "bb-app@$bb_version"
  export PATH="$E2E_DIR/bb-cli/node_modules/.bin:$PATH"
  check "the plugin release archive builds from HEAD" "$REPO/scripts/release-archive.sh" HEAD "$RELEASE"
  check "it checks out, and the built archive is written" "$REPO/scripts/check-release-archive.sh" "$RELEASE/bb-plugin-tutor-$VERSION.tgz"
  check "the built plugin is stamped with SDK $sdk" test "$(built_sdk)" = "$sdk"
  check "the launcher assets and SHA256SUMS are written" "$REPO/scripts/release-standalone.sh" "$VERSION" "$RELEASE"
}

stage_install() {
  if [ -e "$TUTOR" ] || [ -e "$TUTOR_HOME" ]; then
    echo "A Tutor is already installed ($TUTOR or $TUTOR_HOME). Run the uninstall stage first." >&2; exit 1
  fi
  # A new cycle starts from a fresh workspace: uninstall leaves it alone on purpose.
  rm -rf "$WS" "$E2E_DIR/fixtures"
  TUTOR_RELEASE_DIR="$RELEASE" sh "$RELEASE/install.sh" >"$E2E_DIR/install.out" 2>&1
  check "install.sh succeeds" test $? -eq 0
  check "the launcher is in ~/.local/bin" test -x "$TUTOR"
  check "the built plugin archive is in ~/.tutor/releases/$VERSION" test -f "$TUTOR_HOME/releases/$VERSION/bb-plugin-tutor-$VERSION-built.tgz"
  check "install.sh says what to run next" grep -q "tutor up" "$E2E_DIR/install.out"
  check "install.sh never says bb" says_no_bb "$E2E_DIR/install.out"
}

stage_up() {
  mkdir -p "$E2E_DIR/bin"
  [ -f "$E2E_DIR/own-pi.cksum" ] || own_pi_sum >"$E2E_DIR/own-pi.cksum"
  rm -f "$E2E_DIR/pi-launches.log"
  up "$WS"; local status=$?
  check "tutor up succeeds (output in $E2E_DIR/up.out)" test "$status" -eq 0
  check "tutor up never says bb" says_no_bb "$E2E_DIR/up.out"
  check "the workspace holds only .git" test "$(ls -A "$WS")" = ".git"
  check "the server is healthy" curl -fsS "http://127.0.0.1:$PORT/health" -o /dev/null
  check "the plugin is running in the tutor server" plugin_running
  check "the Sketchbook theme is selected" theme_is plugin:tutor:sketchbook
  check "the plugins a student doesn't need are off" plugins_off connect automations workflows monaco-editor keep-awake scheduled-send provider-acp
  "$TUTOR" status >"$E2E_DIR/status.out" 2>&1
  cat "$E2E_DIR/status.out"
  check "status: server healthy" grep -q "Server: healthy" "$E2E_DIR/status.out"
  check "status: machine connected" grep -q "Machine: connected" "$E2E_DIR/status.out"
  check "status: listening on 127.0.0.1 only" grep -q "Listening: 127.0.0.1 only" "$E2E_DIR/status.out"
  check "status: no other model keys reach Tutor's agents" grep -q "Other model keys: none" "$E2E_DIR/status.out"
  check "tutor status never says bb" says_no_bb "$E2E_DIR/status.out"
  check "the workspace project is set" test -n "$(config_get project_id)"
  info "next: run  $TUTOR login --provider <your provider>  (pi's /login, then /quit), then  $0 lesson0"
}

# A saved sign-in, so later runs need no hand at pi's /login. Copy it once
# after a hand login:  install -m 600 ~/.tutor/pi/auth.json ~/tutor-e2e/pi-auth.json
SAVED_AUTH="$E2E_DIR/pi-auth.json"
config_put() { # what tutor login records: key=value in ~/.tutor/config, mode 0600
  local rest; rest=$(grep -v "^$1=" "$TUTOR_HOME/config" 2>/dev/null || true)
  (umask 077; { [ -z "$rest" ] || printf '%s\n' "$rest"; printf '%s=%s\n' "$1" "$2"; } >"$TUTOR_HOME/config.tmp")
  mv "$TUTOR_HOME/config.tmp" "$TUTOR_HOME/config"
}

stage_login() {
  if [ ! -f "$SAVED_AUTH" ]; then
    echo "No saved sign-in at $SAVED_AUTH: run $TUTOR login --provider <p> by hand, then copy ~/.tutor/pi/auth.json there (mode 600)." >&2; exit 1
  fi
  local provider=${E2E_PROVIDER:-openrouter} model=${E2E_MODEL:-openrouter/z-ai/glm-5.3-flash}
  # Tutor's pi folder is the launcher's (made by tutor up); only auth.json comes from the copy.
  install -m 600 "$SAVED_AUTH" "$TUTOR_HOME/pi/auth.json"
  check "the saved sign-in is Tutor's pi's" test -f "$TUTOR_HOME/pi/auth.json"
  config_put provider "$provider"
  config_put model "$model"
  check "coach threads are pinned to $model" quiet bbx plugin config tutor set coachModel "$model"
  "$TUTOR" status >"$E2E_DIR/status.out" 2>&1
  check "status: Tutor's pi is signed in" grep -q "signed in$" "$E2E_DIR/status.out"
}

stage_lesson0() {
  "$TUTOR" status >"$E2E_DIR/status.out" 2>&1
  check "status: Tutor's pi is signed in" grep -q "signed in$" "$E2E_DIR/status.out"
  local before; before=$(launches)
  local out; out=$(rpc openCoach '{"courseId":"tutor","lessonId":"000"}')
  local thread; thread=$(printf '%s' "$out" | json 'v.threadId ?? v.result?.threadId ?? ""')
  check "openCoach opens a Lesson 0 coach thread ($thread)" test -n "$thread"
  printf '%s\n' "$thread" >"$E2E_DIR/lesson0.thread"
  local mid; mid=$(config_get machine_id)
  check "the coach thread runs on the enrolled machine ($mid)" thread_on_machine "$thread" "$mid"
  # Evidence for the model pin: what Tutor asked for, and what BB recorded for the thread.
  grep -rh "\[tutor\] spawned $thread" "$TUTOR_HOME/server/logs" 2>/dev/null | tail -n 1 | sed 's/^/info — plugin log: /' | tee -a "$RESULTS"
  bbx thread show "$thread" --json >"$E2E_DIR/lesson0-thread.json" 2>&1
  info "BB's record of the thread: $E2E_DIR/lesson0-thread.json ($(grep -o '"model": *"[^"]*"' "$E2E_DIR/lesson0-thread.json" | head -n 1))"
  for _ in $(seq 1 90); do [ "$(launches)" -gt "$before" ] && grep -q -- '--mode rpc --session' "$E2E_DIR/pi-launches.log" && break; sleep 1; done
  # The last launch that is a thread session (BB also probes --version and lists models).
  local last; last=$(awk '/^===/{if (b ~ /--mode rpc --session/) keep=b; b=""} {b=b $0 "\n"} END{if (b ~ /--mode rpc --session/) keep=b; printf "%s", keep}' "$E2E_DIR/pi-launches.log" 2>/dev/null)
  printf '%s\n' "$last"
  check "BB started Tutor's pi for the thread" grep -q -- '--mode rpc --session' "$E2E_DIR/pi-launches.log"
  check "with PI_CODING_AGENT_DIR=~/.tutor/pi" has_line "$last" "PI_CODING_AGENT_DIR=$TUTOR_HOME/pi"
  check "and no provider key in its environment" has_line "$last" "keys: "
  local model; model=$(config_get model)
  check "tutor login chose a model (else run: tutor login --provider <p> --model <m>)" test -n "$model"
  # BB passes the model either whole or split into --provider and --model.
  check "pinned to the model chosen at tutor login ($model)" \
    contains "$last" "--model $model \|--provider ${model%%/*} --model ${model#*/} "
  check "~/.pi is unchanged" test "$(own_pi_sum)" = "$(cat "$E2E_DIR/own-pi.cksum")"
  for _ in $(seq 1 120); do [ -f "$WS/.tutor/progress.yaml" ] && break; sleep 2; done
  if [ -f "$WS/.tutor/progress.yaml" ]; then
    info "the real coach adopted Lesson 0: .tutor/progress.yaml exists"
    check "the workspace holds only .git and .tutor" test "$(ls -A "$WS" | sort | tr '\n' ' ')" = ".git .tutor "
  else
    info "no .tutor/progress.yaml after 4 minutes: the real coach didn't adopt Lesson 0 (Stage B drives this deterministically)"
  fi
  info "the coach thread is open in Tutor: http://127.0.0.1:$PORT"
}

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

stage_fetch() {
  make_fixture
  local catalog; catalog=$(printf '[{"id":"fixture","title":"Fixture course","description":"Four tiny lessons.","repo":"file://%s/fixtures/course","ref":"v1"}]' "$E2E_DIR")
  check "the fixture catalog is set" quiet bbx plugin config tutor set courseCatalog "$catalog"
  local before; before=$(rpc getOverview 'null')
  check "the fixture course is offered" contains "$before" '"fixture"'
  check "nothing of it is on the computer yet" test ! -e "$TUTOR_HOME/server/content/fixture"
  local out; out=$(rpc fetchCourse '{"courseId":"fixture"}')
  printf '%s\n' "$out"
  check "fetchCourse returns the course's first lesson" contains "$out" '"001"'
  check "the starter is seeded into the workspace" test -f "$WS/tetris/.factory/AGENTS.md"
  check "but not its .github" test ! -e "$WS/.github"
  check "the seed is recorded as complete" grep -q '"complete": *true' "$WS/.tutor/seeds/fixture.json"
  check "the course is in the server's content folder" test -f "$TUTOR_HOME/server/content/fixture/course/course.yaml"
  check "the server's folder holds no copy of the workspace" test -z "$(find "$TUTOR_HOME/server" -path "$TUTOR_HOME/server/content" -prune -o -name AGENTS.md -print)"
  local after; after=$(rpc getOverview 'null')
  check "the outline lists Lesson 0, then the fixture course" course_order "$after" "tutor,fixture"
  info "Stage B (scripted provider) adopts 001–004 and checks the move at 004"
}

# --- Stage B: a scripted coach drives the fixture course ---------------------

stage_scripted() {
  local dir="$E2E_DIR/scripted-provider"
  rm -rf "$dir"; mkdir -p "$dir"
  cp "$REPO"/standalone/e2e/scripted-provider/{bridge.ts,host.ts,server.ts,package.json,package-lock.json,tsconfig.json} "$dir/"
  check "the scripted provider's dependencies install" bash -c "cd '$dir' && npm ci --omit=dev >'$E2E_DIR/scripted-npm.log' 2>&1"
  check "it installs in the tutor server" bbx plugin install "$dir" --yes
  check "coach threads now use it" quiet bbx plugin config tutor set coachProvider scripted
  check "with its own default model" quiet bbx plugin config tutor set coachModel ""
  info "turns are logged in $TUTOR_HOME/server/plugins/scripted-provider/bridge-data/turns.ndjson"
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
factory_tests_on_machine() { # runs `npm test` in the factory through a terminal on the enrolled machine
  local factory=$1 mid out
  mid=$(config_get machine_id)
  out=$(bbx terminal create --machine "$mid" --cwd "$factory" --title "factory tests" --json -- sh -c 'npm test >.e2e-test.log 2>&1; echo $? >.e2e-test.status' 2>&1) || { printf '%s\n' "$out" >>"$RESULTS"; return 1; }
  for _ in $(seq 1 60); do [ -f "$factory/.e2e-test.status" ] && break; sleep 1; done
  local status; status=$(cat "$factory/.e2e-test.status" 2>/dev/null)
  rm -f "$factory/.e2e-test.status"
  [ "$status" = 0 ]
}
commit_all() { git -C "$WS" add -A && git -C "$WS" -c user.name=e2e -c user.email=e2e@example.invalid commit -qm "$1"; }

stage_lessons() {
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
  check "the server's folder holds no copy of the workspace" test -z "$(find "$TUTOR_HOME/server" -path "$TUTOR_HOME/server/content" -prune -o -name ITERATION -print)"
}

stage_restart() {
  local thread; thread=$(cat "$E2E_DIR/lesson0.thread" 2>/dev/null || true)
  local progress_before; progress_before=$( [ -f "$WS/.tutor/progress.yaml" ] && cksum <"$WS/.tutor/progress.yaml" || echo absent)
  "$TUTOR" stop >"$E2E_DIR/stop.out" 2>&1
  check "tutor stop succeeds" test $? -eq 0
  check "tutor stop never says bb" says_no_bb "$E2E_DIR/stop.out"
  check "the server is down" server_down
  up; local status=$?
  check "tutor up again succeeds" test "$status" -eq 0
  check "tutor up never says bb" says_no_bb "$E2E_DIR/up.out"
  check "the workspace and project are the same" test "$(config_get workspace)" = "$WS"
  if [ -n "$thread" ]; then
    check "the Lesson 0 coach thread is still there" thread_exists "$thread"
  fi
  local progress_after; progress_after=$( [ -f "$WS/.tutor/progress.yaml" ] && cksum <"$WS/.tutor/progress.yaml" || echo absent)
  check "progress is unchanged" test "$progress_before" = "$progress_after"
}

stage_uninstall() {
  local sum_before; sum_before=$(tree_sum)
  local unit; unit=$(grep -l "127.0.0.1-$PORT" "$HOME"/.config/systemd/user/*.service 2>/dev/null | head -n 1)
  "$TUTOR" uninstall --purge >"$E2E_DIR/uninstall.out" 2>&1
  check "tutor uninstall --purge succeeds" test $? -eq 0
  check "it never says bb" says_no_bb "$E2E_DIR/uninstall.out"
  check "no tutor-server.service" test ! -e "$HOME/.config/systemd/user/tutor-server.service"
  check "no machine unit" test -z "$unit" -o ! -e "${unit:-/nonexistent}"
  check "no ~/.tutor" test ! -e "$TUTOR_HOME"
  check "no ~/.bb-machines/127.0.0.1-$PORT" test ! -e "$HOME/.bb-machines/127.0.0.1-$PORT"
  check "the workspace is as it was" test "$sum_before" = "$(tree_sum)"
  check "~/.pi is unchanged" test "$(own_pi_sum)" = "$(cat "$E2E_DIR/own-pi.cksum" 2>/dev/null || own_pi_sum)"
  if [ -e "$TUTOR" ]; then info "~/.local/bin/tutor is still there (uninstall leaves the launcher): remove it by hand"; fi
  if [ -d "$HOME/.bb/pi-bridge-sessions" ]; then info "~/.bb/pi-bridge-sessions is left (spike note; Task 19 decision)"; fi
}

case "${1:-}" in
  build) stage_build ;;
  install) stage_install ;;
  up) stage_up ;;
  login) stage_login ;;
  lesson0) stage_lesson0 ;;
  fetch) stage_fetch ;;
  scripted) stage_scripted ;;
  lessons) stage_lessons ;;
  restart) stage_restart ;;
  uninstall) stage_uninstall ;;
  *) sed -n '2,21p' "$0"; exit 2 ;;
esac
