load helper

@test "machine create runs in the background, so waiting on it can't deadlock" {
  STUB_BB_CREATE_BLOCKS_UNTIL_INSTALLED=1 run machine_enrol
  [ "$status" -eq 0 ]
  grep -q "machine create --provider manual --key tutor-machine" "$STUB_LOG/bb"
}

@test "the enrolment header never reaches arguments, output or logs" {
  STUB_ENROL_TOKEN=s3cr3t-token run machine_enrol
  ! grep -rq s3cr3t-token "$STUB_LOG" "$TUTOR_HOME/logs" ; ! printf '%s' "$output" | grep -q s3cr3t-token
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
