load helper

setup_done() { tutor up "$HOME/my-course" >/dev/null; : >"$STUB_LOG/bb"; : >"$STUB_LOG/npm"; : >"$STUB_LOG/systemctl"; }

@test "a second tutor up skips what's done: no reinstall, no new enrolment, no new project" {
  setup_done; run tutor up
  [ "$status" -eq 0 ]
  ! grep -q install "$STUB_LOG/npm" || false; ! grep -q "machine create" "$STUB_LOG/bb" || false; ! grep -q "project create" "$STUB_LOG/bb" || false
}

@test "tutor up restarts a stopped server and repairs Tutor's pi settings after an update rewrote the machine unit" {
  setup_done; rm ~/.config/systemd/user/*.service.d/tutor.conf; STUB_SERVER_STOPPED=1
  run tutor up
  [ "$status" -eq 0 ]; ls ~/.config/systemd/user/*.service.d/tutor.conf; grep -q "start tutor-server\|enable --now tutor-server" "$STUB_LOG/systemctl"
}

@test "status reports each part, and flags a listener off loopback" {
  setup_done; STUB_LISTEN="0.0.0.0:47386" run tutor status
  [[ "$output" == *"Server: healthy"* && "$output" == *"Machine: connected"* && "$output" == *"also on 0.0.0.0:47386"* ]]
  ! printf '%s' "$output" | grep -iqw bb || false
}

@test "status names provider keys that still reach Tutor's agents, never their values" {
  setup_done; STUB_DAEMON_ENV=$'PATH=/usr/bin\nOPENCODE_API_KEY=s3cret' run tutor status
  [[ "$output" == *"Other model keys: OPENCODE_API_KEY"* ]]
  ! printf '%s' "$output" | grep -q s3cret || false
}

@test "stop keeps everything; up brings back the same workspace and project" {
  setup_done; tutor stop >/dev/null; run tutor up
  [ "$(config_get project_id)" = prj_stub ]; [ -d "$HOME/my-course/.git" ]
}

@test "uninstall --purge removes Tutor's files, the services and the machine folder, and leaves the workspace as it was" {
  setup_done; echo work > "$HOME/my-course/mine.txt"; before=$(cd "$HOME/my-course" && find . | sort | cksum)
  run tutor uninstall --purge
  [ ! -e "$TUTOR_HOME" ]; [ ! -e "$HOME/.bb-machines/127.0.0.1-47386" ]
  [ ! -e ~/.config/systemd/user/tutor-server.service ]
  ! ls ~/.config/systemd/user/bb-host-daemon-127-0-0-1-47386-*.service 2>/dev/null || false
  grep -q "machine remove" "$STUB_LOG/bb"
  [ "$(cd "$HOME/my-course" && find . | sort | cksum)" = "$before" ]
}

@test "logs is the one command that may say bb" {
  setup_done; run tutor logs; [ "$status" -eq 0 ]
}
