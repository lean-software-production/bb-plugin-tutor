#!/usr/bin/env bash
# Check a release tarball the way the tutor Feature consumes it, and write
# the standalone launcher's ready-to-install build of it:
#
#   scripts/check-release-archive.sh <out-dir>/bb-plugin-tutor-<version>.tgz
#
# - the .sha256 beside it matches, in sha256sum format;
# - one top-level directory bb-plugin-tutor-<version>/ holding package.json and
#   package-lock.json, and no docs/, scripts/, .github/, vendor/, dist/ or node_modules/;
# - extracted to a temp dir, `npm ci --omit=dev --ignore-scripts` and
#   `bb plugin build .` succeed and write dist/app.js, dist/app.css,
#   dist/app.meta.json and dist/host.js;
# - that installed and built tree is packed, under the same one top-level
#   directory bb-plugin-tutor-<version>/, as
#   <out-dir>/bb-plugin-tutor-<version>-built.tgz: the asset install.sh puts
#   in ~/.tutor/releases/<version>/ and `tutor up` installs with
#   `bb plugin install`, so nothing is fetched at run time.
#
# `bb plugin build` gets a throwaway BB_DATA_DIR under the temp dir, and no
# other BB_* settings, so it never touches a BB running on this machine.
# Needs node, npm and the bb CLI (bb-app) on PATH.
set -euo pipefail

tgz="${1:-}"
[ -f "$tgz" ] || { echo "usage: $0 <bb-plugin-tutor-<version>.tgz>" >&2; exit 2; }
fail() { echo "ERROR: $*" >&2; exit 1; }
file="$(basename "$tgz")"
[[ "$file" =~ ^bb-plugin-tutor-([0-9]+\.[0-9]+\.[0-9]+)\.tgz$ ]] || fail "$file is not named bb-plugin-tutor-<x.y.z>.tgz"
version="${BASH_REMATCH[1]}"
top="bb-plugin-tutor-$version"

# 1. Checksum file.
sum_file="$tgz.sha256"
[ -f "$sum_file" ] || fail "missing $sum_file"
grep -Eqx "[0-9a-f]{64}  $file" "$sum_file" || fail "$sum_file is not '<64 hex>  $file'"
(cd "$(dirname "$tgz")" && sha256sum --check --quiet "$file.sha256") || fail "checksum mismatch for $file"

# 2. Layout.
listing="$(tar -tzf "$tgz")"
tops="$(printf '%s\n' "$listing" | cut -d/ -f1 | sort -u)"
[ "$tops" = "$top" ] || fail "expected one top-level directory $top/, found: $(echo $tops)"
for required in package.json package-lock.json server.ts app.tsx; do
    printf '%s\n' "$listing" | grep -qx "$top/$required" || fail "$top/$required is missing"
done
forbidden="$(printf '%s\n' "$listing" | grep -E "^$top/(docs|scripts|\.github|vendor|dist|node_modules)/" || true)"
[ -z "$forbidden" ] || fail "dev-only or build paths in the archive: $(printf '%s\n' "$forbidden" | head -n 5 | tr '\n' ' ')"
package_version="$(tar -xzOf "$tgz" "$top/package.json" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(String(JSON.parse(s).version)));')"
[ "$package_version" = "$version" ] || fail "package.json in the archive says $package_version, the file name says $version"

# 3. Install and build like the Feature does.
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tutor-archive-check.XXXXXX")"
trap 'rm -rf "$work"' EXIT
tar -xzf "$tgz" -C "$work"
cd "$work/$top"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# No inherited BB_* setting (server URL, daemon port, CLI path) may point bb at a real BB.
while read -r bb_var; do unset "$bb_var"; done < <(compgen -e | grep '^BB_' || true)
BB_DATA_DIR="$work/bb-data" bb plugin build .
for artifact in app.js app.css app.meta.json host.js; do
    [ -s "dist/$artifact" ] || fail "bb plugin build did not produce dist/$artifact"
done
# 4. The launcher's ready-to-install build: the same tree, deps and dist/ included.
out_dir="$(cd "$(dirname "$tgz")" && pwd)"
built="$out_dir/$top-built.tgz"
cd "$work"
rm -f "$built"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime=@0 -cf - "$top" | gzip -n -9 >"$built.tmp"
built_listing="$(tar -tzf "$built.tmp")"
[ "$(printf '%s\n' "$built_listing" | cut -d/ -f1 | sort -u)" = "$top" ] || fail "$built.tmp does not have one top-level directory $top/"
for required in package.json dist/host.js dist/app.js node_modules/; do
    # A here-string, not a pipe: grep -q stops reading early, and with
    # pipefail the writer's SIGPIPE would fail the check.
    grep -qx "$top/$required" <<<"$built_listing" || fail "$built.tmp is missing $top/$required"
done
mv "$built.tmp" "$built"

echo "OK: $file ($(wc -c < "$tgz") bytes, $(printf '%s\n' "$listing" | grep -vc '/$') files) installs and builds; dist/app.js, dist/app.css, dist/app.meta.json and dist/host.js present; wrote $built ($(wc -c < "$built") bytes)"
