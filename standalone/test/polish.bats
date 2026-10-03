load helper

# tutor_polish: Tutor's look and a quieter BB, each decided once so a
# student's own change sticks (as the Codespace's tutor Feature does).

@test "switches off the plugins a student doesn't need, once each, and never Tutor's own" {
  STUB_PLUGINS="tutor:on thread-list:on provider-pi:on connect:on keep-awake:on workflows:off monaco-editor:on" run tutor_polish
  [ "$status" -eq 0 ]
  grep -qx "plugin disable connect" "$STUB_LOG/bb"
  grep -qx "plugin disable keep-awake" "$STUB_LOG/bb"
  grep -qx "plugin disable monaco-editor" "$STUB_LOG/bb"
  ! grep -q "plugin disable workflows" "$STUB_LOG/bb" || false   # already off
  ! grep -qE "plugin disable (tutor|thread-list|provider-pi)$" "$STUB_LOG/bb" || false
}

@test "a plugin the student turns back on stays on: each is switched off only once" {
  STUB_PLUGINS="connect:on" tutor_polish
  : >"$STUB_LOG/bb"
  STUB_PLUGINS="connect:on" tutor_polish
  ! grep -q "plugin disable connect" "$STUB_LOG/bb" || false
}

@test "a plugin BB doesn't have is skipped, and a failed disable is tried again next time" {
  STUB_PLUGINS="connect:on" STUB_BB_FAIL="plugin disable" run tutor_polish
  [ "$status" -eq 0 ]
  : >"$STUB_LOG/bb"
  STUB_PLUGINS="connect:on" tutor_polish
  grep -qx "plugin disable connect" "$STUB_LOG/bb"
}

@test "selects the Sketchbook theme while BB's default theme is on, once" {
  STUB_THEME=default tutor_polish
  grep -qx "theme set plugin:tutor:sketchbook --json" "$STUB_LOG/bb"
  : >"$STUB_LOG/bb"
  STUB_THEME=nord tutor_polish                        # the student chose another theme since
  ! grep -q "theme set" "$STUB_LOG/bb" || false
}

@test "a theme the student already chose is left alone" {
  STUB_THEME=nord tutor_polish
  ! grep -q "theme set" "$STUB_LOG/bb" || false
}

@test "if the Sketchbook theme isn't available yet, the default is kept and it's tried again later" {
  STUB_THEME=default STUB_THEME_MISSING=plugin:tutor:sketchbook tutor_polish
  ! grep -q "theme set" "$STUB_LOG/bb" || false
  : >"$STUB_LOG/bb"
  STUB_THEME=default tutor_polish
  grep -qx "theme set plugin:tutor:sketchbook --json" "$STUB_LOG/bb"
}

@test "polish problems never stop tutor up and never say bb" {
  STUB_BB_FAIL="plugin list" run tutor_polish
  [ "$status" -eq 0 ]
  ! printf '%s' "$output" | grep -iqw bb || false
}
