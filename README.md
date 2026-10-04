# bb-plugin-tutor

Tutor is a BB plugin for a coached, Gherkin-driven course. Each student has a hosted BB server
running Tutor, and their Codespace of
[capstone-project-starter](https://github.com/lean-software-production/capstone-project-starter)
is that server's machine.

The design is [`docs/DESIGN.md`](docs/DESIGN.md), as amended by
[`docs/CHANGELOG-from-design.md`](docs/CHANGELOG-from-design.md). The module map, ownership and
contracts are in [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md).

Tutor targets bb-app **0.45.0** (`engines.bb` is `>=0.45.0`, and CI builds with exactly 0.45.0)
with plugin SDK **0.6.15**, which is pinned exactly in `devDependencies`. The plugin id is `tutor`.

## Hosted

Tutor is hosted: one BB server per student, with the student's Codespace as its machine, rather
than an all-on-the-laptop launcher. See [`docs/2026-10-04-hosted-tutor.md`](docs/2026-10-04-hosted-tutor.md)
for the design, and docs/tutor-students.md in the infrastructure repo for running and operating
student servers.

## Install

### On a student's server (the supported way)

An operator installs a release's `bb-plugin-tutor-<version>-built.tgz` (the archive with its
dependencies installed and built) into each student's BB server, with the infrastructure repo's
tools (docs/tutor-students.md in the infrastructure repo). The student's Codespace of
capstone-project-starter joins that server as its only machine, through the `bb` devcontainer
feature's `machine` mode; the student runs no Tutor command. On the first run, Tutor offers the
Codespace's checkout (`/workspaces/capstone-project-starter`, the `workspaceFolder` setting) as
the workspace and, once the student confirms, makes the BB project for it.

### Directly into a BB

```sh
bb plugin install git:https://github.com/lean-software-production/bb-plugin-tutor@v0.1.0
```

BB clones the tag, runs `npm install` with lifecycle scripts disabled, builds both bundles, and
starts the plugin. With no course configured, Tutor runs standalone: the first run offers its
built-in course and a catalog of courses to add (`server/content/catalog.ts`), and offers the
Codespace checkout as the workspace.

- **Course.** The `coursePath` setting (Settings → Plugins → Tutor) is a development-only
  override: an absolute path on the server to a course checkout, in place of the hosted catalog.
  `TUTOR_COURSE_PATH` in the BB server's environment works the same way. Leave both empty for the
  normal, hosted first-run experience.
- **Workspace.** The first-run page ranks your BB projects as workspace candidates and asks you
  to confirm one. When none is on a connected machine, it offers the connected machine's
  `workspaceFolder` checkout instead and makes the BB project for it once you confirm.
- **Everything else is up to you.** That covers selecting the course outline as the sidebar
  thread list and choosing the Sketchbook theme. Nothing reads the activity heartbeat, which
  lands in `<BB data dir>/.tutor-feature/activity`.

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
It installs bb-app from npm with `npm install --global --ignore-scripts bb-app@0.45.0`, which
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

The hosted end to end is [`e2e/hosted.sh`](e2e/hosted.sh): a student's bb-server as its own
Linux user, this user's host daemon as the "Codespace" machine, then the first run and the
lessons (`SERVER_USER=$(id -un) e2e/hosted.sh all` runs it as yourself). CI runs it too. The
older walk in [`scripts/tutor-dev/e2e/`](scripts/tutor-dev/e2e/README.md) tested the retired
tutor Feature.

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
   (`npm ci --omit=dev --ignore-scripts`) and builds (`bb plugin build .`), and packs that
   installed and built tree, under the same top-level directory, as
   `bb-plugin-tutor-<x.y.z>-built.tgz`. It then creates the GitHub Release with the archive,
   its `.sha256` and the `-built.tgz`, plus generated notes.
4. To roll the release out to student servers, follow docs/tutor-students.md in the
   infrastructure repo. Compute the SHA-256 yourself rather than copying the release's `.sha256`.

To build the same archive locally, run `scripts/release-archive.sh v<x.y.z> <out-dir>`, then
`scripts/check-release-archive.sh <out-dir>/bb-plugin-tutor-<x.y.z>.tgz` (which also writes the
`-built.tgz`).

## Settings and coach tools

- `coursePath` (string): development only. An absolute path to a course checkout on the server,
  in place of the hosted catalog; empty falls back to `TUTOR_COURSE_PATH` in the server's
  environment. A configured course wins: fetched courses are ignored and nothing is offered to
  add.
- `workspaceProject` (project): the student's workspace, the BB project holding their repo,
  where coach threads run. Written by the first-run page, which makes the project for the
  Codespace's checkout when there is none. When the workspace's machine is gone (a rebuilt or
  new Codespace enrols as a new machine), the course page offers the student's current machine's
  checkout and switches this setting to it.
- `factoryProject` (project, read only): an older Tutor's workspace setting. It is still read
  when `workspaceProject` is unset, so existing Codespaces carry on, but Tutor never writes it.
- `coachProvider` (string): the agent provider coach threads are pinned to, such as `claude-code`,
  `codex` or `pi`. Empty uses the first of Claude Code, Codex and pi that BB reports signed in
  ("ready") on the workspace's machine, on that agent's default model. With none ready, the
  coach buttons wait and say how to sign in. Leave it empty for students.
- `coachModel` (string): the model coach threads use, as `provider/model`. It applies only with
  `coachProvider` set.
