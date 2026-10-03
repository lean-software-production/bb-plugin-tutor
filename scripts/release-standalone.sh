#!/usr/bin/env bash
# Build the launcher's release assets for a version, exactly as the release
# workflow does:
#
#   scripts/release-standalone.sh <version> <out-dir>
#
# writes <out-dir>/tutor and <out-dir>/install.sh — copies of
# standalone/tutor and standalone/install.sh with their placeholder
# TUTOR_VERSION=0.0.0-dev line replaced, exactly, by TUTOR_VERSION=<version>
# — both mode 0755, and <out-dir>/SHA256SUMS covering tutor, install.sh,
# bb-plugin-tutor-<version>.tgz and bb-plugin-tutor-<version>-built.tgz
# (which scripts/release-archive.sh and scripts/check-release-archive.sh must
# have already written into <out-dir>). Prints the SHA256SUMS path.
set -euo pipefail

version="${1:-}" out="${2:-}"
[ -n "$version" ] && [ -n "$out" ] || { echo "usage: $0 <version> <out-dir>" >&2; exit 2; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: version '$version' is not x.y.z" >&2; exit 1; }

mkdir -p "$out"

placeholder="TUTOR_VERSION=0.0.0-dev"
stamped="TUTOR_VERSION=$version"

# stamp_version <src> <dest>: <dest> is <src> with exactly one line
# replaced, verbatim, by the stamped version; fails if that line isn't
# present exactly once, so a drifted placeholder never ships silently.
stamp_version() {
  local src=$1 dest=$2 count
  count=$(grep -cFx "$placeholder" "$src")
  [ "$count" -eq 1 ] || { echo "ERROR: $src does not have exactly one line '$placeholder' (found $count)" >&2; exit 1; }
  awk -v old="$placeholder" -v new="$stamped" '$0 == old { print new; next } { print }' "$src" >"$dest"
  chmod 755 "$dest"
}

stamp_version standalone/tutor "$out/tutor"
stamp_version standalone/install.sh "$out/install.sh"

archive="$out/bb-plugin-tutor-$version.tgz"
[ -f "$archive" ] || { echo "ERROR: $archive is missing; run scripts/release-archive.sh first" >&2; exit 1; }
built="$out/bb-plugin-tutor-$version-built.tgz"
[ -f "$built" ] || { echo "ERROR: $built is missing; run scripts/check-release-archive.sh $archive first" >&2; exit 1; }

(cd "$out" && sha256sum tutor install.sh "bb-plugin-tutor-$version.tgz" "bb-plugin-tutor-$version-built.tgz" >SHA256SUMS)
printf '%s\n' "$out/SHA256SUMS"
