load helper

@test "the machine service gets Tutor's pi, as absolute paths, on Linux" {
  STUB_UNAME=Linux; make_stub_machine_unit
  machine_env_apply
  grep -q "Environment=\"PI_CODING_AGENT_DIR=$TUTOR_HOME/pi\"" ~/.config/systemd/user/*.service.d/tutor.conf
  grep -q "Environment=\"BB_PI_BRIDGE_COMMAND=$TUTOR_HOME/bin/pi\"" ~/.config/systemd/user/*.service.d/tutor.conf
  grep -q "restart" "$STUB_LOG/systemctl"
}

@test "provider credentials the systemd user manager holds are unset for the machine, by name only" {
  STUB_UNAME=Linux; make_stub_machine_unit
  STUB_SYSTEMD_ENV=$'PATH=/usr/bin\nOPENCODE_API_KEY=s3cret\nANTHROPIC_OAUTH_TOKEN=s3cret2\nGITHUB_TOKEN=keep' machine_env_apply
  grep -qx "UnsetEnvironment=OPENCODE_API_KEY ANTHROPIC_OAUTH_TOKEN" ~/.config/systemd/user/*.service.d/tutor.conf
  ! grep -rq "s3cret" ~/.config/systemd/user "$TUTOR_HOME" || false
}

@test "tutor login records the provider and pins coach threads to its model" {
  STUB_PI_SIGNED_IN=openrouter STUB_PROVIDER_MODELS='openrouter/some-model' run cmd_login --provider openrouter </dev/null
  [ "$(config_get provider)" = openrouter ]
  grep -q "plugin config tutor set coachModel openrouter/some-model" "$STUB_LOG/bb"
}

@test "on macOS the variables go into the machine's plist and the agent is reloaded" {
  STUB_UNAME=Darwin; make_stub_machine_plist
  machine_env_apply
  grep -q "EnvironmentVariables:PI_CODING_AGENT_DIR string $TUTOR_HOME/pi" "$STUB_LOG/PlistBuddy"
  grep -q "bootstrap" "$STUB_LOG/launchctl"
}

@test "applying twice restarts once" {
  STUB_UNAME=Linux; make_stub_machine_unit
  machine_env_apply; machine_env_apply
  [ "$(grep -c restart "$STUB_LOG/systemctl")" -eq 1 ]
}

@test "~/.pi is never touched" {
  mkdir -p ~/.pi/agent; echo '{"x":1}' > ~/.pi/agent/auth.json; before=$(cksum < ~/.pi/agent/auth.json)
  pi_install; STUB_UNAME=Linux; make_stub_machine_unit; machine_env_apply; cmd_login </dev/null || true
  [ "$(cksum < ~/.pi/agent/auth.json)" = "$before" ]
  grep -q "PI_CODING_AGENT_DIR=$TUTOR_HOME/pi" "$STUB_LOG/pi"
}

# --- beyond the brief ---

@test "pi_install puts the pinned pi in Tutor's bin, and a private pi folder" {
  pi_install
  grep -q "install --prefix $TUTOR_HOME/pi-npm @earendil-works/pi-coding-agent@0.85.1" "$STUB_LOG/npm"
  [ -x "$TUTOR_HOME/bin/pi" ]
  [ "$(stat -c %a "$TUTOR_HOME/pi" 2>/dev/null || stat -f %Lp "$TUTOR_HOME/pi")" = 700 ]
  pi_install
  [ "$(grep -c pi-coding-agent "$STUB_LOG/npm")" -eq 1 ]
}

@test "machine_env_apply prints nothing, and a changed credential list restarts again" {
  STUB_UNAME=Linux; make_stub_machine_unit
  run machine_env_apply
  [ "$status" -eq 0 ]; [ -z "$output" ]
  STUB_SYSTEMD_ENV='OPENROUTER_API_KEY=x' machine_env_apply
  [ "$(grep -c restart "$STUB_LOG/systemctl")" -eq 2 ]
}

@test "a % in Tutor's home is escaped for systemd" {
  STUB_UNAME=Linux; make_stub_machine_unit
  TUTOR_HOME="$HOME/100% tutor" machine_env_apply
  grep -qF "Environment=\"PI_CODING_AGENT_DIR=$HOME/100%% tutor/pi\"" ~/.config/systemd/user/*.service.d/tutor.conf
}

@test "without the machine's service file, machine_env_apply says to run tutor up again" {
  STUB_UNAME=Linux
  run machine_env_apply
  [ "$status" -eq 1 ]; [[ "$output" == *"Run \`tutor up\` again"* ]]
}

@test "tutor login asks which provider when not given one, and checks pi is signed in to it" {
  STUB_PI_SIGNED_IN=anthropic STUB_PROVIDER_MODELS='anthropic/claude-x' run cmd_login <<<"anthropic"
  [ "$status" -eq 0 ]
  [ "$(config_get provider)" = anthropic ]; [ "$(config_get model)" = anthropic/claude-x ]
  grep -q "auth check --provider anthropic" "$STUB_LOG/pi"
}

@test "tutor login refuses a provider pi isn't signed in to" {
  STUB_PI_SIGNED_IN=openrouter run cmd_login --provider anthropic </dev/null
  [ "$status" -eq 1 ]; [ -z "$(config_get provider)" ]
  ! grep -q coachModel "$STUB_LOG/bb" || false
}

@test "tutor login takes --model, with or without the provider prefix" {
  STUB_PI_SIGNED_IN=openrouter run cmd_login --provider openrouter --model moonshotai/kimi-k2.6 </dev/null
  [ "$status" -eq 0 ]
  grep -q "plugin config tutor set coachModel openrouter/moonshotai/kimi-k2.6" "$STUB_LOG/bb"
}

@test "tutor login picks the first model of the chosen provider only" {
  STUB_PI_SIGNED_IN=openrouter STUB_PROVIDER_MODELS='opencode/other openrouter/first openrouter/second' run cmd_login --provider openrouter </dev/null
  grep -q "coachModel openrouter/first" "$STUB_LOG/bb"
}

@test "when the model list has nothing yet, login retries, then leaves the model to pi" {
  STUB_PI_SIGNED_IN=openrouter STUB_PROVIDER_MODELS='' TUTOR_MODEL_RETRIES=3 run cmd_login --provider openrouter </dev/null
  [ "$status" -eq 0 ]
  [ "$(grep -c 'provider models pi' "$STUB_LOG/bb")" -eq 3 ]
  [ -z "$(config_get model)" ]
  ! grep -q "coachModel ." "$STUB_LOG/bb" || false
  ! printf '%s' "$output" | grep -iqw bb || false
}

@test "pi_ready asks Tutor's pi about the recorded provider, with Tutor's pi folder" {
  run pi_ready
  [ "$status" -eq 1 ]   # no provider recorded yet
  pi_install; config_set provider openrouter
  STUB_PI_SIGNED_IN=openrouter run pi_ready
  [ "$status" -eq 0 ]
  grep -q "PI_CODING_AGENT_DIR=$TUTOR_HOME/pi auth check --provider openrouter" "$STUB_LOG/pi"
}

@test "a failed restart leaves the next run retrying, with what to do" {
  STUB_UNAME=Linux; make_stub_machine_unit
  STUB_SYSTEMCTL_FAIL=restart run machine_env_apply
  [ "$status" -eq 1 ]; [[ "$output" == *"Run \`tutor logs\`"* ]]; ! printf '%s' "$output" | grep -iqw bb || false
  machine_env_apply
  [ "$(grep -c restart "$STUB_LOG/systemctl")" -eq 2 ]
  grep -q PI_CODING_AGENT_DIR ~/.config/systemd/user/*.service.d/tutor.conf
}

@test "a failed daemon-reload fails with what to do" {
  STUB_UNAME=Linux; make_stub_machine_unit
  STUB_SYSTEMCTL_FAIL=daemon-reload run machine_env_apply
  [ "$status" -eq 1 ]; [[ "$output" == *"Run \`tutor logs\`"* ]]
  ! grep -q restart "$STUB_LOG/systemctl" || false
}
