#!/bin/sh
# standalone/install.sh — install Tutor's launcher and this release's pinned
# plugin archive.
#
#   curl -fsSL https://github.com/lean-software-production/bb-plugin-tutor/releases/latest/download/install.sh | sh
#
# Downloads tutor, the plugin archive and SHA256SUMS for this script's own
# version from the matching GitHub Release, verifies them with sha256sum (or
# shasum -a 256 on macOS), and only then installs:
#   - tutor to ~/.local/bin/tutor, mode 0755
#   - the plugin archive to ~/.tutor/releases/<version>/
#
# On a checksum mismatch it installs nothing. It never runs `tutor up`
# itself, and nothing it prints says "bb".
#
# TUTOR_RELEASE_DIR (test/e2e only): copy tutor, the plugin archive and
# SHA256SUMS from this local directory instead of downloading them.
set -eu

TUTOR_NAME=tutor
# shellcheck disable=SC2034 # stamped at release (scripts/release-standalone.sh); exact line match
TUTOR_VERSION=0.0.0-dev
REPO=lean-software-production/bb-plugin-tutor
ARCHIVE_NAME="bb-plugin-tutor-$TUTOR_VERSION.tgz"
TUTOR_HOME="${TUTOR_HOME:-$HOME/.tutor}"

say() {
  printf '%s\n' "$*"
}

fail() {
  say "$@" >&2
  exit 1
}

# checksum_tool: "sha256sum" or "shasum -a 256", whichever is on PATH.
checksum_tool() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf 'sha256sum'
  elif command -v shasum >/dev/null 2>&1; then
    printf 'shasum -a 256'
  fi
}

# fetch <asset> <dest>: TUTOR_RELEASE_DIR copies it locally; otherwise it is
# downloaded from this version's GitHub Release.
fetch() {
  asset=$1
  dest=$2
  if [ -n "${TUTOR_RELEASE_DIR:-}" ]; then
    cp "$TUTOR_RELEASE_DIR/$asset" "$dest" || fail "Tutor couldn't find $asset in $TUTOR_RELEASE_DIR."
  else
    url="https://github.com/$REPO/releases/download/v$TUTOR_VERSION/$asset"
    curl -fsSL "$url" -o "$dest" || fail "Tutor couldn't download $asset."
  fi
}

main() {
  tool=$(checksum_tool)
  [ -n "$tool" ] || fail "Tutor needs sha256sum or shasum to verify its download."

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/tutor-install.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT

  fetch tutor "$tmp/tutor"
  fetch "$ARCHIVE_NAME" "$tmp/$ARCHIVE_NAME"
  fetch SHA256SUMS "$tmp/SHA256SUMS"

  # Only tutor and the archive are verified here: this script is already
  # running, so it never checks its own bytes.
  awk -v a=tutor -v b="$ARCHIVE_NAME" '$2==a || $2==b' "$tmp/SHA256SUMS" >"$tmp/SHA256SUMS.subset"
  [ "$(wc -l <"$tmp/SHA256SUMS.subset")" -eq 2 ] \
    || fail "Tutor's download is incomplete. Installed nothing."

  # shellcheck disable=SC2086 # $tool intentionally unquoted: splits "shasum -a 256" into its words
  if ! (cd "$tmp" && $tool -c SHA256SUMS.subset >/dev/null); then
    fail "Tutor's download didn't verify. Installed nothing."
  fi

  mkdir -p "$HOME/.local/bin"
  chmod 755 "$tmp/tutor"
  mv "$tmp/tutor" "$HOME/.local/bin/tutor"

  release_dir="$TUTOR_HOME/releases/$TUTOR_VERSION"
  mkdir -p "$release_dir"
  mv "$tmp/$ARCHIVE_NAME" "$release_dir/$ARCHIVE_NAME"

  case ":${PATH:-}:" in
    *":$HOME/.local/bin:"*) ;;
    *)
      say "Add ~/.local/bin to your PATH: add this line to your shell's profile, then open a new terminal:"
      say "  export PATH=\"\$HOME/.local/bin:\$PATH\""
      ;;
  esac

  say "Now run: $TUTOR_NAME up ~/my-course"
}

main "$@"
