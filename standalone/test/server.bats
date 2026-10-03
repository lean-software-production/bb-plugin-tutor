load helper

@test "the server listens on 127.0.0.1 only, on the chosen port" {
  STUB_UNAME=Linux server_service_write 47390
  grep -q -- '--server-bind-host 127.0.0.1' ~/.config/systemd/user/tutor-server.service
  grep -q -- '--server-port 47390' ~/.config/systemd/user/tutor-server.service
}

@test "a home folder with spaces is quoted in the unit and the plist" {
  export HOME="$BATS_TEST_TMPDIR/Jo Bloggs"; mkdir -p "$HOME"; TUTOR_HOME="$HOME/.tutor"
  STUB_UNAME=Linux server_service_write 47386
  grep -q -- '--data-dir "'"$HOME"'/.tutor/server"' ~/.config/systemd/user/tutor-server.service
  STUB_UNAME=Darwin server_service_write 47386
  grep -q "<string>$HOME/.tutor/server</string>" ~/Library/LaunchAgents/com.leansoftwareproduction.tutor-server.plist
}

@test "a percent in a path is doubled so systemd never expands it as a specifier" {
  export HOME="$BATS_TEST_TMPDIR/100% Done"; mkdir -p "$HOME"; TUTOR_HOME="$HOME/.tutor"
  STUB_UNAME=Linux server_service_write 47386
  # The raw path has one "%"; systemd's unit must see it doubled (%%), never
  # bare, so it is never read as the start of a %-specifier.
  grep -q -- '--data-dir "'"$BATS_TEST_TMPDIR"'/100%% Done/.tutor/server"' ~/.config/systemd/user/tutor-server.service
  ! grep -q -- '100% Done' ~/.config/systemd/user/tutor-server.service || false
}

@test "node under a path with a space gets a correctly quoted Environment=PATH line" {
  node_space_dir="$BATS_TEST_TMPDIR/Program Files/node"
  mkdir -p "$node_space_dir"
  cp "$STUBS_DIR/node" "$node_space_dir/node"
  chmod +x "$node_space_dir/node"
  PATH="$node_space_dir:$PATH" STUB_UNAME=Linux server_service_write 47386
  grep -q -- 'Environment="PATH='"$node_space_dir"':/usr/bin:/bin"' ~/.config/systemd/user/tutor-server.service
}

@test "bb-app is installed once, at the pinned version, with its install scripts running" {
  server_install; server_install
  [ "$(grep -c 'install' "$STUB_LOG/npm")" -eq 1 ]
  grep -q "bb-app@0.45.0" "$STUB_LOG/npm"
  ! grep -q "ignore-scripts" "$STUB_LOG/npm" || false   # the native modules must build
}

@test "the server is configured with 127.0.0.1, never localhost" {
  server_configure 47386
  grep -q "machineServerUrl http://127.0.0.1:47386" "$STUB_LOG/bb"
  ! grep -q localhost "$STUB_LOG/bb" || false
}

@test "the server's data folder is private" {
  server_prepare_dirs
  [ "$(stat -c %a "$TUTOR_HOME/server" 2>/dev/null || stat -f %Lp "$TUTOR_HOME/server")" = 700 ]
}

@test "a server that never gets healthy fails with a pointer to tutor logs, and no bb" {
  STUB_CURL_FAIL=1 TUTOR_HEALTH_TIMEOUT=2 run server_wait_healthy 47386
  [ "$status" -eq 1 ]; [[ "$output" == *"tutor logs"* ]]; ! printf '%s' "$output" | grep -iqw bb || false
}

@test "the plugin comes from the release archive, never the network, and coach threads are pinned to pi" {
  plugin_install
  grep -q "plugin install $TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION --yes" "$STUB_LOG/bb"
  ! grep -q "git:" "$STUB_LOG/bb" || false
  grep -q "plugin config tutor set coachProvider pi" "$STUB_LOG/bb"
}

@test "the release's built archive is unpacked so package.json and dist/ sit directly in releases/<v>/bb-plugin-tutor-<v>/" {
  plugin_dir="$TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION"
  plugin_install
  [ -f "$plugin_dir/package.json" ]
  [ -f "$plugin_dir/dist/host.js" ]
  [ ! -e "$plugin_dir/bb-plugin-tutor-$TUTOR_VERSION" ]
  # Nothing is left behind from the unpacking.
  [ "$(ls -A "$TUTOR_HOME/releases/$TUTOR_VERSION" | sort | tr '\n' ' ')" = "bb-plugin-tutor-$TUTOR_VERSION bb-plugin-tutor-$TUTOR_VERSION-built.tgz " ]
}

@test "the archive is unpacked once, and left alone on a later run" {
  plugin_dir="$TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION"
  plugin_install
  echo changed >"$plugin_dir/package.json"
  plugin_install
  grep -q changed "$plugin_dir/package.json"
}

@test "an unpacking that was interrupted is done again, not skipped" {
  release_dir="$TUTOR_HOME/releases/$TUTOR_VERSION"
  # A half-written unpack folder from a run that was killed part way.
  mkdir -p "$release_dir/.unpacking/bb-plugin-tutor-$TUTOR_VERSION"
  plugin_install
  [ -f "$release_dir/bb-plugin-tutor-$TUTOR_VERSION/package.json" ]
  [ ! -e "$release_dir/.unpacking" ]
}

