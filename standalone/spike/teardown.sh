#!/bin/sh
# Undoes setup.sh: removes the machine's enrolment, runs BB's installer with
# --uninstall, stops the spike server, and deletes $SPIKE_HOME and the
# machine directory for this port. Never touches ~/.pi or another BB.
#
# results.txt and the logs are copied to $SPIKE_RESULTS_DIR (default
# ~/tutor-spike-results-<os>, outside the repo) first, so the spike document can still use them.
set -u
. "$(dirname "$0")/lib.sh"

out=${SPIKE_RESULTS_DIR:-$HOME/tutor-spike-results-$(os_kind)}
if [ -d "$SPIKE_HOME" ]; then
  mkdir -p "$out"
  cp "$RESULTS" "$out/" 2>/dev/null
  cp -R "$LOGS" "$out/" 2>/dev/null
  say "Kept results and logs in $out (the logs may hold prompts: redact before sharing)"
fi

if curl -fsS "http://127.0.0.1:$SPIKE_PORT/health" >/dev/null 2>&1 || curl -fsS "http://127.0.0.1:$SPIKE_PORT/api/health" >/dev/null 2>&1; then
  if mid=$(machine_id 2>/dev/null); then
    spike_bb machine remove "$mid" --yes && say "Removed machine $mid from the spike server"
  fi
fi

if [ -f "$SPIKE_HOME/machine-installer.sh" ]; then
  if sh "$SPIKE_HOME/machine-installer.sh" --uninstall >"$out/uninstall.log" 2>&1; then
    say "BB's installer --uninstall worked (record as MACHINE_UNINSTALL)"
  else
    say "BB's installer --uninstall failed; see $out/uninstall.log. Removing the service by hand."
  fi
fi

# Whatever --uninstall left behind.
if unit=$(machine_unit_file 2>/dev/null); then
  case "$(os_kind)" in
    linux)
      systemctl --user disable --now "$(basename "$unit")" 2>/dev/null
      rm -rf "$unit" "$unit.d"
      systemctl --user daemon-reload
      ;;
    macos)
      launchctl bootout "gui/$(id -u)" "$unit" 2>/dev/null
      rm -f "$unit"
      ;;
  esac
  say "Removed leftover service file $unit (note in the document: --uninstall didn't)"
fi

if [ -f "$SPIKE_HOME/server.pid" ]; then
  kill "$(cat "$SPIKE_HOME/server.pid")" 2>/dev/null && say "Stopped the spike server"
fi
# bb-server is a launcher that starts the real server as a child: stopping the
# launcher alone leaves the server running, so stop anything still running
# from the spike's own bb-app.
if pkill -f "$SPIKE_HOME/npm/node_modules/bb-app/" 2>/dev/null; then
  say "Stopped the spike server's remaining processes"
fi

rm -rf "$SPIKE_HOME" "$MACHINE_DIR"
say "Deleted $SPIKE_HOME and $MACHINE_DIR"
