# The pi-environment spike

Task 1 of [the standalone Tutor plan](../../docs/2026-10-02-standalone-tutor-plan.md). It checks
one claim the design depends on before the launcher is built: Tutor's pi can be kept apart from
your own `~/.pi` by giving the enrolled machine's service two variables,
`PI_CODING_AGENT_DIR` and `BB_PI_BRIDGE_COMMAND`. These have to survive a restart, a reboot and a
BB update, and pi's login, model discovery and threads must all use Tutor's pi directory.

Run it once on Linux and once on macOS. Write what you find in
[`docs/2026-10-02-standalone-tutor-spike.md`](../../docs/2026-10-02-standalone-tutor-spike.md).

## What it touches

- `~/.tutor-spike/`, which holds BB 0.44.0, pi, the server's data, Tutor's pi directory and the logs.
- A `bb-server` on `127.0.0.1:47399`, started as a background process.
- A machine enrolled with BB's installer:
  - its files are in `~/.bb-machines/127.0.0.1-47399/`;
  - its service is a systemd user unit on Linux, or a launchd agent on macOS.

On Linux, the drop-in that sets those two variables also `UnsetEnvironment=`s every provider
credential the systemd user manager would pass on (found by name: `*_API_KEY`, `*_AUTH_TOKEN`,
`*_OAUTH_TOKEN`, `HF_TOKEN`, the AWS keys). Without it, a key exported by your desktop session,
such as `OPENCODE_API_KEY`, reaches coach threads. launchd can't unset a variable, so on macOS
check 9 just reports what the agent sees.

It doesn't touch a BB you already run (38886), a real Tutor (47386), or `~/.pi`, which check 5
verifies. `teardown.sh` removes all of it. Override the defaults with `SPIKE_HOME`, `SPIKE_PORT`,
`BB_VERSION` and `PI_VERSION`.

The one-time enrolment header goes into a `0600` file and reaches curl as `-H @file`. It is never
printed, logged or passed as an argument.

## Steps

```sh
sh standalone/spike/setup.sh                    # server, machine, Tutor's pi on the machine
sh standalone/spike/check-pi-env.sh before-login   # checks 1, 2, 9, 4
sh standalone/spike/check-pi-env.sh login          # in pi: /login to a provider your ~/.pi lacks, then /quit
SPIKE_PROVIDER=<that provider> sh standalone/spike/check-pi-env.sh after-login   # checks 5, 6, 7
sh standalone/spike/check-pi-env.sh rewrite        # check 3: does a reinstall keep the variables? repairs after
# reboot the computer, then:
sh standalone/spike/check-pi-env.sh after-reboot   # check 8
sh standalone/spike/check-pi-env.sh keys           # check 9 on its own, any time
sh standalone/spike/teardown.sh                    # keeps results in ~/tutor-spike-results-<os>
```

Each check prints `PASS`, `FAIL` or `INFO` and appends it to `~/.tutor-spike/results.txt`. Setup
also records the constants later tasks need: the health path, the settings commands, the shape of
the enrolment line, where the service file is, whether the installer body holds the token, and
the machine id.

After `after-login`, copy one coach turn from `~/.tutor-spike/logs/pi-in.log` and `pi-out.log`
into `standalone/e2e/fixtures/pi-rpc-transcript.jsonl`, with credentials redacted. The fake pi in
the end-to-end test replays it.

## The checks

| # | Check | Pass means |
|---|---|---|
| 1 | The running machine daemon's environment has both variables | They're applied |
| 2 | The same after restarting the service | They survive a restart |
| 3 | Re-run BB's saved installer, which stands in for an update rewriting the service, then look | INFO: whether `tutor up` must repair them |
| 4 | Tutor's pi before login | It has no credentials of its own |
| 5 | Log in against Tutor's pi dir | `auth.json` lands there, and `~/.pi/agent/auth.json` is byte-identical |
| 6 | The machine's pi model list includes a provider only Tutor's pi is signed in to | Discovery reads Tutor's pi dir |
| 7 | A pi thread spawned on the machine | It starts pi through `BB_PI_BRIDGE_COMMAND` with Tutor's pi dir |
| 8 | Checks 1, 9 and 7 after a reboot | They survive a reboot |
| 9 | The machine daemon's environment has no provider credential (`*_API_KEY`, `*_AUTH_TOKEN`, `*_OAUTH_TOKEN`, `HF_TOKEN`, AWS keys); names only are read | Coach threads can only use what Tutor's pi was signed in to |

What to change in the plan when a check fails is in Task 1's table in the plan.

## If something goes wrong

- **The enrolment line can't be parsed.** Setup stops and says so. Enrol by hand from
  `~/.tutor-spike/create.out`: put the header line in a `0600` file and run `curl -H @file <url> | sh`.
  Then run `apply-env.sh`. `create.out` holds the token, so don't paste it anywhere.
- **The machine id can't be found.** Set `SPIKE_MACHINE_ID` (see
  `BB_SERVER_URL=http://127.0.0.1:47399 ~/.tutor-spike/npm/node_modules/.bin/bb machine list`).
- **The `bb` CLI targets the server named by `BB_SERVER_URL`,** which a BB thread sets to your real
  BB. The scripts always set it to the spike server. Do the same if you run `bb` by hand.
