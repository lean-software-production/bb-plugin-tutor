#!/usr/bin/env bash
# Spike 2 back-out. Laptop first (the machine is removed from the server while
# the server still runs), then the box. The Cloudflare pieces are by hand: the
# steps are printed at the end (README.md, "Back out").
#
#   teardown.sh            laptop and box
#   teardown.sh laptop     only this laptop's machine and $SPIKE2_HOME
#   teardown.sh box        only the box (user, home, units)
#
# The workspace ($WORKSPACE) is the student's: it is left alone.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

teardown_laptop() {
  local mid
  mid=$(machine_id) || mid=""
  if [ -n "$mid" ] && [ -x "$LAPTOP_BB" ] && curl -fsS -m 5 "$SERVER_URL/health" -o /dev/null 2>&1; then
    sbb machine remove "$mid" --yes >/dev/null 2>&1 || say "couldn't remove machine $mid from the server (the box teardown removes the server anyway)"
  fi
  local unit
  for unit in $(grep -l "$TAILNET_IP-$PORT" "$HOME"/.config/systemd/user/*.service 2>/dev/null || true); do
    systemctl --user disable --now "$(basename "$unit")" >/dev/null 2>&1 || true
    rm -f "$unit"
    rm -rf "$unit.d"
    say "removed $(basename "$unit")"
  done
  systemctl --user daemon-reload
  rm -rf "$MACHINE_DIR" "$SPIKE2_HOME"
  say "removed $MACHINE_DIR and $SPIKE2_HOME (the workspace $WORKSPACE is left alone)"
}

teardown_box() {
  on_box teardown.sh STUDENT="$STUDENT"
}

case "${1:-all}" in
  laptop) teardown_laptop ;;
  box) teardown_box ;;
  all) teardown_laptop; teardown_box ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac

cat <<EOF

By hand, if the Cloudflare route was set up (README.md, "Back out"):
  1. Remove the $PUBLIC_HOST ingress rule from /etc/cloudflared/config.yml on the box
     (and from the infrastructure repo's instances/ew-lsp-001/cloudflared-config.yml),
     then: sudo systemctl restart cloudflared
  2. Delete the $PUBLIC_HOST CNAME, then its Access app.
EOF
