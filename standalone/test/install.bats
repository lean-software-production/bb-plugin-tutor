# standalone/test/install.bats — install.sh, run as a real subprocess
# (never sourced). TUTOR_RELEASE_DIR (test/e2e only) makes it copy its three
# assets — tutor, the plugin archive and SHA256SUMS — from a local fixture
# directory instead of downloading them, so no network or curl stub is
# needed here.
load helper

INSTALL_SCRIPT="$BATS_TEST_DIRNAME/../install.sh"

# make_release_fixture: a fixture release directory, matching install.sh's
# own unstamped TUTOR_VERSION (0.0.0-dev), with a real tutor script, a real
# small archive and a correct SHA256SUMS. Sets $REL.
make_release_fixture() {
  REL="$BATS_TEST_TMPDIR/release"
  mkdir -p "$REL"
  printf '#!/bin/sh\necho "stub tutor"\n' >"$REL/tutor"
  chmod +x "$REL/tutor"
  printf 'fixture plugin archive bytes\n' >"$REL/bb-plugin-tutor-0.0.0-dev.tgz"
  (cd "$REL" && sha256sum tutor bb-plugin-tutor-0.0.0-dev.tgz install.sh >SHA256SUMS 2>/dev/null) || true
  # install.sh isn't a fixture file (install.sh never verifies itself); drop
  # any failed line sha256sum may have printed for the missing file.
  grep -v ' install.sh$' "$REL/SHA256SUMS" >"$REL/SHA256SUMS.tmp" || true
  mv "$REL/SHA256SUMS.tmp" "$REL/SHA256SUMS"
}

@test "install.sh refuses a download whose checksum doesn't match, and installs nothing" {
  make_release_fixture
  printf 'corrupted\n' >>"$REL/tutor"
  TUTOR_RELEASE_DIR="$REL" run sh "$INSTALL_SCRIPT"
  [ "$status" -eq 1 ]
  [ ! -e "$HOME/.local/bin/tutor" ]
}

@test "install.sh installs the launcher and the plugin archive for its version, and says what to run" {
  make_release_fixture
  TUTOR_RELEASE_DIR="$REL" run sh "$INSTALL_SCRIPT"
  [ "$status" -eq 0 ]
  [ -x "$HOME/.local/bin/tutor" ]
  ls "$HOME"/.tutor/releases/*/bb-plugin-tutor-*.tgz
  [[ "$output" == *"tutor up ~/my-course"* ]]
  ! printf '%s' "$output" | grep -iqw bb
}

@test "install.sh says how to add ~/.local/bin to PATH when it isn't there" {
  make_release_fixture
  TUTOR_RELEASE_DIR="$REL" PATH="/usr/bin:/bin" run sh "$INSTALL_SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *'PATH'*'.local/bin'* ]]
}

@test "install.sh says nothing about PATH when ~/.local/bin is already on it" {
  make_release_fixture
  mkdir -p "$HOME/.local/bin"
  TUTOR_RELEASE_DIR="$REL" PATH="$HOME/.local/bin:$PATH" run sh "$INSTALL_SCRIPT"
  [ "$status" -eq 0 ]
  ! [[ "$output" == *'Add ~/.local/bin'* ]]
}
