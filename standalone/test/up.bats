load helper

@test "a first tutor up does every step and ends at the browser" {
  run tutor up "$HOME/my-course"
  [ "$status" -eq 0 ]
  [ -d "$HOME/my-course/.git" ]; [ "$(ls -A "$HOME/my-course")" = ".git" ]
  grep -q "project create --name my-course --root $HOME/my-course" "$STUB_LOG/bb"
  grep -q "plugin config tutor set workspaceProject prj_stub" "$STUB_LOG/bb"
  grep -q "http://127.0.0.1:47386" "$STUB_LOG/xdg-open"
  ! printf '%s' "$output" | grep -iqw bb
}

@test "without pi signed in, up still finishes and says to run tutor login" {
  STUB_PI_SIGNED_IN=0 run tutor up "$HOME/my-course"
  [ "$status" -eq 0 ]; [[ "$output" == *"Run \`tutor login\` to connect Tutor to a model provider"* ]]
}

@test "a workspace path with spaces and accents works end to end" {
  run tutor up "$HOME/My Études"
  [ "$status" -eq 0 ]; grep -q -- "--root $HOME/My Études" "$STUB_LOG/bb"
}

@test "a folder that is neither empty nor a Tutor workspace is refused, and left alone" {
  mkdir -p "$HOME/stuff"; echo keep > "$HOME/stuff/notes.txt"
  run tutor up "$HOME/stuff"
  [ "$status" -eq 1 ]; [ "$(ls -A "$HOME/stuff")" = "notes.txt" ]
}

@test "home itself, ~/.tutor and the machine folder are refused" {
  for d in "$HOME" "$HOME/.tutor/x" "$HOME/.bb-machines/x"; do run tutor up "$d"; [ "$status" -eq 1 ]; done
}

# --- beyond the brief ---

@test "refusals say why without naming the machine folder" {
  run tutor up "$HOME/.bb-machines/x"
  [ "$status" -eq 1 ]; ! printf '%s' "$output" | grep -iq bb
  [ ! -e "$HOME/.bb-machines/x" ]
}

@test "a Tutor workspace from an earlier up (.tutor/, or only .git) is accepted" {
  mkdir -p "$HOME/a/.tutor" "$HOME/b/.git"; echo x > "$HOME/a/notes.md"
  run tutor up "$HOME/a"; [ "$status" -eq 0 ]
  run tutor up "$HOME/b"; [ "$status" -eq 0 ]
}

@test "a relative folder is made absolute" {
  cd "$HOME"
  run tutor up my-course
  [ "$status" -eq 0 ]; grep -q -- "--root $HOME/my-course " "$STUB_LOG/bb"
}

@test "--port is recorded before anything talks to the server" {
  run tutor up --port 47999 "$HOME/my-course"
  [ "$status" -eq 0 ]
  [ "$(config_get port)" = 47999 ]
  grep -q "http://127.0.0.1:47999" "$STUB_LOG/xdg-open"
  ! grep -q 47386 "$STUB_LOG/curl"
}

@test "a second up reuses the enrolled machine and the workspace's project" {
  run tutor up "$HOME/my-course"; [ "$status" -eq 0 ]
  run tutor up
  [ "$status" -eq 0 ]
  [ "$(grep -c 'machine create' "$STUB_LOG/bb")" -eq 1 ]
  [ "$(grep -c 'project create' "$STUB_LOG/bb")" -eq 1 ]
  [ "$(grep -c restart "$STUB_LOG/systemctl")" -eq 1 ]
}

@test "up with no folder and none recorded says what to type" {
  run tutor up
  [ "$status" -eq 1 ]; [[ "$output" == *"tutor up ~/my-course"* ]]
}

@test "with pi signed in to the recorded provider, up doesn't ask for a login" {
  config_set provider openrouter
  STUB_PI_SIGNED_IN=openrouter run tutor up "$HOME/my-course"
  [ "$status" -eq 0 ]; [[ "$output" != *"tutor login"* ]]
}

@test "tutor open opens the configured port, with open on macOS" {
  config_set port 47390
  STUB_UNAME=Darwin run tutor open
  [ "$status" -eq 0 ]; grep -q "http://127.0.0.1:47390" "$STUB_LOG/open"
}

@test "an enrolled machine that is stopped is started again, not enrolled again" {
  config_set machine_id stub-machine-id; make_stub_machine_unit
  STUB_MACHINE_STATUS=disconnected TUTOR_MACHINE_TIMEOUT=1 run tutor up "$HOME/my-course"
  grep -q "start bb-host-daemon-127-0-0-1-47386-stubhost.service" "$STUB_LOG/systemctl"
  ! grep -q "machine create" "$STUB_LOG/bb"
}

# --- fix round 1 ---

@test "a .. in a folder that doesn't exist yet can't reach home or ~/.tutor" {
  run tutor up "$HOME/new/.."
  [ "$status" -eq 1 ]; [ ! -e "$HOME/new" ]; [ ! -e "$HOME/.git" ]
  run tutor up "$HOME/nope/../.tutor/x"
  [ "$status" -eq 1 ]; [ ! -e "$HOME/nope" ]; [ ! -e "$HOME/.tutor/x" ]
  ! grep -q "^init" "$STUB_LOG/git" 2>/dev/null
}

@test "a ./ at the front of a relative folder is still fine" {
  cd "$HOME"
  run tutor up ./my-course
  [ "$status" -eq 0 ]; grep -q -- "--root $HOME/my-course " "$STUB_LOG/bb"
}

@test "the root folder is refused with the reason" {
  run workspace_prepare /
  [ "$status" -eq 1 ]; [[ "$output" == *"Tutor keeps its own files there"* ]]
}

@test "a workspace on a newly enrolled machine gets a new project" {
  run tutor up "$HOME/my-course"; [ "$status" -eq 0 ]
  config_set machine_id other-machine-id   # as if up had enrolled again
  TUTOR_WORKSPACE="$HOME/my-course" run project_ensure
  [ "$status" -eq 0 ]
  [ "$(grep -c 'project create' "$STUB_LOG/bb")" -eq 2 ]
  grep -q -- "--machine other-machine-id" "$STUB_LOG/bb"
}

@test "a symlinked spelling of the same workspace doesn't make a second project" {
  run tutor up "$HOME/my-course"; [ "$status" -eq 0 ]
  ln -s "$HOME/my-course" "$HOME/link"
  run tutor up "$HOME/link"; [ "$status" -eq 0 ]
  [ "$(grep -c 'project create' "$STUB_LOG/bb")" -eq 1 ]
}
