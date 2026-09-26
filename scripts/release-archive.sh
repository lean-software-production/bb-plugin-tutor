#!/usr/bin/env bash
# Build the release assets for a git ref, exactly as the release workflow does:
#
#   scripts/release-archive.sh <git-ref> <out-dir>
#
# writes <out-dir>/bb-plugin-tutor-<version>.tgz and its .sha256, where
# <version> is package.json's version at <git-ref>. The tarball is
# `git archive` of the ref (so .gitattributes export-ignore applies) under one
# top-level directory bb-plugin-tutor-<version>/. The release workflow passes
# the tag v<version>; CI passes HEAD. Prints the tarball's path.
set -euo pipefail

ref="${1:-}" out="${2:-}"
[ -n "$ref" ] && [ -n "$out" ] || { echo "usage: $0 <git-ref> <out-dir>" >&2; exit 2; }
git rev-parse --verify --quiet "$ref^{commit}" >/dev/null || { echo "ERROR: $ref is not a commit" >&2; exit 1; }

version="$(git show "$ref:package.json" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(String(JSON.parse(s).version ?? "")));')"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: package.json version at $ref is '$version', not x.y.z" >&2; exit 1; }

name="bb-plugin-tutor-$version"
mkdir -p "$out"
git archive --format=tar --prefix="$name/" "$ref" | gzip -n -9 > "$out/$name.tgz"
(cd "$out" && sha256sum "$name.tgz" > "$name.tgz.sha256")
printf '%s\n' "$out/$name.tgz"
