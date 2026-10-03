# standalone/test/install.bats — install.sh, run as a real subprocess
# (never sourced). Most tests use TUTOR_RELEASE_DIR (test/e2e only), which
# makes it copy its three assets — tutor, the plugin archive and
# SHA256SUMS — from a local fixture directory instead of downloading them,
# so no network or curl stub is needed. The real download branch (no
# TUTOR_RELEASE_DIR) is covered separately below, with a dedicated curl stub
# that records its own argv and serves the same fixture assets.
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

# make_curl_stub: a curl on PATH (ahead of the real one) at $CURL_BIN/curl
# that appends its full argv to $CURL_LOG, then — unless STUB_CURL_FAIL=1,
# which makes it fail like a real HTTP error would — copies
# $CURL_FIXTURES/<basename of the requested URL> to the file named by its
# own -o argument, exactly as a real download would land it.
make_curl_stub() {
  CURL_BIN="$BATS_TEST_TMPDIR/curlbin"
  CURL_LOG="$BATS_TEST_TMPDIR/curl.log"
  mkdir -p "$CURL_BIN"
  : >"$CURL_LOG"
  cat >"$CURL_BIN/curl" <<'STUBCURL'
#!/bin/sh
printf '%s\n' "$*" >>"$CURL_LOG"
[ "${STUB_CURL_FAIL:-0}" = 1 ] && exit 22
out="" url=""
prev=""
for arg in "$@"; do
  [ "$prev" = "-o" ] && out="$arg"
  case "$arg" in
    https://*) url="$arg" ;;
  esac
  prev="$arg"
done
cp "$CURL_FIXTURES/$(basename "$url")" "$out"
STUBCURL
  chmod +x "$CURL_BIN/curl"
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

@test "without TUTOR_RELEASE_DIR, install.sh downloads tutor, the archive and SHA256SUMS from the exact release URL, with -fsSL" {
  make_release_fixture
  make_curl_stub
  export CURL_FIXTURES="$REL" CURL_LOG PATH="$CURL_BIN:$PATH"
  run sh "$INSTALL_SCRIPT"
  [ "$status" -eq 0 ]
  base="https://github.com/lean-software-production/bb-plugin-tutor/releases/download/v0.0.0-dev"
  grep -qF -- "-fsSL $base/tutor -o" "$CURL_LOG"
  grep -qF -- "-fsSL $base/bb-plugin-tutor-0.0.0-dev.tgz -o" "$CURL_LOG"
  grep -qF -- "-fsSL $base/SHA256SUMS -o" "$CURL_LOG"
  # Exactly those three requests: install.sh never downloads itself.
  [ "$(wc -l <"$CURL_LOG")" -eq 3 ]
  ! grep -q install.sh "$CURL_LOG"
}

@test "a failed download installs nothing, exits non-zero, and says nothing about bb" {
  make_release_fixture
  make_curl_stub
  export CURL_FIXTURES="$REL" CURL_LOG STUB_CURL_FAIL=1 PATH="$CURL_BIN:$PATH"
  run sh "$INSTALL_SCRIPT"
  [ "$status" -ne 0 ]
  [ ! -e "$HOME/.local/bin/tutor" ]
  [ ! -d "$HOME/.tutor/releases" ]
  ! printf '%s' "$output" | grep -iqw bb
}
