load helper

@test "refuses Windows and other systems" {
  STUB_UNAME=MINGW64_NT run tutor up "$HOME/course"
  [ "$status" -eq 1 ]; [[ "$output" == *"Tutor runs on macOS and Linux."* ]]
}

@test "names what to install when Node is too old, and accepts 22.19, 24 and 26" {
  STUB_NODE_VERSION=v22.18.0 run check_prereqs
  [ "$status" -eq 1 ]; [[ "$output" == *"Node 22.19 or newer"* ]]
  for v in v22.19.0 v24.1.0 v26.0.0; do STUB_NODE_VERSION=$v run check_prereqs; [ "$status" -eq 0 ]; done
}

@test "refuses the odd Node majors bb-app doesn't support, and names one that works" {
  for v in v23.1.0 v25.2.1; do
    STUB_NODE_VERSION=$v run check_prereqs
    [ "$status" -eq 1 ]; [[ "$output" == *"Node 24"* ]]
  done
}

@test "names git and npm when missing" {
  STUB_MISSING="git npm" run check_prereqs
  [[ "$output" == *"git"* && "$output" == *"npm"* ]]
}

@test "the config file is read without being run" {
  mkdir -p "$TUTOR_HOME"; printf 'port=47386\nworkspace=$(touch %s/pwned)\n' "$HOME" > "$TUTOR_HOME/config"
  run config_get workspace
  [ ! -e "$HOME/pwned" ]; [ "$output" = '$(touch '"$HOME"'/pwned)' ]
}

@test "config_set keeps other keys and leaves the file 0600" {
  config_set port 47386; config_set workspace "$HOME/My Course"
  [ "$(config_get port)" = 47386 ]; [ "$(config_get workspace)" = "$HOME/My Course" ]
  [ "$(stat -c %a "$TUTOR_HOME/config" 2>/dev/null || stat -f %Lp "$TUTOR_HOME/config")" = 600 ]
}

@test "tutor up --server is reserved and refused" {
  run tutor up --server https://example.com
  [ "$status" -eq 1 ]; [[ "$output" == *"not available yet"* ]]
}

@test "help uses the name variable" {
  TUTOR_NAME=coach run tutor help
  [[ "$output" == *"coach up"* ]]; [[ "$output" != *"tutor up"* ]]
}

@test "nothing the launcher prints says bb" {
  run tutor help
  ! printf '%s' "$output" | grep -iqw bb || false
}

# --- final review: M6 ---

@test "an unknown command prints help and fails" {
  run tutor frobnicate
  [ "$status" -ne 0 ]; [[ "$output" == *"Usage: tutor"* ]]
}

@test "--port accepts 1 to 65535 only" {
  for p in 0 65536 99999 abc 1x; do
    run tutor up --port "$p" "$HOME/my-course"
    [ "$status" -eq 1 ]; [[ "$output" == *"port"* ]]
  done
  [ ! -e "$HOME/my-course" ]
}

@test "Bedrock's bearer token and Google's credentials file count as provider keys" {
  for name in AWS_BEARER_TOKEN_BEDROCK GOOGLE_APPLICATION_CREDENTIALS OPENAI_API_KEY; do
    printf '%s\n' "$name" | grep -qE "$KEY_PATTERN"
  done
  ! printf 'GITHUB_TOKEN\n' | grep -qE "$KEY_PATTERN" || false
}
