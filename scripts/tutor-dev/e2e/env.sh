# Shared settings for the e2e walk scripts. Sourced, not run.
# shellcheck shell=bash
E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_REPO="$(cd "$E2E_DIR/../../.." && pwd)"   # this plugin repo
# Generated workspace (bind-mounted at /workspaces), devcontainer logs, shots.
E2E_HOME="${E2E_HOME:-$E2E_REPO/.tutor-e2e}"
E2E_SHOTS="${E2E_SHOTS:-$E2E_HOME/shots}"
# The plugin source that E2E_PLUGIN=local swaps in (default: this checkout).
E2E_PLUGIN_SRC="${E2E_PLUGIN_SRC:-$E2E_REPO}"
export E2E_HOME E2E_SHOTS

e2e_die() { printf '[tutor-e2e] ERROR: %s\n' "$*" >&2; exit 1; }

# The devcontainer-features checkout whose .devcontainer/tutor is under test.
e2e_dcf() {
    [ -n "${DCF:-}" ] || e2e_die "DCF is not set; point it at a devcontainer-features checkout (https://github.com/lean-software-production/devcontainer-features)"
    [ -f "$DCF/.devcontainer/tutor/devcontainer.json" ] || e2e_die "DCF=$DCF has no .devcontainer/tutor/devcontainer.json; is it a devcontainer-features checkout?"
    (cd "$DCF" && pwd)
}
