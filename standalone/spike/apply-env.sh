#!/bin/sh
# Adds PI_CODING_AGENT_DIR and BB_PI_BRIDGE_COMMAND to the machine's service
# environment, as absolute paths, and restarts it. Linux: a systemd drop-in.
# macOS: EnvironmentVariables in the machine's launchd plist. Safe to re-run;
# check-pi-env.sh rewrite uses it to repair after BB's installer runs again.
set -eu
. "$(dirname "$0")/lib.sh"

unit=$(machine_unit_file) || die "No machine service file found for port $SPIKE_PORT. Run setup.sh first."

case "$(os_kind)" in
  linux)
    dropin="$unit.d"
    mkdir -p "$dropin"
    cat >"$dropin/tutor.conf" <<EOF
[Service]
Environment="PI_CODING_AGENT_DIR=$PI_DIR"
Environment="BB_PI_BRIDGE_COMMAND=$TEE_PI"
EOF
    say "Wrote $dropin/tutor.conf"
    ;;
  macos)
    pb=/usr/libexec/PlistBuddy
    "$pb" -c 'Print :EnvironmentVariables' "$unit" >/dev/null 2>&1 || "$pb" -c 'Add :EnvironmentVariables dict' "$unit"
    for pair in "PI_CODING_AGENT_DIR=$PI_DIR" "BB_PI_BRIDGE_COMMAND=$TEE_PI"; do
      key=${pair%%=*}
      value=${pair#*=}
      "$pb" -c "Delete :EnvironmentVariables:$key" "$unit" >/dev/null 2>&1 || true
      "$pb" -c "Add :EnvironmentVariables:$key string $value" "$unit"
    done
    # launchd reads the plist at load time: reload, don't just kickstart.
    launchctl bootout "gui/$(id -u)" "$unit" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$unit"
    say "Updated EnvironmentVariables in $unit and reloaded it"
    ;;
esac

restart_machine
say "Restarted the machine service. PI_CODING_AGENT_DIR=$PI_DIR BB_PI_BRIDGE_COMMAND=$TEE_PI"