- `courseCatalog` (string): the courses that can be added, as JSON: a list of
  `{ id, title, description, repo, ref }`, each `repo` an `https://` (or the operator's own
  `file://`) URL and each `ref` a tag or a full SHA. Empty uses Tutor's own catalog
  (`server/content/catalog.ts`). A fetched course goes by its entry's `id`.
- `simpleNavigation` (boolean, default true): Tutor's sidebar navigation
  (`experimental_sidebarNavigation` `simple-nav`) shows BB's own rows minus Plugins and Skills.
  Off, or while settings load, it renders BB's navigation unchanged. BB uses it while
  Settings → Appearance → Navigation is Automatic or names Tutor.

## Codespace polish

- **Theme.** `bb.themes` contributes `sketchbook` (`plugin:tutor:sketchbook`): the Sketchbook
  brand's bb theme, with cream paper, ink, deep teal and Patrick Hand for the UI, and BB's own mono
  for code. The brand is light mode only: picking dark mode in BB keeps the page paper and ink,
  and the one light code theme is named for both modes, so code blocks stay light too.
  `themes/sketchbook.css` is the brand's `bb-theme/sketchbook/theme.css` from `vendor/brand/` with
  Patrick Hand inlined in place of its Google Fonts `@import` (a theme is one CSS file). The code
  theme is built from the kit's tokens. Don't edit the theme here: change it in the
  [brand repo](https://github.com/lean-software-production/brand), then run
  `npm run sync-brand -- <sha>` and `npm run build:assets`. A test checks the generated files are
  current, that the theme is the brand's byte for byte apart from the font, that text keeps
  4.5:1 as BB actually paints it, that BB's greys stay warm rather than pink, and that every BB
  token resolves the same with BB's `.dark` class as without it.
- **Tutor's own surfaces.** The outline, cards, pages and Rule tab are drawn with the brand's
  Sketchbook kit (`vendor/brand/kit/`), scoped under `.tutor-sk` at build time
  (`app/sketch/kit.css`) so it can't restyle BB. `app/styles/*.css` sets only size and layout, and
  paints with the `--tp-*` tokens; `app/styles/scope.test.ts` enforces both. Motion stops under
  reduced motion. The UI copy follows the brand's voice (`vendor/brand/VOICE.md`), and
  `app/voice.test.ts` fails on the words it avoids.
- **Fonts.** Patrick Hand, Patrick Hand SC and Luckiest Guy are self-hosted from Fontsource 5.3.0
  (`app/fonts/`, with sha256 sums in its README). Patrick Hand and Patrick Hand SC are under the
  SIL Open Font License 1.1, Luckiest Guy under the Apache License 2.0; the licence texts are in
  `app/fonts/LICENSES/`.
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
  `ConnectionLostError` and every Tutor error surface shows "We lost the connection to your
  Codespace …" with a Reload button instead of `rpc "…" failed (HTTP 401)`
  (`app/model/rpc-errors.ts`). Tutor's and BB's own errors are unchanged.

Coach threads are spawned by Tutor directly in the workspace, and only they are offered the
`tutor` skill and the seven `tutor_*` tools (`status`, `focus_rule`, `mark_example`,
`adopt_iteration`, `complete_iteration`, `side_chat`, `fetch_course`). Each tool also refuses,
inside `execute()`, any thread Tutor did not spawn in the chosen workspace project, and a coach
thread (or side chat) changes only its own lesson's progress. `tutor_fetch_course {course}`
adds a course from the catalog when the student asks for it, as the outline's "Add the course"
does: it fetches the course into BB's data dir, seeds its starter into the workspace (writing
only files that aren't there yet) and lists its lessons after Lesson 0. Called again, it
finishes a seed that was interrupted.

## Layout

| Path | What |
|---|---|
| `server.ts` | Backend entry (factory) |
| `app.tsx` | Frontend entry (`definePluginApp`) |
| `shared/` | Model, keys, RPC contract, tool schemas, directive attributes, routes, fixtures |
| `server/course/` | Course loading: course.yaml or ledger, Gherkin, slugs, hashes, new/reworded changes, lexicon, Lesson 0 |
| `server/progress/`, `server/coach/`, `server/rpc/` | Student state, coach tools and threads, RPC handlers |
| `app/` | Course outline (`Outline.tsx`), start page, lesson and Rule cards and other directives, the jump to a Rule's section, rule tab, home section, sidebar navigation, activity reporter; `sketchbook.css`, the scoped kit (`sketch/`), fonts and the theme build |
| `themes/` | The Sketchbook BB theme (generated from the vendored brand) and its light code theme |
| `vendor/brand/` | The brand at its pin (`PIN`): the bb theme, the kit and `VOICE.md`; refreshed by `npm run sync-brand` |
| `skills/tutor/` | The coach's skill |
| `components/`, `lib/`, `hooks/` | Vendored BB UI components (shadcn model) |

## Conventions

- Relative imports carry their extension (`./model.ts`), so `node --test` can run the sources
  directly; `@/…` aliases are for `.tsx` files only.
- Type-only imports use `import type` (enforced by `verbatimModuleSyntax`).
- Frontend code imports `shared/model.ts` and `shared/rpc.ts` with `import type` only.
- Tutor CSS stays under `.tutor-sk` with `tp-` classes and `--tp-` tokens; the kit (`app/sketch/kit.css`) is generated, scoped to `.tutor-sk`.
