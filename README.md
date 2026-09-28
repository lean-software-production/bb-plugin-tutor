# bb-plugin-tutor

Tutor is a BB plugin for a coached, Gherkin-driven course inside a course Codespace's BB. It is
the plugin half of the `tutor` devcontainer Feature, which lives in
[devcontainer-features](https://github.com/lean-software-production/devcontainer-features/tree/main/src/tutor)
and installs a pinned release of this repo.

The design is [`docs/DESIGN.md`](docs/DESIGN.md), as amended by
[`docs/CHANGELOG-from-design.md`](docs/CHANGELOG-from-design.md). The module map, ownership and
contracts are in [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md).

Tutor targets bb-app **0.43.4** (`engines.bb` is `>=0.43.4`, and CI builds with exactly 0.43.4)
with plugin SDK **0.5.9**, which is pinned exactly in `devDependencies`. The plugin id is `tutor`.

## Install

### In a course Codespace (the supported way)

Add the tutor Feature, together with the bb Feature in standalone mode, as devcontainer-features'
[`.devcontainer/tutor`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor)
does. At image build, the Feature downloads this repo's release
`bb-plugin-tutor-<version>.tgz`, checks it against a SHA-256 pinned in the Feature, and prebuilds
it. It also writes `/usr/local/etc/tutor/config.json`. On start, it installs the plugin into the
learner's BB and does the rest of the set-up:

- clones the course (and the starter);
- registers the course and the factory as BB projects;
- selects the course outline as the sidebar and the `paper` theme (Sketchbook under its old id);
- switches off plugins a learner does not need;
- runs the keep-alive that reads Tutor's activity heartbeat.

To use a different plugin release, set the Feature's `pluginVersion` and `pluginSha256`.

`config.json` carries `"schemaVersion": 1`. This plugin reads schema version 1, and treats a
missing `schemaVersion` as 1. For any other version, Tutor refuses to run:

- the course pages and the coach say which version they found and which one this plugin
  supports;
- every coach tool refuses and writes nothing.

To fix it, update the plugin, or pin a tutor Feature version that matches it.

### Directly into a BB

```sh
bb plugin install git:https://github.com/lean-software-production/bb-plugin-tutor@v0.1.0
```

BB clones the tag, runs `npm install` with lifecycle scripts disabled, builds both bundles, and
starts the plugin. It then runs with no Feature `config.json`, and none of the Feature's set-up
above happens:

- **Course.** Tutor looks for the course at the `coursePath` setting (Settings → Plugins →
  Tutor), then `TUTOR_COURSE_PATH` in the BB server's environment, then `/workspaces/tutorial`.
  If none of those holds a course, the home page and the Course page show "There is no course
  folder at /workspaces/tutorial." along with how to fix it. Nothing else works until a course
  is found.
- **Factory.** With no factory hint from the Feature, the first-run page ranks your BB projects
  as factory candidates and asks you to confirm one. Tutor never creates projects, so register your factory
  as a BB project first.
- **Everything else is up to you.** That covers selecting the course outline as the sidebar
  thread list, choosing the Sketchbook theme, and cloning the course. Nothing reads the
  activity heartbeat, which lands in `<BB data dir>/.tutor-feature/activity`.

## Develop

```sh
npm ci                 # the lockfile pins every dependency
npm run typecheck      # tsc, strict
npm test               # node --test over shared/, server/, app/ and test/
npm run build:assets   # regenerate app/fonts/fonts.css, themes/sketchbook.css and the code themes
npm run sync-brand -- <sha>   # re-vendor the brand at <sha>; --check compares vendor/brand with its pin
bb plugin build .      # dist/app.* and dist/server.*
```

CI (`.github/workflows/ci.yaml`) runs typecheck, the tests and `bb plugin build .` on Node 24.
It installs bb-app from npm with `npm install --global --ignore-scripts bb-app@0.43.4`, which
skips BB's native add-ons, since building a plugin does not need them. CI also builds the release
archive from `HEAD` and checks that it installs and builds on its own
(`scripts/release-archive.sh`, `scripts/check-release-archive.sh`).

Never install this plugin into a BB you care about while developing. Use the containerised
harness in [`scripts/tutor-dev/`](scripts/tutor-dev/README.md). It needs a local copy of the
bb Feature:

```sh
export TUTOR_DEV_BB_FEATURE=<devcontainer-features checkout>/src/bb
scripts/tutor-dev/up.sh
scripts/tutor-dev/install-plugin.sh .      # path-installs this checkout; re-run to rebuild and reload
```

The end-to-end walk in [`scripts/tutor-dev/e2e/`](scripts/tutor-dev/e2e/README.md) tests the
tutor Feature and this plugin together. It uses a devcontainer-features checkout's
`.devcontainer/tutor`, with this checkout swapped in for the pinned release.

## Release

A release is a tag `v<version>` whose version equals `version` in `package.json`.

1. Bump `version` in `package.json` and `package-lock.json` (`npm version --no-git-tag-version
   <x.y.z>`) in a PR, and merge it to `main`.
2. Tag the merge commit and push the tag:

   ```sh
   git checkout main && git pull
   git tag -a v<x.y.z> -m "v<x.y.z>"
   git push origin v<x.y.z>
   ```

3. `.github/workflows/release.yaml` then runs on the tag. It fails if the tag is not
   `v` + the `package.json` version. Otherwise it runs typecheck and the tests, and builds
   `bb-plugin-tutor-<x.y.z>.tgz` with `git archive`. That archive has one top-level directory,
   `bb-plugin-tutor-<x.y.z>/`, and no `docs/`, `scripts/`, `.github/`, `dist/` or
   `node_modules`. The workflow checks that the archive installs
   (`npm ci --omit=dev --ignore-scripts`) and builds (`bb plugin build .`). It then creates
   the GitHub Release with that archive and its `.sha256`, plus generated notes.
4. To adopt the release in the tutor Feature, follow the steps in devcontainer-features'
   [`src/tutor/plugin-pin.sh`](https://github.com/lean-software-production/devcontainer-features/blob/main/src/tutor/plugin-pin.sh).
   Compute the SHA-256 yourself rather than copying the release's `.sha256`.

To build the same archive locally, run `scripts/release-archive.sh v<x.y.z> <out-dir>`, then
`scripts/check-release-archive.sh <out-dir>/bb-plugin-tutor-<x.y.z>.tgz`.

## Settings and coach tools

- `coursePath` (string): the course checkout. Empty falls back to `TUTOR_COURSE_PATH`, then the
  Feature's `/usr/local/etc/tutor/config.json`, then `/workspaces/tutorial`.
- `factoryProject` (project): the student's factory, written by the first-run page. Tutor never
  creates projects.
- `simpleNavigation` (boolean, default true): Tutor's sidebar navigation
  (`experimental_sidebarNavigation` `simple-nav`) shows BB's own rows minus Plugins and Skills.
  Off, or while settings load, it renders BB's navigation unchanged. BB uses it while
  Settings → Appearance → Navigation is Automatic or names Tutor.

## Codespace polish

- **Theme.** `bb.themes` contributes `sketchbook` (`plugin:tutor:sketchbook`): the Sketchbook
  brand's bb theme, with cream paper, ink, deep teal and Patrick Hand for the UI in light mode, an
  ink page with paper text in dark mode, and BB's own mono for code. There are light and dark code
  themes as well. `paper` (`plugin:tutor:paper`, "Tutor paper (now Sketchbook)") is the same theme
  under the old id, because Feature 0.6 and earlier default to it. It goes away in the next release.
  `themes/sketchbook.css` is the brand's `bb-theme/sketchbook/theme.css` from `vendor/brand/` with
  Patrick Hand inlined in place of its Google Fonts `@import` (a theme is one CSS file). The code
  themes are built from the kit's tokens. Don't edit the theme here: change it in the
  [brand repo](https://github.com/lean-software-production/brand), then run
  `npm run sync-brand -- <sha>` and `npm run build:assets`. A test checks the generated files are
  current, that the theme is the brand's byte for byte apart from the font, and that text keeps
  4.5:1 in both modes as BB actually paints it.
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
`execute()`, any thread Tutor did not spawn in the chosen factory project, and a coach
thread (or side chat) changes only its own lesson's progress.

## Layout

| Path | What |
|---|---|
| `server.ts` | Backend entry (factory) |
| `app.tsx` | Frontend entry (`definePluginApp`) |
| `shared/` | Model, keys, RPC contract, tool schemas, directive attributes, routes, fixtures |
| `server/course/` | Course loading: course.yaml or ledger, Gherkin, slugs, hashes, new/reworded changes, lexicon, Lesson 0 |
| `server/progress/`, `server/coach/`, `server/rpc/` | Student state, coach tools and threads, RPC handlers |
| `app/` | Course outline (`Outline.tsx`), start page, lesson and Rule cards and other directives, the jump to a Rule's section, rule tab, home section, sidebar navigation, activity reporter; `sketchbook.css`, the scoped kit (`sketch/`), fonts and the theme build |
| `themes/` | The `paper` BB theme (generated CSS) and its light code theme |
| `skills/tutor/` | The coach's skill |
| `components/`, `lib/`, `hooks/` | Vendored BB UI components (shadcn model) |

## Conventions

- Relative imports carry their extension (`./model.ts`), so `node --test` can run the sources
  directly; `@/…` aliases are for `.tsx` files only.
- Type-only imports use `import type` (enforced by `verbatimModuleSyntax`).
- Frontend code imports `shared/model.ts` and `shared/rpc.ts` with `import type` only.
- Tutor CSS stays under `.tutor-sk` with `tp-` classes and `--tp-` tokens; the kit (`app/sketch/kit.css`) is generated, scoped to `.tutor-sk`.
