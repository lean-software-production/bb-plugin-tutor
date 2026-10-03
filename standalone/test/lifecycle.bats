load helper

setup_done() { tutor up "$HOME/my-course" >/dev/null; : >"$STUB_LOG/bb"; : >"$STUB_LOG/npm"; : >"$STUB_LOG/systemctl"; }

@test "a second tutor up skips what's done: no reinstall, no new enrolment, no new project" {
  setup_done; run tutor up
  [ "$status" -eq 0 ]
  ! grep -q install "$STUB_LOG/npm" || false; ! grep -q "machine create" "$STUB_LOG/bb" || false; ! grep -q "project create" "$STUB_LOG/bb" || false
}

@test "tutor up restarts a stopped server and repairs Tutor's pi settings after an update rewrote the machine unit" {
  setup_done
  # The server is down: /health fails until something starts it.
  export STUB_SERVER_STOPPED=1 TUTOR_HEALTH_TIMEOUT=2; rm -f "$STUB_LOG/server-started"
  # An update rewrote the machine's unit and dropped Tutor's drop-in.
  unit=$(ls ~/.config/systemd/user/bb-host-daemon-127-0-0-1-47386-*.service)
  printf '[Service]\nExecStart=%s/.bb-machines/127.0.0.1-47386/bin/daemon --updated\n' "$HOME" >"$unit"
  rm "$unit.d/tutor.conf"
  run tutor up
  [ "$status" -eq 0 ]
  grep -Eq "^--user (start|restart) tutor-server.service" "$STUB_LOG/systemctl"
  grep -q "PI_CODING_AGENT_DIR=$TUTOR_HOME/pi" "$unit.d/tutor.conf"
  grep -q "restart $(basename "$unit")" "$STUB_LOG/systemctl"
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

# --- final review: I5 ---

@test "logs includes the launcher's own log, where every step's details go" {
  mkdir -p "$TUTOR_HOME/logs"; echo "launcher detail 123" >>"$TUTOR_HOME/logs/launcher.log"
  run tutor logs
  [ "$status" -eq 0 ]; [[ "$output" == *"launcher detail 123"* ]]
}

@test "a failing bb command's stdout (its JSON error) is kept in the log" {
  STUB_BB_FAIL="machine list" STUB_BB_FAIL_STDOUT='{"ok":false,"error":{"code":"unreachable-77"}}' run tutor_bb_json machine list --json
  [ "$status" -eq 1 ]
  grep -q "unreachable-77" "$TUTOR_HOME/logs/launcher.log"
}

# --- final review: I9 ---

@test "on macOS the server's own sockets are checked too" {
  export STUB_UNAME=Darwin
  server_service_write 47386
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.leansoftwareproduction.tutor-server.plist"
  STUB_SERVER_PID=5151 STUB_LISTEN_PID=5151 STUB_LISTEN="0.0.0.0:47386" run listening_check
  [[ "$output" == *"also on 0.0.0.0:47386"* ]]
}

@test "another process whose pid starts with the server's isn't counted as the server" {
  STUB_UNAME=Linux; make_stub_machine_unit
  STUB_MAIN_PID=4242 STUB_OTHER_LISTEN="42421 0.0.0.0:9999" run listening_check
  [ "$output" = "Listening: 127.0.0.1 only" ]
}

# --- final review: M2 ---

@test "uninstall --purge refuses a TUTOR_HOME that is home itself" {
  setup_done; echo keep >"$HOME/mine.txt"
  TUTOR_HOME="$HOME" run tutor uninstall --purge
  [ "$status" -eq 1 ]; [ -f "$HOME/mine.txt" ]; [ -d "$HOME/my-course" ]
  ! printf '%s' "$output" | grep -iqw bb || false
}

@test "uninstall --purge refuses a TUTOR_HOME with no config in it" {
  mkdir -p "$HOME/stuff"; echo keep >"$HOME/stuff/a.txt"
  TUTOR_HOME="$HOME/stuff" run tutor uninstall --purge
  [ "$status" -eq 1 ]; [ -f "$HOME/stuff/a.txt" ]
}

@test "uninstall --purge refuses / (checked without deleting anything)" {
  TUTOR_HOME=/ run purge_check
  [ "$status" -eq 1 ]
  TUTOR_HOME="$HOME/" run purge_check
  [ "$status" -eq 1 ]
  setup_done
  run purge_check
  [ "$status" -eq 0 ]
}

@test "bb never inherits a BB terminal's variables: only BB_SERVER_URL, the tutor server's" {
  BB_CLI=/elsewhere/bb BB_THREAD_ID=thr_x BB_SERVER_URL=http://127.0.0.1:1 tutor_bb plugin list --json
  BB_CLI=/elsewhere/bb BB_THREAD_ID=thr_x tutor_bb_json plugin list --json >/dev/null
  [ "$(sort -u "$STUB_LOG/bb-env")" = "BB_SERVER_URL " ]
}
