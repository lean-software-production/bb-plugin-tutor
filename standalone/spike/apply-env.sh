#!/bin/sh
# Adds PI_CODING_AGENT_DIR and BB_PI_BRIDGE_COMMAND to the machine's service
# environment, as absolute paths, and restarts it. Linux: a systemd drop-in,
# which also unsets provider credentials (KEY_PATTERN in lib.sh) the systemd
# user manager would otherwise pass to the daemon.
# macOS: EnvironmentVariables in the machine's launchd plist. Safe to re-run;
# check-pi-env.sh rewrite uses it to repair after BB's installer runs again.
set -eu
. "$(dirname "$0")/lib.sh"

unit=$(machine_unit_file) || die "No machine service file found for port $SPIKE_PORT. Run setup.sh first."

case "$(os_kind)" in
  linux)
    dropin="$unit.d"
    mkdir -p "$dropin"
    # Provider credentials the systemd user manager would pass on (names only:
    # values never leave the service manager). Unset for this service, so
    # coach threads only use what Tutor's pi was signed in to.
    keys=$(systemctl --user show-environment | cut -d= -f1 | grep -E "$KEY_PATTERN" | tr '\n' ' ' | sed 's/ $//' || true)
    {
      printf '[Service]\n'
      printf 'Environment="PI_CODING_AGENT_DIR=%s"\n' "$PI_DIR"
      printf 'Environment="BB_PI_BRIDGE_COMMAND=%s"\n' "$TEE_PI"
      if [ -n "$keys" ]; then printf 'UnsetEnvironment=%s\n' "$keys"; fi
    } >"$dropin/tutor.conf"
    say "Wrote $dropin/tutor.conf${keys:+ (unsets $keys)}"
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
    say "launchd can't unset a variable; check-pi-env.sh keys reports any provider credential the agent still sees."
    ;;
esac

restart_machine
say "Restarted the machine service. PI_CODING_AGENT_DIR=$PI_DIR BB_PI_BRIDGE_COMMAND=$TEE_PI"
