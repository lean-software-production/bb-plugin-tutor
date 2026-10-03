# standalone/test/helper.bash — the shared harness every launcher bats file loads.
#
# Hermetic: HOME is a fresh temp dir, the stubs in standalone/test/stubs are
# first on PATH (so no real network, systemctl, launchctl, ...), and
# standalone/tutor is sourced with TUTOR_SOURCE_ONLY=1 so its functions are
# callable directly without running main().

STUBS_DIR="$BATS_TEST_DIRNAME/stubs"
TUTOR_SCRIPT="$BATS_TEST_DIRNAME/../tutor"

setup() {
  tutor_setup
}

tutor_setup() {
  TUTOR_TEST_HOME="$(mktemp -d)"
  export HOME="$TUTOR_TEST_HOME"
  unset TUTOR_HOME
  export TUTOR_HOME="$HOME/.tutor"
  export STUB_LOG="$HOME/.stublog"
  mkdir -p "$STUB_LOG"
  export PATH="$STUBS_DIR:$PATH"

  # tutor_bb (and anything that writes a service pointing at bb-server) uses
  # the absolute path npm would have installed bb-app's bins to; fake that
  # install here so later tasks' functions can be tested without really
  # running npm.
  # A real symlink would make the stub's own "find my lib.sh" relative
  # lookup resolve against the link's directory, not the stub's; copy
  # instead.
  mkdir -p "$TUTOR_HOME/server/npm/node_modules/.bin"
  cp "$STUBS_DIR/bb" "$STUBS_DIR/lib.sh" "$TUTOR_HOME/server/npm/node_modules/.bin/"
  cp "$STUBS_DIR/bb-server" "$TUTOR_HOME/server/npm/node_modules/.bin/"
  chmod +x "$TUTOR_HOME/server/npm/node_modules/.bin/bb" "$TUTOR_HOME/server/npm/node_modules/.bin/bb-server"

  # Each test opts in to a stub's behaviour; start clean. Exported (though
  # unset), so a plain `STUB_UNAME=Darwin` in a test reaches the stubs.
  unset STUB_UNAME STUB_NODE_VERSION STUB_MISSING STUB_SYSTEMD_ENV STUB_PI_SIGNED_IN STUB_PROVIDER_MODELS STUB_SYSTEMCTL_FAIL \
    STUB_SERVER_STOPPED STUB_PLUGIN_ROOT STUB_BB_FAIL STUB_BB_FAIL_STDOUT STUB_LAUNCHCTL_FAIL STUB_SERVER_PID \
    STUB_LISTEN_PID STUB_OTHER_LISTEN STUB_INSTALLER_SIGNAL STUB_BB_CREATE_BLOCKS_FOREVER STUB_MACHINE_LIST_JSON
  export STUB_UNAME STUB_NODE_VERSION STUB_MISSING STUB_SYSTEMD_ENV STUB_PI_SIGNED_IN STUB_PROVIDER_MODELS STUB_SYSTEMCTL_FAIL \
    STUB_SERVER_STOPPED STUB_PLUGIN_ROOT STUB_BB_FAIL STUB_BB_FAIL_STDOUT STUB_LAUNCHCTL_FAIL STUB_SERVER_PID \
    STUB_LISTEN_PID STUB_OTHER_LISTEN STUB_INSTALLER_SIGNAL STUB_BB_CREATE_BLOCKS_FOREVER STUB_MACHINE_LIST_JSON

  # macOS's PlistBuddy lives at /usr/libexec/PlistBuddy; use the stub.
  export PLISTBUDDY=PlistBuddy
  # Don't wait between retries of the model list.
  export TUTOR_MODEL_RETRY_SLEEP=0

  export TUTOR_SOURCE_ONLY=1
  # shellcheck disable=SC1090
  . "$TUTOR_SCRIPT"

  # install.sh puts the release's ready-to-install plugin archive here.
  make_plugin_archive
}

# make_plugin_archive: a small stand-in for the release's
# bb-plugin-tutor-<v>-built.tgz at $TUTOR_HOME/releases/<v>/, laid out as
# the real one is (scripts/check-release-archive.sh): one top-level folder
# bb-plugin-tutor-<v>/ holding package.json and dist/.
make_plugin_archive() {
  local src="$BATS_TEST_TMPDIR/plugin-src" top="bb-plugin-tutor-$TUTOR_VERSION"
  mkdir -p "$src/$top/dist" "$TUTOR_HOME/releases/$TUTOR_VERSION"
  echo '{"name":"bb-plugin-tutor"}' >"$src/$top/package.json"
  echo '// built' >"$src/$top/dist/host.js"
  tar -C "$src" -czf "$TUTOR_HOME/releases/$TUTOR_VERSION/$top-built.tgz" "$top"
}

# launcher <args...>: the launcher as a student runs it — a separate `sh`
# process (dash on Ubuntu CI), so `set -e` and the exit status behave as
# they really do, unlike calling its functions in bats' own shell.
launcher() {
  env -u TUTOR_SOURCE_ONLY sh "$TUTOR_SCRIPT" "$@"
}

teardown() {
  rm -rf "$TUTOR_TEST_HOME"
}

# The bats tests call the launcher's dispatcher as a function, in the sourced
# shell, so `run tutor ...` exercises main() without a subprocess.
tutor() {
  main "$@"
}

# make_stub_machine_unit [port]: the systemd user unit BB's installer writes
# for the machine (amendment 9's name; it mentions the machine directory).
make_stub_machine_unit() {
  local port=${1:-47386}
  mkdir -p "$HOME/.config/systemd/user"
  printf '[Service]\nExecStart=%s/.bb-machines/127.0.0.1-%s/bin/daemon\n' "$HOME" "$port" \
    >"$HOME/.config/systemd/user/bb-host-daemon-127-0-0-1-$port-stubhost.service"
}

# make_stub_machine_plist [port]: the launchd plist BB's installer writes.
make_stub_machine_plist() {
  local port=${1:-47386}
  mkdir -p "$HOME/Library/LaunchAgents"
  printf '<plist><dict><key>Label</key><string>stub.machine</string><string>%s/.bb-machines/127.0.0.1-%s/bin/daemon</string></dict></plist>\n' "$HOME" "$port" \
    >"$HOME/Library/LaunchAgents/stub.machine-$port.plist"
}
