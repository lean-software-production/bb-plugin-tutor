# standalone/test/subprocess.bats — `tutor up` (and friends) run the way a
# student runs them: `sh standalone/tutor ...` in its own process, with the
# stubs on PATH. The other files call the launcher's functions inside bats'
# own bash, where `set -e` is hidden by `run`; here a step that fails
# without a message ends the run with that status, as it really would. On
# Ubuntu CI `sh` is dash.
load helper

setup() {
  tutor_setup
  export TUTOR_HEALTH_TIMEOUT=2 TUTOR_MACHINE_TIMEOUT=2 TUTOR_ENROL_TIMEOUT=2 TUTOR_LAUNCHD_TRIES=1
}

@test "a first tutor up, as its own process, finishes at the browser" {
  run launcher up "$HOME/my-course"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Tutor is open at http://127.0.0.1:47386"* ]]
  ! printf '%s' "$output" | grep -iqw bb || false
}

@test "a second tutor up, as its own process, finishes too" {
  run launcher up "$HOME/my-course"; [ "$status" -eq 0 ]
  run launcher up
  [ "$status" -eq 0 ]
  [[ "$output" == *"Tutor is open at"* ]]
}

@test "tutor up after tutor stop, as their own processes, starts everything again" {
  run launcher up "$HOME/my-course"; [ "$status" -eq 0 ]
  run launcher stop; [ "$status" -eq 0 ]
  : >"$STUB_LOG/systemctl"
  run launcher up
  [ "$status" -eq 0 ]
  grep -q "start tutor-server.service" "$STUB_LOG/systemctl"
}

@test "tutor up --port on a re-run restarts the server on the new port" {
  run launcher up "$HOME/my-course"; [ "$status" -eq 0 ]
  run launcher up --port 47999
  [ "$status" -eq 0 ]
  grep -q -- "--server-port 47999" "$HOME/.config/systemd/user/tutor-server.service"
  [ "$(grep -c "restart tutor-server.service" "$STUB_LOG/systemctl")" -eq 2 ]
}

@test "on macOS a second tutor up, with the server already loaded, finishes" {
  export STUB_UNAME=Darwin
  run launcher up "$HOME/my-course"; [ "$status" -eq 0 ]
  run launcher up
  [ "$status" -eq 0 ]
  [[ "$output" == *"Tutor is open at"* ]]
  grep -q "http://127.0.0.1:47386" "$STUB_LOG/open"
}

@test "a systemctl enable that fails ends tutor up with what to do, not silently" {
  STUB_SYSTEMCTL_FAIL=enable run launcher up "$HOME/my-course"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Run \`tutor logs\`"* ]]
  ! printf '%s' "$output" | grep -iqw bb || false
}

@test "with no user service manager, tutor up says so instead of exiting silently" {
  STUB_SYSTEMCTL_FAIL=daemon-reload run launcher up "$HOME/my-course"
  [ "$status" -eq 1 ]
  [[ "$output" == *"systemctl --user"* && "$output" == *"Run \`tutor logs\`"* ]]
}

@test "a failed plugin install ends tutor up with what to do" {
  STUB_BB_FAIL="plugin install" run launcher up "$HOME/my-course"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Run \`tutor logs\`"* ]]
  ! printf '%s' "$output" | grep -iqw bb || false
}
