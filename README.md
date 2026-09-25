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
npm run fonts          # regenerate app/fonts/fonts.css after changing a .woff2
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

Coach threads are spawned by Tutor directly in the factory folder, and only they are offered the
`tutor` skill and the six `tutor_*` tools (`status`, `focus_rule`, `mark_example`,
`adopt_iteration`, `complete_iteration`, `side_thread`). Each tool also refuses, inside
`execute()`, any thread Tutor did not spawn in the bound factory project.

## Layout

| Path | What |
|---|---|
| `server.ts` | Backend entry (factory) |
| `app.tsx` | Frontend entry (`definePluginApp`) |
| `shared/` | Model, keys, RPC contract, tool schemas, directive attributes, routes, fixtures |
| `server/course/` | Course loading: course.yaml or ledger, Gherkin, slugs, hashes, novelty, lexicon, Homework 0 |
| `server/progress/`, `server/coach/`, `server/rpc/` | Student state, coach tools and threads, RPC handlers |
| `app/` | Rail, lesson page, directives, rule tab, home section; `paper.css` and fonts |
| `skills/tutor/` | The coach's skill |
| `components/`, `lib/`, `hooks/` | Vendored BB UI components (shadcn model) |

## Conventions

- Relative imports carry their extension (`./model.ts`), so `node --test` can run the sources
  directly; `@/…` aliases are for `.tsx` files only.
- Type-only imports use `import type` (enforced by `verbatimModuleSyntax`).
- Frontend code imports `shared/model.ts` and `shared/rpc.ts` with `import type` only.
- Paper CSS stays under `.tutor-paper` / `.tutor-grid` with `tp-` classes and `--tp-` tokens.
