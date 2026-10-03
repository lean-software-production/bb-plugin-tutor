# Shared settings for the pi-environment spike (Task 1 of
# docs/2026-10-02-standalone-tutor-plan.md). Sourced by the other scripts.
#
# Everything lives under $SPIKE_HOME and the machine directory BB's installer
# manages for this port, so the spike never touches a BB you already run
# (38886) or a later real Tutor (47386).

SPIKE_HOME=${SPIKE_HOME:-$HOME/.tutor-spike}
SPIKE_PORT=${SPIKE_PORT:-47399}
BB_VERSION=${BB_VERSION:-0.45.0}
# The pi tested; record it in the spike document. Override with PI_VERSION=…
PI_PACKAGE=${PI_PACKAGE:-@earendil-works/pi-coding-agent}
PI_VERSION=${PI_VERSION:-0.85.1}

SERVER_URL="http://127.0.0.1:$SPIKE_PORT"
MACHINE_DIR="$HOME/.bb-machines/127.0.0.1-$SPIKE_PORT"
BB_BIN="$SPIKE_HOME/npm/node_modules/.bin"
PI_REAL="$SPIKE_HOME/bin/pi.real"
TEE_PI="$SPIKE_HOME/bin/tee-pi"
PI_DIR="$SPIKE_HOME/pi"
LOGS="$SPIKE_HOME/logs"
RESULTS="$SPIKE_HOME/results.txt"

# Environment variables that hand a model provider a credential: every
# *_API_KEY, *_AUTH_TOKEN and *_OAUTH_TOKEN pi reads (OPENCODE_API_KEY,
# OPENROUTER_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_OAUTH_TOKEN, …), HF_TOKEN and
# the AWS credentials (Bedrock). Matched by name, so new providers are covered.
KEY_PATTERN='(_API_KEY|_AUTH_TOKEN|_OAUTH_TOKEN)$|^HF_TOKEN$|^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)$'

# The bb CLI talks to whatever BB_SERVER_URL names. Inside a BB thread it is
# already set (to your real BB), so always pin it to the spike server.
spike_bb() {
  BB_SERVER_URL="$SERVER_URL" "$BB_BIN/bb" "$@"
}

os_kind() {
  case "$(uname -s)" in
    Linux) echo linux ;;
    Darwin) echo macos ;;
    *) echo "The spike runs on Linux and macOS only." >&2; exit 1 ;;
  esac
}

say() { printf '%s\n' "$*"; }
die() { printf 'spike: %s\n' "$*" >&2; exit 1; }

# result <check> <PASS|FAIL|INFO> <detail> — printed and appended to results.txt.
result() {
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $(os_kind) check $1: $2 — $3"
  say "$line"
  mkdir -p "$SPIKE_HOME"
  printf '%s\n' "$line" >>"$RESULTS"
}

# The systemd user unit (Linux) or launchd plist (macOS) BB's installer wrote
# for this port's machine: the one whose text names the machine directory.
machine_unit_file() {
  case "$(os_kind)" in
    linux) dir="$HOME/.config/systemd/user"; pattern='*.service' ;;
    macos) dir="$HOME/Library/LaunchAgents"; pattern='*.plist' ;;
  esac
  [ -d "$dir" ] || return 1
  for file in "$dir"/$pattern; do
    [ -f "$file" ] || continue
    if grep -q "127.0.0.1-$SPIKE_PORT" "$file" 2>/dev/null; then
      printf '%s\n' "$file"
      return 0
    fi
  done
  return 1
}

machine_unit_name() { basename "$(machine_unit_file)"; }

machine_label() {
  /usr/libexec/PlistBuddy -c 'Print :Label' "$(machine_unit_file)"
}

restart_machine() {
  case "$(os_kind)" in
    linux)
      systemctl --user daemon-reload
      systemctl --user restart "$(machine_unit_name)"
      ;;
    macos)
      launchctl kickstart -k "gui/$(id -u)/$(machine_label)"
      ;;
  esac
}

# The machine's host id on the spike server: SPIKE_MACHINE_ID if set, else
# the newest manual machine. Record the bb machine list --json shape you see.
machine_id() {
  if [ -n "${SPIKE_MACHINE_ID:-}" ]; then
    printf '%s\n' "$SPIKE_MACHINE_ID"
    return 0
  fi
  spike_bb machine list --json | node -e '
    let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      const data = JSON.parse(raw);
      const rows = Array.isArray(data) ? data : (data.machines ?? data.hosts ?? []);
      const manual = rows.filter((row) => (row.machineProviderId ?? row.provider ?? row.providerId) === "manual");
      manual.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      if (manual[0] === undefined) process.exit(1);
      console.log(manual[0].id);
    });'
}
