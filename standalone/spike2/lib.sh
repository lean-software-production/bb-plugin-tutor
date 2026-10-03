# shellcheck shell=bash disable=SC2034 # its settings are used by the scripts that source it
# Shared settings for Spike 2: a Tutor server on the hosted VM (ew-lsp-001) as
# its own Linux user, and this laptop as its BB machine. Sourced by the other
# scripts; see README.md for the runbook.
#
# Browser: https://$PUBLIC_HOST, through cloudflared and a Cloudflare Access
# app (bb has no auth of its own). Machine: $SERVER_URL over the tailnet,
# through a systemd-socket-proxyd socket on the box's tailnet IP, as the
# infrastructure repo's roles/ew_bb does for the shared bb.

BOX=${BOX:-ew-admin@ew-lsp-001-tailnet}
STUDENT=${STUDENT:-student-001}
PORT=${PORT:-38888}                  # granted to this laptop in the tailnet policy
TAILNET_IP=${TAILNET_IP:-100.124.90.17}
PUBLIC_HOST=${PUBLIC_HOST:-$STUDENT-ew-lsp-001.ensembleworks.dev}
BB_VERSION=${BB_VERSION:-0.45.0}

SERVER_URL="http://$TAILNET_IP:$PORT"
SPIKE2_HOME=${SPIKE2_HOME:-$HOME/.tutor-spike2}
WORKSPACE=${WORKSPACE:-$HOME/tutor-spike2/student course}
RESULTS="$SPIKE2_HOME/results.txt"
LAPTOP_BB="$SPIKE2_HOME/npm/node_modules/.bin/bb"
# BB's installer names the machine's folder after the server it joined.
MACHINE_DIR="$HOME/.bb-machines/$TAILNET_IP-$PORT"

# The plugins a student doesn't need: the launcher's TUTOR_QUIET_PLUGINS.
QUIET_PLUGINS=$(sed -n 's/^TUTOR_QUIET_PLUGINS="\(.*\)"$/\1/p' "$(dirname "${BASH_SOURCE[0]}")/../tutor")

say() { printf '%s\n' "$*"; }
die() { printf 'spike2: %s\n' "$*" >&2; exit 1; }

# result <check> <PASS|FAIL|INFO> <detail>: printed and appended to results.txt.
result() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) check $1: $2 — $3"
  say "$line"
  mkdir -p "$SPIKE2_HOME"
  printf '%s\n' "$line" >>"$RESULTS"
}

# sbb <args...>: this laptop's bb CLI (bb-app $BB_VERSION) against the
# student's server, with no inherited BB_* variable (in a BB terminal they
# name that BB: BB_CLI re-runs its bb, BB_THREAD_ID sends as its thread).
sbb() {
  local unset=() name
  while read -r name; do unset+=(-u "$name"); done < <(compgen -e | grep '^BB_' || true)
  env "${unset[@]}" BB_SERVER_URL="$SERVER_URL" "$LAPTOP_BB" "$@"
}

# on_box <script> [VAR=value...]: run a script from remote/ on the box as root.
on_box() {
  local script=$1; shift
  ssh -o BatchMode=yes "$BOX" "sudo env $* bash -s" <"$(dirname "${BASH_SOURCE[0]}")/remote/$script"
}

rpc() { # rpc <method> <json input>: a Tutor RPC on the student's server, JSON out
  local input="$SPIKE2_HOME/rpc-input.json"
  printf '%s' "$2" >"$input"
  sbb plugin rpc call tutor "$1" --input-file "$input" --json
}

json() { node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const v=JSON.parse(r);const f=new Function("v","return ("+process.argv[1]+")");const o=f(v);process.stdout.write(typeof o==="string"?o:JSON.stringify(o))})' "$1"; }

machine_id() { cat "$SPIKE2_HOME/machine_id" 2>/dev/null; }
