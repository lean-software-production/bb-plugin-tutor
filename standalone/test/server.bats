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
  ! grep -q -- '100% Done' ~/.config/systemd/user/tutor-server.service
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
  grep -q "bb-app@0.44.0" "$STUB_LOG/npm"
  ! grep -q "ignore-scripts" "$STUB_LOG/npm"   # the native modules must build
}

@test "the server is configured with 127.0.0.1, never localhost" {
  server_configure 47386
  grep -q "machineServerUrl http://127.0.0.1:47386" "$STUB_LOG/bb"
  ! grep -q localhost "$STUB_LOG/bb"
}

@test "the server's data folder is private" {
  server_prepare_dirs
  [ "$(stat -c %a "$TUTOR_HOME/server" 2>/dev/null || stat -f %Lp "$TUTOR_HOME/server")" = 700 ]
}

@test "a server that never gets healthy fails with a pointer to tutor logs, and no bb" {
  STUB_CURL_FAIL=1 TUTOR_HEALTH_TIMEOUT=2 run server_wait_healthy 47386
  [ "$status" -eq 1 ]; [[ "$output" == *"tutor logs"* ]]; ! printf '%s' "$output" | grep -iqw bb
}

@test "the plugin comes from the release archive, never the network, and coach threads are pinned to pi" {
  plugin_install
  grep -q "plugin install $TUTOR_HOME/releases/" "$STUB_LOG/bb"
  ! grep -q "git:" "$STUB_LOG/bb"
  grep -q "plugin config tutor set coachProvider pi" "$STUB_LOG/bb"
}

@test "a real plugin archive at releases/<version>/ is extracted once, and left alone on a later run" {
  release_dir="$TUTOR_HOME/releases/$TUTOR_VERSION"
  plugin_dir="$release_dir/bb-plugin-tutor-$TUTOR_VERSION"
  pkg_src="$BATS_TEST_TMPDIR/pkg-src"
  mkdir -p "$release_dir" "$pkg_src"
  echo '{"name":"bb-plugin-tutor"}' >"$pkg_src/package.json"
  tar -C "$pkg_src" -czf "$release_dir/bb-plugin-tutor-$TUTOR_VERSION.tgz" package.json

  plugin_install
  [ -f "$plugin_dir/package.json" ]
  grep -q "plugin install $plugin_dir" "$STUB_LOG/bb"

  # A later run must not re-extract: a change to the extracted file survives.
  echo changed >"$plugin_dir/package.json"
  plugin_install
  grep -q changed "$plugin_dir/package.json"
}
