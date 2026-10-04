# Scripted provider (test fixture)

A credential-free BB agent provider (id `scripted`) used by the Tutor tests
instead of a real coding agent. This copy, for the hosted end-to-end test
(`e2e/hosted.sh`), is devcontainer-features'
`test/tutor/fixtures/scripted-provider` with its pins moved to bb-app 0.45.0 and
plugin SDK 0.6.15 (and 0.5.29 before it); the code is unchanged. It is modelled on upstream
`examples/plugins/echo-provider`.

**Never install this into a BB you care about.** Use a disposable container,
such as the Feature scenarios in `test/tutor/` or the plugin repository's dev
harness,
[`scripts/tutor-dev/`](https://github.com/lean-software-production/bb-plugin-tutor/tree/main/scripts/tutor-dev).

Every turn replies with one assistant message. It opens with:

- every prompt line that starts with `::`, echoed verbatim, so message
  directives render as real assistant markdown, and
- every line starting with `::` in the result of a tool call it made, as a
  coach echoes the cards Tutor's tools return. So a `CALL tutor_focus_rule`
  turn opens with that Rule's card, and a first prompt carrying
  `::tutor-lesson{…}` gets a first reply that opens with the lesson card.

Then it reports:

- the `dynamicTools` BB offered at `thread/start`, `thread/resume` or
  `thread/fork` (tool scoping by `bb.agents.configure`, as the provider sees
  it), and
- the skills BB offered through `skills/configure`.

A turn's prompt is its text blocks, each starting a line (a side chat's
agent-only seed comes first). Two prompt lines make the bridge call a tool:

- `CALL <tool> {json}` calls the tool over `item/tool/call`, but only if the
  tool was offered.
- `FORCECALL <tool> {json}` calls it even if it was not offered. BB 0.43.4 runs
  such a call, so this checks that the plugin's own `execute()` refuses it.

It forks at the tip (`fork: "tip"`, declared both when the provider registers
and in the bridge's `initialize` reply, which may only narrow it). A fork opens
a fresh session with nothing of the source's history, which is all a script
needs, so BB side chats work: "Reply in side chat" and Tutor's "Ask a side
question" both make a hidden fork.

Every event is also appended to
`<BB dataDir>/plugins/scripted-provider/bridge-data/turns.ndjson`.

```sh
npm ci --omit=dev
bb plugin install "$PWD" --yes
bb thread spawn --project <id> --provider scripted --prompt-file <file>
```

BB runs one bridge process per thread session. `bb plugin reload` does not
restart the bridge of a live thread; run `bb thread stop <id>` first.
