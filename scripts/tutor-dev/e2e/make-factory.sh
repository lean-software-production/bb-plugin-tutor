#!/usr/bin/env bash
# Inside the e2e container, readies the factory at $FACTORY (default
# /workspaces/my-factory), then runs the feature's own start-up hook, which
# registers it as a BB project if it is not one yet.
#   - /workspaces/my-factory (tutor/mvp): coach-me's old "Setting up" (no
#     spec/ITERATION: a student with no state starts on Homework 0).
#   - <starter>/tetris/.factory (tutor/starter-layout): the Feature's bootstrap
#     already cloned the starter; this only checks the factory is there and gives
#     the clone a git identity, in case anything in the walk commits.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY="${FACTORY:-/workspaces/my-factory}"
case "$FACTORY" in
*/.factory)
    "$here/bb.sh" --exec bash -euo pipefail -c '
f="$1"
[ -d "$f" ] || { echo "no factory at $f: the bootstrap did not clone the starter" >&2; exit 1; }
top="$(git -C "$f" rev-parse --show-toplevel)"
git -C "$top" config user.name "E2E Student"
git -C "$top" config user.email student@example.invalid
echo "factory $f is in the starter clone $top ($(git -C "$top" rev-parse --short HEAD))"
' _ "$FACTORY"
    ;;
*)
    "$here/bb.sh" --exec bash -euo pipefail -c '
f="$1"
[ -d "$f/.git" ] && { echo "factory exists"; exit 0; }
mkdir -p "$f/.claude/commands" "$f/.pi/prompts"
cd "$f"
git init -q -b main
git config user.name "E2E Student"; git config user.email student@example.invalid
cat > AGENTS.md <<EOF
# Agent instructions

This is a software factory built during the lean software manufacturing course.
The course is at \`../tutorial\`.

- When the user says "coach me", asks to be coached, or wants to work through their next homework with guidance, read and follow \`../tutorial/.agents/coach-me.md\`.
EOF
echo "@AGENTS.md" > CLAUDE.md
for p in .claude/commands/coach-me.md .pi/prompts/coach-me.md; do
  printf -- "---\ndescription: Walk me through my next homework iteration\n---\nRead and follow \`../tutorial/.agents/coach-me.md\`.\n" > "$p"
done
echo "jobs/" > .gitignore
git add -A && git commit -qm "Set up factory"
echo "factory created"
' _ "$FACTORY"
    ;;
esac
"$here/bb.sh" --exec /usr/local/share/tutor/bin/tutor-feature-autostart
"$here/bb.sh" project list
