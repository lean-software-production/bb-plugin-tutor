# bb-plugin-tutor

The BB plugin half of the `tutor` devcontainer feature: a coached, Gherkin-driven course inside a
course codespace's BB. Design: [`docs/tutor/DESIGN.md`](../../../docs/tutor/DESIGN.md) as amended by
[`docs/tutor/CHANGELOG-from-design.md`](../../../docs/tutor/CHANGELOG-from-design.md). Module map,
ownership and contracts: [`docs/tutor/IMPLEMENTATION.md`](../../../docs/tutor/IMPLEMENTATION.md).

Targets bb-app **0.43.4** with plugin SDK **0.5.9**, pinned exactly in `devDependencies`. The plugin
id is `tutor`.

## Develop

```sh
npm ci                 # the lockfile pins every dependency
npm run typecheck      # tsc, strict
npm test               # node --test over shared/, server/, app/ and test/
npm run fonts          # regenerate app/fonts/fonts.css and themes/paper.css
bb plugin build .      # dist/app.* and dist/server.*
```

Never install this plugin into a BB you care about while developing; use the containerised harness
in [`scripts/tutor-dev/`](../../../scripts/tutor-dev/README.md):
`scripts/tutor-dev/install-plugin.sh src/tutor/plugin`.

## Settings and coach tools

- `coursePath` (string): the course checkout. Empty falls back to `TUTOR_COURSE_PATH`, then the
  feature's `/usr/local/etc/tutor/config.json`, then `/workspaces/tutorial`.
- `factoryProject` (project): the student's factory, written by the first-run page. Tutor never
  creates projects.
- `simpleNavigation` (boolean, default true): Tutor's sidebar navigation
  (`experimental_sidebarNavigation` `simple-nav`) shows BB's own rows minus Plugins and Skills.
  Off, or while settings load, it renders BB's navigation unchanged. BB uses it while
  Settings → Appearance → Navigation is Automatic or names Tutor.

## Codespace polish

- **Theme.** `bb.themes` contributes `paper` (`plugin:tutor:paper`): the workbook's paper, ink and
  blue on BB's tokens, the outline colour for the sidebar, Archivo for the UI (inlined, since a theme
  is one CSS file) and BB's own mono for code, plus a light code theme (`themes/paper-code.json`).
  Edit `app/theme/paper.palette.css`, then `npm run fonts` regenerates `themes/paper.css`; a test
  checks it is current and that every text colour keeps 4.5:1. Dark mode gets a dark paper variant;
  Tutor's own surfaces stay light.
- **Activity heartbeat.** GitHub does not count browser traffic through a forwarded port as
  Codespace activity. The `activity` content script (`app/activity.ts`, mounted once per window
  for as long as the plugin's frontend is active) calls the `heartbeat` RPC at most every 45 s
  while the page is visible and the student used pointer, keyboard, wheel or touch, or came back
  to the tab, in the last 60 s. Focus and scroll events do not count: BB autofocuses its composer
  on every page load and the lesson scrolls itself while the coach writes. The backend writes one ISO-8601 UTC line to `<BB data dir>/.tutor-feature/activity`
  (atomically, the directory created 0700, at most every 30 s), where the tutor feature's
  keep-alive reads it. The data dir is `bb.server.experimental_dataDir`, then `BB_DATA_DIR`,
  then `dataDir` in the feature's config file.
- **Lost connection.** When an RPC fails without one of BB's JSON errors (the Codespaces proxy's
  empty 401 after an idle stop, a 502 page, a network error), `useTutorRpc` rejects with
  `ConnectionLostError` and every Tutor error surface shows "Lost the connection to your
  Codespace …" with a Reload button instead of `rpc "…" failed (HTTP 401)`
  (`app/model/rpc-errors.ts`). Tutor's and BB's own errors are unchanged.

Coach threads are spawned by Tutor directly in the factory folder, and only they are offered the
`tutor` skill and the six `tutor_*` tools (`status`, `focus_rule`, `mark_example`,
`adopt_iteration`, `complete_iteration`, `side_chat`). Each tool also refuses, inside
`execute()`, any thread Tutor did not spawn in the bound factory project.

## Layout

| Path | What |
|---|---|
| `server.ts` | Backend entry (factory) |
| `app.tsx` | Frontend entry (`definePluginApp`) |
| `shared/` | Model, keys, RPC contract, tool schemas, directive attributes, routes, fixtures |
| `server/course/` | Course loading: course.yaml or ledger, Gherkin, slugs, hashes, novelty, lexicon, Lesson 0 |
| `server/progress/`, `server/coach/`, `server/rpc/` | Student state, coach tools and threads, RPC handlers |
| `app/` | Course outline (`Outline.tsx`), start page, lesson and Rule cards and other directives, the jump to a Rule's section, rule tab, home section, sidebar navigation, activity reporter; `paper.css`, fonts and the theme source |
| `themes/` | The `paper` BB theme (generated CSS) and its light code theme |
| `skills/tutor/` | The coach's skill |
| `components/`, `lib/`, `hooks/` | Vendored BB UI components (shadcn model) |

## Conventions

- Relative imports carry their extension (`./model.ts`), so `node --test` can run the sources
  directly; `@/…` aliases are for `.tsx` files only.
- Type-only imports use `import type` (enforced by `verbatimModuleSyntax`).
- Frontend code imports `shared/model.ts` and `shared/rpc.ts` with `import type` only.
- Paper CSS stays under `.tutor-paper` / `.tutor-grid` with `tp-` classes and `--tp-` tokens.
