# Runs ON THE BOX as root (box-setup.sh streams it over ssh). Idempotent.
# Needs: STUDENT PORT TAILNET_IP BB_VERSION SERVER_URL PUBLIC_HOST PLUGIN_TGZ QUIET_PLUGINS.
set -euo pipefail
: "${STUDENT:?}" "${PORT:?}" "${TAILNET_IP:?}" "${BB_VERSION:?}" "${SERVER_URL:?}" "${PUBLIC_HOST:?}" "${PLUGIN_TGZ:?}"

case "$TAILNET_IP" in 100.*) ;; *) echo "TAILNET_IP must be a tailnet (100.x) address" >&2; exit 1 ;; esac
if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet "tutor-$STUDENT.service"; then
  echo "Something else already listens on port $PORT" >&2; exit 1
fi

H=/home/$STUDENT
as_student() { runuser -u "$STUDENT" -- env HOME="$H" PATH=/usr/local/bin:/usr/bin:/bin "$@"; }
bb() { as_student env BB_SERVER_URL="http://127.0.0.1:$PORT" "$H/tutor/npm/node_modules/.bin/bb" "$@"; }

# 1. The student's Linux user: no password, no sudo; never in AllowUsers.
if ! id "$STUDENT" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment "Tutor Spike 2 (bb-plugin-tutor standalone/spike2)" "$STUDENT"
  echo "created user $STUDENT"
fi
# Everything below runs from the student's home: sudo leaves us in ew-admin's,
# which the student can't enter (bb's CLI then fails to spawn with EACCES).
cd "$H"
as_student mkdir -p "$H/tutor/npm" "$H/tutor/server" "$H/tutor/plugin"
chmod 700 "$H/tutor/server"

# 2. bb-app, pinned, under the student's home.
if [ "$(cat "$H/tutor/npm/.bb-app-version" 2>/dev/null)" != "$BB_VERSION" ]; then
  as_student npm install --prefix "$H/tutor/npm" --no-audit --no-fund "bb-app@$BB_VERSION" >/dev/null
  printf '%s' "$BB_VERSION" | as_student tee "$H/tutor/npm/.bb-app-version" >/dev/null
  echo "installed bb-app@$BB_VERSION"
fi

# 3. The server: a system unit running as the student (as bb.service does), on
# loopback only. In bbmachines.slice when the box has it: the burst tier, so a
# student's server is what gets squeezed, never the team's bb or the canvas.
slice=""
systemctl cat bbmachines.slice >/dev/null 2>&1 && slice="Slice=bbmachines.slice"
unit="/etc/systemd/system/tutor-$STUDENT.service"
before=$(cat "$unit" 2>/dev/null || true)
cat >"$unit" <<EOF
# Hand-installed by bb-plugin-tutor standalone/spike2 (Spike 2) -- NOT Ansible.
# Back out: standalone/spike2/teardown.sh
[Unit]
Description=Tutor server for $STUDENT (Spike 2) on 127.0.0.1:$PORT
After=network-online.target
Wants=network-online.target

[Service]
User=$STUDENT
Group=$STUDENT
WorkingDirectory=$H
Environment=HOME=$H
Environment=PATH=/usr/local/bin:/usr/bin:/bin
# bb-app >= 0.45 answers 403 forbidden_host unless Host is localhost, an IP or
# this one hostname: the browser's, through cloudflared.
Environment=BB_APP_URL=https://$PUBLIC_HOST
ExecStart=/usr/local/bin/node $H/tutor/npm/node_modules/.bin/bb-server --data-dir $H/tutor/server --server-bind-host 127.0.0.1 --server-port $PORT
$slice
MemoryHigh=2G
MemoryMax=3G
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 4. The tailnet proxy: roles/ew_bb/tasks/server_proxy.yml's pattern, under
# Tutor's own unit names so a later Ansible converge never fights it.
cat >"/etc/systemd/system/tutor-$STUDENT-tailnet-proxy.socket" <<EOF
# Hand-installed by bb-plugin-tutor standalone/spike2 (Spike 2) -- NOT Ansible.
[Unit]
Description=Tutor server for $STUDENT on the tailnet ($TAILNET_IP:$PORT)

[Socket]
ListenStream=$TAILNET_IP:$PORT
FreeBind=yes

[Install]
WantedBy=sockets.target
EOF
cat >"/etc/systemd/system/tutor-$STUDENT-tailnet-proxy.service" <<EOF
# Hand-installed by bb-plugin-tutor standalone/spike2 (Spike 2) -- NOT Ansible.
[Unit]
Description=Relay tailnet connections to the Tutor server for $STUDENT on loopback
Requires=tutor-$STUDENT-tailnet-proxy.socket
After=tutor-$STUDENT-tailnet-proxy.socket

[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd 127.0.0.1:$PORT
DynamicUser=yes
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
MemoryMax=64M
EOF

systemctl daemon-reload
systemctl enable --now "tutor-$STUDENT.service" >/dev/null
if [ -n "$before" ] && [ "$before" != "$(cat "$unit")" ]; then
  systemctl restart "tutor-$STUDENT.service"
  echo "restarted tutor-$STUDENT (its unit changed)"
fi
systemctl enable --now "tutor-$STUDENT-tailnet-proxy.socket" >/dev/null

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/health" -o /dev/null 2>/dev/null && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/health" -o /dev/null || { echo "the server never became healthy" >&2; journalctl -u "tutor-$STUDENT" -n 30 --no-pager >&2; exit 1; }
echo "server healthy on 127.0.0.1:$PORT"

# 5. Machines join over the tailnet: the installer BB hands out points there.
bb settings general machineServerUrl "$SERVER_URL" >/dev/null
bb settings general defaultMachineAccess direct >/dev/null

# 6. Tutor's plugin, from the built archive (dist/ and node_modules/ included).
top=$(tar -tzf "$PLUGIN_TGZ" | sed -n 1p | cut -d/ -f1)   # sed reads it all: no SIGPIPE under pipefail
rm -rf "$H/tutor/plugin/$top"
as_student tar -xzf "$PLUGIN_TGZ" -C "$H/tutor/plugin"
rm -f "$PLUGIN_TGZ"
bb plugin install "$H/tutor/plugin/$top" --yes >/dev/null
echo "plugin installed from $H/tutor/plugin/$top"

# 7. As the launcher's tutor_polish: Tutor's theme, and a quieter BB.
bb theme set plugin:tutor:sketchbook --json >/dev/null || echo "theme not set (Sketchbook not available yet)"
for id in $QUIET_PLUGINS; do bb plugin disable "$id" >/dev/null 2>&1 || true; done

echo "memory: $(systemctl show "tutor-$STUDENT.service" -p MemoryCurrent --value) bytes"
