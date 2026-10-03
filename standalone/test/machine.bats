load helper

@test "machine create runs in the background, so waiting on it can't deadlock" {
  STUB_BB_CREATE_BLOCKS_UNTIL_INSTALLED=1 run machine_enrol
  [ "$status" -eq 0 ]
  grep -q "machine create --provider manual --key tutor-machine" "$STUB_LOG/bb"
}

@test "the enrolment header never reaches arguments, output or logs" {
  STUB_ENROL_TOKEN=s3cr3t-token run machine_enrol
  ! grep -rq s3cr3t-token "$STUB_LOG" "$TUTOR_HOME/logs" || false ; ! printf '%s' "$output" | grep -q s3cr3t-token || false
  grep -q -- '-H @' "$STUB_LOG/curl"
  [ ! -e "$TUTOR_HOME/enrol.header" ]
  [ ! -e "$TUTOR_HOME/machine-installer.sh" ]   # its body holds the token (amendment 3)
}

@test "the header file is 0600 while it exists" {
  STUB_CURL_HOOK='stat -c %a "$TUTOR_HOME/enrol.header" 2>/dev/null || stat -f %Lp "$TUTOR_HOME/enrol.header"' run machine_enrol
  grep -qx 600 "$STUB_LOG/curl-hook"
}

@test "an expired enrolment starts again from machine create, once" {
  STUB_INSTALLER_EXPIRED_TIMES=1 run machine_enrol
  [ "$status" -eq 0 ]; [ "$(grep -c 'machine create' "$STUB_LOG/bb")" -eq 2 ]
}

@test "two expiries in a row fail with what to do" {
  STUB_INSTALLER_EXPIRED_TIMES=2 run machine_enrol
  [ "$status" -eq 1 ]; [[ "$output" == *"Run tutor up again"* ]]
}

@test "the installer's output goes to install.log, not the screen" {
  run machine_enrol
  grep -q "installer says hello" "$TUTOR_HOME/install.log"; [[ "$output" != *"installer says hello"* ]]
}

@test "machine_wait_connected reads status: connected, not a boolean, and times out on disconnected" {
  config_set machine_id stub-machine-id
  STUB_MACHINE_STATUS=disconnected TUTOR_MACHINE_TIMEOUT=1 run machine_wait_connected
  [ "$status" -eq 1 ]
  STUB_MACHINE_STATUS=connected TUTOR_MACHINE_TIMEOUT=1 run machine_wait_connected
  [ "$status" -eq 0 ]
}

@test "giving up before the enrolment line appears kills the still-running create" {
  STUB_BB_CREATE_BLOCKS_UNTIL_INSTALLED=1 STUB_BB_NO_ENROL_LINE=1 TUTOR_ENROL_TIMEOUT=1 run machine_installer_run
  [ "$status" -eq 1 ]
  [ ! -e "$TUTOR_HOME/enrol.out" ]; [ ! -e "$TUTOR_HOME/enrol.header" ]; [ ! -e "$TUTOR_HOME/machine-installer.sh" ]
  pid=$(cat "$STUB_LOG/bb.pid")
  sleep 0.3
  ! kill -0 "$pid" 2>/dev/null || false
}

@test "an unparseable enrolment line kills the still-running create" {
  STUB_BB_CREATE_BLOCKS_UNTIL_INSTALLED=1 STUB_BB_BAD_ENROL_LINE=1 run machine_installer_run
  [ "$status" -eq 1 ]
  [ ! -e "$TUTOR_HOME/enrol.out" ]; [ ! -e "$TUTOR_HOME/enrol.header" ]; [ ! -e "$TUTOR_HOME/machine-installer.sh" ]
  pid=$(cat "$STUB_LOG/bb.pid")
  sleep 0.3
  ! kill -0 "$pid" 2>/dev/null || false
}

@test "a failed installer download kills the still-running create" {
  STUB_BB_CREATE_BLOCKS_UNTIL_INSTALLED=1 STUB_CURL_FAIL=1 run machine_installer_run
  [ "$status" -eq 1 ]
  [ ! -e "$TUTOR_HOME/enrol.out" ]; [ ! -e "$TUTOR_HOME/enrol.header" ]; [ ! -e "$TUTOR_HOME/machine-installer.sh" ]
  pid=$(cat "$STUB_LOG/bb.pid")
  sleep 0.3
  ! kill -0 "$pid" 2>/dev/null || false
}

@test "machine_enrol's private umask doesn't leak into later steps" {
  # Called directly, not via `run`: `run` forks a subshell, whose umask
  # changes can never be observed by the test shell either way, so it
  # can't tell a leak from a fix. Calling it in-process can.
  umask 022
  machine_enrol
  touch "$TUTOR_TEST_HOME/after-enrol"
  [ "$(stat -c %a "$TUTOR_TEST_HOME/after-enrol" 2>/dev/null || stat -f %Lp "$TUTOR_TEST_HOME/after-enrol")" = 644 ]
}