@test "a plugin already installed from the same folder isn't installed again" {
  plugin_dir="$TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION"
  STUB_PLUGIN_ROOT="$plugin_dir" plugin_install
  ! grep -q "plugin install" "$STUB_LOG/bb" || false
  grep -q "plugin config tutor set coachProvider pi" "$STUB_LOG/bb"
}

@test "a plugin installed from another folder is installed again from this release's" {
  STUB_PLUGIN_ROOT="$HOME/elsewhere" plugin_install
  grep -q "plugin install $TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION --yes" "$STUB_LOG/bb"
}

@test "a failed plugin install says what to do, without naming bb" {
  STUB_BB_FAIL="plugin install" run plugin_install
  [ "$status" -eq 1 ]; [[ "$output" == *"Run \`tutor logs\`"* ]]
  ! printf '%s' "$output" | grep -iqw bb || false
}

@test "a missing or broken plugin archive says what to do, without naming bb or the file" {
  rm "$TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION-built.tgz"
  run plugin_install
  [ "$status" -eq 1 ]; ! printf '%s' "$output" | grep -iqw bb || false; ! grep -q "plugin install" "$STUB_LOG/bb" || false
  printf 'not a tarball' >"$TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION-built.tgz"
  run plugin_install
  [ "$status" -eq 1 ]; [[ "$output" == *"Run \`tutor logs\`"* ]]
  ! printf '%s' "$output" | grep -iqw bb || false
  [ ! -e "$TUTOR_HOME/releases/$TUTOR_VERSION/bb-plugin-tutor-$TUTOR_VERSION" ]
}

# --- final review: C2, I4, I6 ---

# server_up <port>: what tutor up does for the server, in order.
server_up() {
  server_install && server_service_write "$1" && server_start
}

@test "on macOS a second start finds the server already loaded and doesn't fail" {
  export STUB_UNAME=Darwin
  server_up 47386
  grep -q "bootstrap gui/$(id -u) $HOME/Library/LaunchAgents/com.leansoftwareproduction.tutor-server.plist" "$STUB_LOG/launchctl"
  : >"$STUB_LOG/launchctl"
  run server_up 47386
  [ "$status" -eq 0 ]
  ! grep -q "bootstrap\|bootout" "$STUB_LOG/launchctl" || false
}

@test "on macOS a changed plist reloads the loaded server" {
  export STUB_UNAME=Darwin
  server_up 47386
  : >"$STUB_LOG/launchctl"
  run server_up 47999
  [ "$status" -eq 0 ]
  grep -q "^bootout gui/" "$STUB_LOG/launchctl"
  grep -q "^bootstrap gui/" "$STUB_LOG/launchctl"
}

@test "on macOS a bootstrap that keeps failing says what to do, without naming bb" {
  export STUB_UNAME=Darwin
  STUB_LAUNCHCTL_FAIL=bootstrap TUTOR_LAUNCHD_TRIES=1 run server_up 47386
  [ "$status" -eq 1 ]; [[ "$output" == *"Run \`tutor logs\`"* ]]
  ! printf '%s' "$output" | grep -iqw bb || false
}

@test "an unchanged server is started, not restarted" {
  server_up 47386
  : >"$STUB_LOG/systemctl"
  server_up 47386
  grep -q "^--user start tutor-server.service" "$STUB_LOG/systemctl"
  ! grep -q "restart tutor-server" "$STUB_LOG/systemctl" || false
}

@test "a new port restarts the running server" {
  server_up 47386
  : >"$STUB_LOG/systemctl"
  server_up 47999
  grep -q "^--user daemon-reload" "$STUB_LOG/systemctl"
  grep -q "^--user restart tutor-server.service" "$STUB_LOG/systemctl"
}

@test "a new server version restarts the running server" {
  server_up 47386
  : >"$STUB_LOG/systemctl"
  BB_VERSION=9.9.9 server_up 47386
  grep -q "bb-app@9.9.9" "$STUB_LOG/npm"
  grep -q "^--user restart tutor-server.service" "$STUB_LOG/systemctl"
}

@test "a different node restarts the running server" {
  server_up 47386
  : >"$STUB_LOG/systemctl"
  other="$BATS_TEST_TMPDIR/other-node"; mkdir -p "$other"; cp "$STUBS_DIR/node" "$other/node"
  PATH="$other:$PATH" server_up 47386
  grep -q "^--user restart tutor-server.service" "$STUB_LOG/systemctl"
}

@test "a restart that failed is tried again on the next run" {
  server_up 47386
  STUB_SYSTEMCTL_FAIL=restart run server_up 47999
  [ "$status" -eq 1 ]
  : >"$STUB_LOG/systemctl"
  server_up 47999
  grep -q "^--user restart tutor-server.service" "$STUB_LOG/systemctl"
}

@test "each systemctl failure starting the server says what to do, without naming bb" {
  for verb in daemon-reload enable restart; do
    rm -f "$TUTOR_HOME/server/.restart-pending"; server_service_write 4000$RANDOM
    STUB_SYSTEMCTL_FAIL=$verb run server_start
    [ "$status" -eq 1 ]; [[ "$output" == *"Run \`tutor logs\`"* ]]
    ! printf '%s' "$output" | grep -iqw bb || false
  done
}

@test "a server that can't be configured says what to do, without naming bb" {
  STUB_BB_FAIL="settings general" run server_configure 47386
  [ "$status" -eq 1 ]; [[ "$output" == *"Run \`tutor logs\`"* ]]
  ! printf '%s' "$output" | grep -iqw bb || false
}
