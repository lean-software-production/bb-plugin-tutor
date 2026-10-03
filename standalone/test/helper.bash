# standalone/test/helper.bash — the shared harness every launcher bats file loads.
#
# Hermetic: HOME is a fresh temp dir, the stubs in standalone/test/stubs are
# first on PATH (so no real network, systemctl, launchctl, ...), and
# standalone/tutor is sourced with TUTOR_SOURCE_ONLY=1 so its functions are
# callable directly without running main().

STUBS_DIR="$BATS_TEST_DIRNAME/stubs"
TUTOR_SCRIPT="$BATS_TEST_DIRNAME/../tutor"

setup() {
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

  # Each test opts in to a stub's behaviour; start clean.
  unset STUB_UNAME STUB_NODE_VERSION STUB_MISSING

  export TUTOR_SOURCE_ONLY=1
  # shellcheck disable=SC1090
  . "$TUTOR_SCRIPT"
}

teardown() {
  rm -rf "$TUTOR_TEST_HOME"
}

# The bats tests call the launcher's dispatcher as a function, in the sourced
# shell, so `run tutor ...` exercises main() without a subprocess.
tutor() {
  main "$@"
}
