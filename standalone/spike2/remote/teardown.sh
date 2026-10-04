# Runs ON THE BOX as root (teardown.sh streams it over ssh). Removes what
# remote/setup.sh made: the units, then the student's user and home.
# Needs: STUDENT.
set -euo pipefail
: "${STUDENT:?}"

for unit in "tutor-$STUDENT-tailnet-proxy.socket" "tutor-$STUDENT-tailnet-proxy.service" "tutor-$STUDENT.service"; do
  systemctl disable --now "$unit" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$unit"
done
systemctl daemon-reload
if id "$STUDENT" >/dev/null 2>&1; then
  pkill -u "$STUDENT" 2>/dev/null || true
  sleep 1
  userdel --remove "$STUDENT" 2>/dev/null || userdel --remove --force "$STUDENT"
  echo "removed user $STUDENT and /home/$STUDENT"
fi
rm -f /tmp/tutor-spike2-plugin.tgz
