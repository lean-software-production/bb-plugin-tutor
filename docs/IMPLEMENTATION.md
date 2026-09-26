# Tutor MVP: implementation map

This is the builders' shared map for the MVP on branch `tutor/mvp`. It says who owns which files,
and it pins down every contract between them. [`DESIGN.md`](DESIGN.md) says what to build and
[`CHANGELOG-from-design.md`](CHANGELOG-from-design.md) overrides it where they differ. The UX is
[`mockups.html`](mockups.html), round 2, with these picks: sidebar **1B** (now one course outline
tree), lesson **2A** (now the lesson card leading the coach thread in BB's own thread view), coach
moments **3A**, and example states **6B** (now also the Rule card). Choice buttons (3B) are not
built. Words follow [`GLOSSARY.md`](GLOSSARY.md), in the code as in the prose; the course repo's
`docs/iterations/`, the factory's `ITERATION`, PROGRESS.yaml's `iteration` key and the
`tutor_*_iteration` tools keep the course's own word.

The plugin is this repository (npm `bb-plugin-tutor`, plugin id `tutor`); during the MVP build it
lived at `src/tutor/plugin` in devcontainer-features. It targets bb-app
0.43.4 and pins `@get-bb/plugin-sdk` to exactly 0.5.9.

## Ownership

Four builders work in parallel. Each one writes only inside their own paths. Everything else is
read-only to them. If a contract below has to change, stop and report it; don't edit someone
else's file.

| Path (in this repo, unless it links to devcontainer-features) | Owner | Notes |
|---|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `components.json` | skeleton | Frozen. Every runtime dependency is already installed (see [Dependencies](#dependencies)). |
| `shared/**` | skeleton | Read only. The contracts. |
| `components/`, `lib/`, `hooks/` | skeleton | Vendored BB UI (shadcn model). The frontend may *use* these, and may add new files under `components/ui/`. |
| `README.md`, `PLUGIN_OVERVIEW.md` | skeleton | Builders can suggest changes in their report. |
| `server/course/**` | **CONTENT** | Implements `CourseSource`. Also owns Lesson 0's content. |
| `server.ts`, `server/progress/**`, `server/coach/**`, `server/rpc/**`, `test/**` (plugin-level integration tests), `skills/tutor/SKILL.md` | **BACKEND** | Replaces the stub `server.ts`. |
| `app.tsx`, `app/**` (including `paper.css` and `fonts/`) | **FRONTEND** | Replaces the stub `app.tsx`. Component CSS goes in `app/styles/`. |
| [`src/tutor/{devcontainer-feature.json,install.sh,bin/,README.md,NOTES.md}`](https://github.com/lean-software-production/devcontainer-features/tree/main/src/tutor), [`test/tutor/**`](https://github.com/lean-software-production/devcontainer-features/tree/main/test/tutor), [`.devcontainer/tutor/**`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor), [`test/tutor/fixtures/scripted-provider/`](https://github.com/lean-software-production/devcontainer-features/tree/main/test/tutor/fixtures/scripted-provider) (all in devcontainer-features) | **FEATURE** | The feature, its tests, the codespace entry point, and the end-to-end fixture. |

Everyone may read the course repo at `work/tutorial`, but must not modify it. The containerised BB
harness is [`scripts/tutor-dev/`](../scripts/tutor-dev/README.md). Keep its README's rules, and don't change the scripts; ask
instead.

## Rules for everyone

- **Quality bar:** TypeScript strict (plus `noUncheckedIndexedAccess`), small focused modules, no
  dead code, and comments only where something isn't obvious.
- **Tests:** unit tests for all logic, run with `node --test`. Put them next to the code as
  `*.test.ts`. `npm test` picks up `shared/**`, `server/**`, `app/**` and `test/**`.
- **Imports:** relative imports carry their extension (`../shared/model.ts`), so node can run the
  sources directly. The `@/…` alias only works in bundled `.tsx`. Type-only imports use
  `import type`; `verbatimModuleSyntax` enforces this. Only erasable TypeScript is allowed: no
  enums, namespaces or parameter properties.
- **Node can't run `.tsx`.** Frontend logic goes in plain `.ts` modules (view models, formatters,
  routing) with tests. Keep the `.tsx` components thin. Nothing that a node test imports may
  import `@get-bb/plugin-sdk/app` or React at runtime.
- **Before you report:** `npm ci`, `npm run typecheck`, `npm test` and `bb plugin build .` must
  all pass. Build inside the harness: `TUTOR_DEV_CWD=$PWD
  scripts/tutor-dev/bb.sh plugin build $PWD`. For live checks, run
  `scripts/tutor-dev/install-plugin.sh .` and then `node scripts/tutor-dev/shot.mjs …`.
- **Hard rules** (from the brief): never touch the host BB at 127.0.0.1:38886, never copy provider
  credentials, never commit, and only write inside `work/` and `$TMPDIR`.

## Dependencies

The skeleton owns these, and they are all installed. Don't add any.

| Package | For |
|---|---|
| `@cucumber/gherkin`, `@cucumber/messages` | Parsing feature files (CONTENT). `new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher())` |
| `yaml` | course.yaml, lexicon.yaml (CONTENT); PROGRESS.yaml (BACKEND) |
| `diff` (v9, typed) | `factoryDiff` line diff (CONTENT) |
| `zod` (v4) | Schemas in `shared/`; RPC and tool validation |
| `@get-bb/plugin-sdk` 0.5.9 (dev) | Types, `defineRpcContract`, `@get-bb/plugin-sdk/testing` (`createFakePluginHost`) |
| Vendored-UI deps (`@radix-ui/*`, `@hugeicons/*`, `clsx`, …) | Already used by `components/ui/` |

## The shared modules

| Module | Holds | Runtime import allowed from the frontend? |
|---|---|---|
| `shared/constants.ts` | Plugin, skill, tool, realtime-channel, directive, slot and setting names; env and config paths; factory and course file paths; `BUILTIN_LESSON_ID`; `coachThreadTitle()` | yes |
| `shared/keys.ts` | `slugify`, `uniqueSlugs`, `featureSlugFromPath`, `ruleKey`, `exampleKey`, `parseExampleKey`, `ruleKeyOfExample`, key patterns | yes |
| `shared/model.ts` | zod schemas and types for Course → Lesson → FeatureFile → Rule → Example → Step, LexiconEntry, IterationState, ProgressFile, ExampleProgress, StudentState, CoachThreadMetadata, and the derived enums and counts | **type only** |
| `shared/derive.ts` | `exampleStatus`, `countExamples`, `ruleStatus`, `lessonExamples`, `findLesson`, `nextLesson`, `findRule`, `findExample`, `resolveCurrent`, `lessonStatus` | yes (pure; imports only types from the model) |
| `shared/rpc.ts` | `rpcContract`, plus payload schemas and types (Overview, LessonDetail, Completion, FactoryProject, TutorThread, …) and `StateChangedSignal` | **type only** |
| `shared/tools.ts` | `toolParameterSchemas` for the six coach tools, and length limits | backend only |
| `shared/directives.ts` | `parseLessonRef`, `formatLessonRef`, `parseProgressCard`, `formatProgressCard`, `parseTermRef`, `formatTermRef`, `ruleAnchor` and `RULE_ANCHOR_ATTRIBUTE` (zod-free) | yes |
| `shared/routes.ts` | `parseRoute` and `formatRoute` for the navPanel sub-paths | yes |
| `shared/ports.ts` | `CourseSource`, `ProgressStore`, `CourseLoadError` | backend only |
| `shared/fixtures.ts` | Schema-valid fixtures: `fixtureCourse` (000–003), `fixtureStudent` (002 WIP), `fixtureFreshStudent`, `fixtureOverview`, `fixtureOverviewUnbound`, `fixtureLesson`, `fixtureCompletion`, `fixtureCandidates`, `fixtureLexicon`, `fixtureThreads`, `fakeHash` | tests and the stub only |

## Contracts

### Keys, slugs and hashes (CONTENT produces, everyone consumes)

- **Rule key:** `<feature-file-slug>/<rule-slug>`. **Example key:**
  `<feature-file-slug>/<rule-slug>/<example-slug>`. The feature-file slug is the file's basename
  without `.feature`, slugified. Rule and Example slugs are their names, slugified, then made unique
  among siblings in file order with `uniqueSlugs` (`-2`, `-3`, …). Always use the helpers in
  `shared/keys.ts`; never hand-roll a key.
- Examples directly under a Feature, outside any Rule, are grouped into a synthetic Rule. Its slug
  is `LOOSE_EXAMPLES_RULE_SLUG` (`general`), its name is the Feature's name, and it comes first.
- A Scenario Outline is one Example. It is not expanded.
- **Example text hash:** `sha256:` followed by the lowercase hex SHA-256 of the UTF-8 text built
  like this, with lines joined by `\n`:
  1. the Example's name;
  2. for each step, `<keyword> <text>`, keyword as written (`Given`, `And`, …);
  3. for a docstring, a line `"""<mediaType or empty>`, then its content lines, then `"""`;
  4. for a data table, each row as its cells joined by ` | `.

  Every line has its whitespace runs collapsed to one space and is then trimmed. Tags, the
  description, line numbers and Background steps are left out. So rewording a step changes the
  hash, and re-indenting or moving the Example doesn't.
- **New and reworded** Examples: each lesson is compared with the previous lesson in course order, as
  documented on `changeSchema`. Everything in Lesson 0 and in the first real lesson is `new`.
- **`suggestedRuleOrder`:** every Rule key exactly once. Rules that are not `unchanged` come
  first, then the rest, each group in file order. Files are sorted by path.
- **`factoryDiff`:** the FACTORY.md line diff against the previous non-builtin lesson. It is
  `null` for Lesson 0 and for the first real lesson.
- **`dek`:** the first prose paragraph of README.md, skipping the `#` title and any italic
  *Set after…* line.

### Course loading (CONTENT implements `CourseSource`)

`createCourseSource(): CourseSource` is exported from `server/course/index.ts`. The backend
imports only that file. `loadCourse(coursePath)` works as follows:

1. **`course.yaml`**, when present, has the shape given in DESIGN.md: `id`, `title`, optional
   `description`, `coach`, optional `lexicon`, and `lessons[]` with `{ id, title, set, dir }`.
2. **Otherwise the ledger fallback.** Parse the table in `docs/iterations/README.md`: the
   `Iteration` column is the id, the `Spec` link text is the title and its target's directory is
   `dir`, and the optional `Set after` column is `set`. Then `id` is `slugify(basename(coursePath))`, `title` is the
   course README's first `#` heading (or the id), `description` is null, `coach` is
   `.agents/coach-me.md` if it exists, and `lexicon` is `docs/lexicon.yaml` if it exists. A course
   with no coach file of its own (the tutorial dropped `.agents/coach-me.md`) is coached with the
   capstone starter's skill instead: `server/coach/coach-file.ts` falls back to
   `<realpath(factory)>/../.agents/skills/coach-me/SKILL.md` when that file exists.
3. **Lesson 0** ("Using your tutor", id `000`, set `Start here`, `builtin: true`) comes first. Its
   content lives in `server/course/builtin/`: a `course.yaml` naming `lesson-0/`, which holds
   `README.md`, `features/*.feature` and a short `FACTORY.md`. Find its directory from `import.meta.url`, not the working directory. Its
   Examples teach the interface, for example "When you ask a side question about the Rule in
   focus, then a side chat opens in the "Side chat" tab beside your coach thread".
4. **Lexicon:** each YAML key becomes `{ id, term, definition }`. A missing lexicon gives `[]`.
5. **Errors:** throw `CourseLoadError` with a message the student can read, naming the file and line
   where there is one.

Test against small fixture courses under `server/course/fixtures/`. Gate an integration test on
the real tutorial repo behind `TUTOR_TEST_COURSE=/path/to/tutorial`, and skip it when that is unset.

### Where things are (FEATURE writes, BACKEND reads)

- **Course path** is resolved in this order: the `coursePath` setting, then the
  `TUTOR_COURSE_PATH` env var, then `course` in `/usr/local/etc/tutor/config.json`, then
  `/workspaces/tutorial`.
- **Factory hint:** the `TUTOR_FACTORY_PATH` env var, then `factory` in the config file. It is used
  only to pre-select a candidate project whose default local source path matches.
- **The factory project** is always a BB project id, stored in the `factoryProject` setting (`type:
  "project"`), which `confirmFactory` writes with `settings.experimental_set`. The plugin never
  creates projects. When none is set, the factory project is `unset`; one that resolves is
  `found`. A stored id whose project, or whose local source, has gone is `missing`.
- **The feature's `install.sh`** writes the config file as JSON
  `{ "course": "…", "factory": "…", "dataDir": "…" }`, leaving out any key whose option is empty.
  `dataDir` is the bb Feature's BB state directory (or `$_REMOTE_USER_HOME/.bb` when that option is
  empty), the last fallback for the heartbeat below. It also path-installs the plugin in a
  `postStartCommand` that runs after `bb-feature-autostart`, from a user-owned copy at
  `<dataDir>/.tutor-feature/plugin-<digest>` (BB rebuilds `dist/` on every path install, so the
  root-owned image copy cannot be installed directly), and skips the install when the plugin is
  already installed from that path. If BB exposes a way to select the course outline under
  Settings → Appearance → Sidebar, the feature does that too. Otherwise the first-run page tells the
  student how.

- **Activity heartbeat (shared with the feature's keep-alive).** `<BB data dir>/.tutor-feature/activity`
  (`ACTIVITY_FILE`) holds one line, an ISO-8601 UTC timestamp of the last time the student was
  actively using BB. The plugin's `heartbeat` RPC writes it atomically, creating the directory
  0700, at most every 30 s; the data dir is `bb.server.experimental_dataDir`, then `BB_DATA_DIR`,
  then `dataDir` in the config file. The app-wide content script `activity` (`app/activity.ts`)
  calls it at most every 45 s while the page is visible and the student interacted in the last
  60 s. `/usr/local/bin/tutor-keepalive`, run by [`.devcontainer/tutor`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor)'s `postAttachCommand`,
  treats a stamp under 120 s old as active and prints a line to its terminal every 30 s.
- **Once per BB state directory, the feature's start-up hook** also switches off the plugins in its
  `disablePlugins` option (recorded per id in `.tutor-feature/plugins-disabled`, so a student can
  turn one back on) and selects the `theme` option (`plugin:tutor:paper`) while BB's default theme
  is active (`.tutor-feature/theme-selected`).

### Student state (BACKEND implements `ProgressStore` in `server/progress/`)

The factory follows the layout of `lean-software-production/capstone-project-starter`: the
student's fork is the Git repo, `tetris/` is the codebase the factory builds, and `tetris/.factory`
is the factory, the coach's working folder and the BB project. The factory holds `ITERATION`,
`spec/` (the adopted lesson and `PROGRESS.yaml`) and the fetched, gitignored `stand-ins/`; the
sample seed lives beside it, in `tetris/seeds/tetris.md`. Tutor's adoption leaves the same files
in the same places as the starter's `fetch-iteration` skill (`fetch.sh`), from the course checkout
on this machine, so a student can move between the two.

- **`ITERATION`**, at the factory root, is one line, `NNN WIP` or `NNN Done`. It is canonical
  (decision 1) and is never written for Lesson 0. Factories from before the starter layout kept it
  in `spec/ITERATION`: it is read when there is no root file, and removed once the root one is
  written, but only when `spec/` is a real folder, never through a symbolic link.
- **`spec/PROGRESS.yaml`** follows `progressFileSchema`. It extends the design with four additive
  fields: `adopted` (when the iteration was adopted), `summary` (the coach's text from
  `tutor_complete_iteration`), per Example `carriedFrom`, and `history`: on adopt, the previous
  lesson's `adopted`, `summary` and Example entries (without `evidence`) are kept under its id, so
  done lessons' start and completion pages stay truthful. Write it with the ids quoted
  (`iteration: "003"`), so YAML never reads them as numbers. Keep a stable key order: `iteration`,
  `focus`, `adopted`, `summary`, `examples`, `history`. Sort `examples` by key and `history` by id.
  Write it atomically. Only the coach tools write it.
- **Reading never throws.** Malformed content goes into `StudentState.problems`, with the part that
  couldn't be read set to null.
- **Stale progress:** when `progress.iteration` differs from the current lesson (see
  `resolveCurrent`), treat the progress map as `{}` for that lesson. Read-side views of a done
  lesson use its `history` entry instead.
- **Current lesson:** `resolveCurrent` and `lessonStatus` in `shared/derive.ts` decide it. The
  backend must not reimplement them. Lesson 0 is under way when PROGRESS.yaml says `"000"`, and it
  is Done once all of its Examples are passing or skipped. With no state at all, the student is on
  Lesson 0 and `not-started`.
- **Carry-over on adopt:** every Example of the new lesson whose hash matches a **passing** entry
  in the previous PROGRESS.yaml, under any key, starts as `passing`. It keeps that entry's
  `evidence` and `at`, and gets `carriedFrom: <entry.carriedFrom ?? previous iteration>`. Every
  other Example has no entry, which means pending. The focus becomes the first entry of
  `suggestedRuleOrder`.
- The backend re-reads state on `thread.idle` for Tutor threads and on every RPC call. When the
  state changes, it publishes `REALTIME_CHANNELS.stateChanged` with a `StateChangedSignal`.

### Coach threads and tools (BACKEND, `server/coach/`)

- **Coach thread per lesson:** `bb.sdk.threads.spawn({ projectId: <factory project>, environment: { type:
  "host", hostId: <factory source's host>, workspace: { type: "unmanaged", path: <factory root> } },
  title: coachThreadTitle(id), pluginMetadata: { course, lesson, role: "coach" }, prompt })`. The
  unmanaged workspace guarantees the coach edits the folder Tutor reads, even when the project
  defaults to worktrees. `openCoach` finds it again, under the coach-thread lock, in this order:
  `threads.list({ originPluginId: bb.pluginId, projectId, archived: false, includeHidden: false,
  hasParent: false })` filtered by metadata (`listCoachThreads`: no side chats or side threads in
  it), where the newest coach thread that isn't archived wins, as it does in the outline and on the
  start page; if that finds none, the lesson's record in `bb.storage.kv` (`coach-record.ts`, key
  `coach-thread:<project>:<course>:<lesson>`, written whenever a coach thread is found or spawned),
  trusted only while `threads.get` shows that thread live, in the factory project, structurally
  Tutor's coach thread and with that course and lesson in its metadata; else the listing a second
  time before spawning. The record and the second listing are there because `threads.list` pages by
  offset only (no cursor in SDK 0.5.9) and can skip a row when others vanish between pages. Every listing of Tutor's threads and of a coach thread's side chats
  reads every page (`listAllThreads`: 200 rows a call, de-duplicated by id) and throws a readable
  error past 10 000 threads rather than page forever.
- **Side chats** (`server/coach/side-chats.ts`): what BB's built-in side-chat plugin does.
  `bb.sdk.threads.fork({ sourceThreadId: <coach>, lifecycleOwnerThreadId: <coach>, visibility:
  "hidden", title, pluginMetadata: { course, lesson, role: "sideChat", ruleKey? }, agentContextSeed:
  [{ type: "text", text, mentions: [], visibility: "agent-only" }] })`, a seed-only fork that stays
  idle until the student writes in it and reuses the coach's environment. Then the tab BB writes for
  "Reply in side chat", appended with `threads.tabs.update` (retried up to 3 times on
  `thread_tabs_conflict`): `{ id: "plugin-panel:" + encodeURIComponent("side-chat:side-chat:" +
  paramsJson) + ":none", kind: "plugin-panel", pluginId: "side-chat", actionId: "side-chat", title:
  "Side chat", paramsJson: { threadId, sourceThreadId, sourceMessageText, sourceSeqEnd: null } }`.
  Both the button (`startSideChat`) and `tutor_side_chat` go through `openSideChat`: if the tab
  write fails, it reads the coach thread's tabs again, because BB may have stored the write despite
  the error, or another client may have written the same tab. A tab showing the fork means success.
  Only a fork confirmed tab-less is archived before the error surfaces; if archiving fails too the
  error names both, and if the tabs can't be read the fork is left alone. A plugin cannot select another plugin's tab, so the frontend points to it with a
  toast. A provider that cannot fork gets a readable error; there is no fallback. The side chats of a coach
  thread are its live hidden forks (`threads.list({ sourceThreadId, includeHidden: true })`), BB's
  own included. Side threads spawned before side chats (children, `parentThreadId`) still list.
- **A fork is never the coach thread.** A thread's role comes from its structure (`threadRole`): a
  fork or a child is `sideChat`, whatever its metadata says, and a hidden thread that forks nothing is
  not listed.
- **Reached Rules:** `tutor_focus_rule` adds the Rule to the coach thread's `reachedRules` metadata
  (lenient read, at most 500). The coach puts the Rule card at the top of the message that turns to
  the Rule, so these are the Rules with a section to jump to. They live on the coach thread, not in
  `PROGRESS.yaml`, because a section exists only in that thread: a new coach thread (or coaching
  outside BB) has none, and carry-over needs nothing.
- **Metadata is untrusted.** It is fine for listing threads and filling the outline, and for knowing
  which lesson a verified coach thread coaches (below). It must never decide whether a thread is
  Tutor's.
- **`configure`** is synchronous. It offers `ALL_TOOL_NAMES` and `SKILL_ID` when
  `ctx.origin.pluginId === bb.pluginId`, and to a fork whose `sourceThreadId` is a coach thread Tutor
  has seen (`server/coach/coach-registry.ts`, filled by listings and spawns, warmed at start).
- **Every `execute()`** re-checks the calling thread with BB (`server/coach/auth.ts`,
  `coachThreadOf`): a Tutor coach thread; a hidden fork of one (Tutor's side chat, or BB's, which
  counts as a side chat of that lesson without a Rule); or a child Tutor spawned under one. It
  returns `{ content: [{ type: "text", text }], isError: true }` for anything else, a visible fork
  or a fork of a side chat included. Only the coach thread itself moves the focus. The caller's
  lesson is the one its coach thread's Tutor metadata names (Tutor wrote it at spawn; side chats
  inherit it, and a fork's own metadata is never read for it). `tutor_focus_rule`,
  `tutor_mark_example` and `tutor_complete_iteration` refuse unless that is the current lesson;
  `tutor_adopt_iteration` adopts only the caller's lesson; `tutor_side_chat` files the side chat
  under the caller's lesson; `tutor_status` names the caller's lesson and says when it isn't the
  current one. The current lesson and the factory root are re-derived from the factory project and
  the repo. Tool output stays bounded: a few KB.
- **Tools** use the parameter schemas in `shared/tools.ts`:

  | Tool | Does | Returns |
  |---|---|---|
  | `tutor_status` | Current lesson, focus, and each Rule's Examples with key, status and name | Compact text the coach can act on, listing keys |
  | `tutor_focus_rule` | Sets `focus` and records the Rule as reached. Coach thread only; side chats get `isError` | The Rule card, a `formatProgressCard({ kind: "focus", … })` line to put at the top of the next message |
  | `tutor_mark_example` | Sets one Example's status; `evidence` is required for passing and `note` for not-yet (the schema enforces this) | The matching `::tutor-progress` line: `rule-passing` when the Rule just went all-green, otherwise `example-passing` or `not-yet` |
  | `tutor_adopt_iteration` | Only the caller's own lesson, and only the lesson after a Done one, or the first, or the current lesson when it is WIP with no progress recorded (set going by `fetch-iteration` outside BB; a `spec/PROGRESS.yaml` that can't be read or parsed is not "none", and is never adopted over). Does what `fetch.sh` does, from the local course. Every check runs first, so a refusal writes nothing: a factory that holds `.git` itself (an old-layout factory) is refused, as are a `spec/`, `stand-ins/`, `../seeds/` or seed that is a symbolic link and a `../seeds/` overlapping the course. Then it replaces only README.md, FACTORY.md and features/ in `spec/`, leaving its other files alone (staged in `spec/.tutor-adopting/` and swapped in only once all copied, the old ones moved aside into `spec/.tutor-previous/` meanwhile, so a lesson missing README.md or its features leaves the previous snapshot intact; the old files are deleted only once the swap finished or all are back, else kept there and named in the error; each adoption first moves back from those folders whatever is missing, never overwriting, and removes them, a symbolic link among them removed unread); copies `spec.md` to `../seeds/<codebase>.md` (`tetris/seeds/tetris.md`) only if that file is absent; refreshes `stand-ins/` wholesale from the course's `stand-ins/` the same staged way (its working folders inside `stand-ins/`, links copied as links; a course without one leaves it alone); then writes ITERATION `NNN WIP` and a fresh PROGRESS.yaml with carry-over. Lesson 0 writes only PROGRESS.yaml. **Does not commit**: the coach commits `spec/`, `../seeds/` and `ITERATION` as "Adopt spec for iteration NNN", as `fetch-iteration` does | Summary, the commit to make, and the `git show --stat` hint |
  | `tutor_complete_iteration` | Writes ITERATION `NNN Done` and PROGRESS `summary`. Lesson 0 instead requires every Example to be passing or skipped | A `lesson-complete` card line, and the commit to make: the implementation, `ITERATION` and `spec/PROGRESS.yaml` as "Implement homework NNN" |
  | `tutor_side_chat` | Forks a side chat of the coach thread, with the question as its seed, and adds its tab (see above) | The new side chat's id, and where the student finds it |

- **Dispatch guard:** an `experimental_hooks` `message.dispatch` handler queues, with a reason, the
  turn of any Tutor thread (side chats included, BB's own too) whose project has another one still
  running.
- **Prompts:** the coach thread's first prompt names the lesson, tells the coach to follow the
  `tutor` skill and carries the lesson card line (`::tutor-lesson{lesson="NNN"}`) for its first
  reply to open with. For `startNextLesson`, it also tells the coach to call
  `tutor_adopt_iteration` first.
- **The skill** (`skills/tutor/SKILL.md`) explains the BB-specific behaviour: the tools, the
  evidence rules, the lesson card and Rule cards, when to emit `::tutor-progress` and
  `::term{id=…}` (lexicon ids only), side chats, and that only the coach thread moves the focus.
  It tells the coach to follow the course's `coach` file, or else the starter's `coach-me` skill,
  as its coaching method, and that "jfdi" remains a phrase the student types. It maps the
  starter's `fetch-iteration` / `fetch.sh` to `tutor_adopt_iteration`, and it and the coach
  instructions forbid running them or editing `ITERATION` or `spec/PROGRESS.yaml` by hand: the
  `tutor_*` tools own them.

### RPC (BACKEND serves `server/rpc/`, FRONTEND calls)

`shared/rpc.ts` is the contract. It includes the semantics of each method, and every payload shape
is a zod schema. The methods are `getOverview`, `getLessonDetail`, `getCompletion`, `getThreadContext`,
`getLexicon`, `listCandidateProjects`, `confirmFactory`, `openCoach`, `startNextLesson`,
`startSideChat` (a BB side chat of the coach thread, returning `{ coachThreadId, sideChatId }`),
`ensureSideChatTab` (puts a closed side chat tab back), `redirectFocus` and `heartbeat` (records
student activity; never an error the student sees). Every lesson in `getOverview` carries its
`coachThreadId` and outline with each Rule's `reached`; `getLessonDetail` carries `reachedRules`. Handlers fail by throwing an `Error` whose message the
student can read. When the course is missing, `getOverview` must still succeed, returning
`course: null` and `courseError`. It never throws for an unset factory project.

### Realtime

There is one channel, `REALTIME_CHANNELS.stateChanged` (`"state-changed"`), whose payload is a
`StateChangedSignal`. Frontends refetch whatever they show when it fires; the payload is a hint,
not data.

### Frontend surfaces (FRONTEND, `app/`)

| Slot (ids in `SLOT_IDS`) | Screen | Data |
|---|---|---|
| `experimental_threadList` `course-outline` | The course outline (`app/model/outline.ts`, `app/ui/Outline.tsx`): brand; one tree of every lesson (id, title, n/m and a thin bar, ✓ ● ○ status; the current one and the one on screen expanded); under it the coach thread row (or "Start with your coach", or a link to the start page), the coach thread's Rules grouped by feature with ✓ ! ○ ● glyphs, greyed and not clickable until reached, then its side chats (`↳`, "from: <Rule>") and "Ask a side question"; then Other threads | `getOverview` (coach thread, outline, `reached`), plus `experimental_useSidebarThreads` for live status, BB's side chats (hidden forks with `sourceThreadId`) and non-course threads. A Rule opens its section (`useOpenRule`); a side chat opens its coach thread after `ensureSideChatTab`. |
| `navPanel` `course` at path `course` | `""` redirects to the current lesson route or to `welcome`; `start/NNN[/<rule>]` opens the coach thread when there is one (at the Rule's section if the route names a reached Rule; once per history entry, so Back doesn't bounce), else it is the start page (the paper lesson, 6B, and "Start with your coach", which opens the new thread); `complete/NNN` is 7; `welcome` is 8 | `getLessonDetail`, `getCompletion`, `listCandidateProjects`, `confirmFactory`, `openCoach`, `startNextLesson` |
| `messageDirective` `tutor-lesson`, `tutor-progress` and `term` | The lesson card (lesson title, dek, tally, every Rule by feature with live status; reached Rules jump to their section); 3A progress cards, where `focus` is the Rule card (annotated Gherkin with live status, Examples collapsible, "Ask a side question", and the anchor `data-tutor-rule-anchor="<message.threadId>|<lesson>/<rule>"`); lexicon chips | `parseLessonRef` / `parseProgressCard` / `parseTermRef` (render nothing unvalidated; return the plain source when parsing fails), `getLessonDetail`, `getLexicon` (cache it) |
| `threadPanelAction` `rule-tab` | 2C / 4, optional and never opened by Tutor itself: the Rule in focus (or the side chat's `ruleKey`), with Back to coach, Show in the conversation and Work on this Rule next | `getThreadContext`, `getLessonDetail`, `redirectFocus` |
| `homepageSection` `continue` | 5: Continue with your coach, and the start page while there is no coach thread | `getOverview` (finds the coach thread itself; `projectId` is usually null) |
| `experimental_sidebarNavigation` `simple-nav` | BB's own navigation rows minus Plugins and Skills, activated through BB; renders BB's original while the `simpleNavigation` setting (boolean, default true) is off or loading | `useSettings` |
| content script `activity` | none: reports activity for the keep-alive (see "Where things are") | `heartbeat` |

- **Theme:** `bb.themes` contributes `paper` (`THEME_ID`; BB lists it as `plugin:tutor:paper`), a
  light and dark mapping of the workbook palette onto BB's tokens, with Archivo inlined.
  `themes/paper.css` is generated from `app/theme/paper.palette.css` by `npm run fonts`.
- **Jumping to a Rule's section** (`app/model/rule-jump.ts`, pure and tested; DOM hooks in
  `app/rule-jump.ts`): open the coach thread, then look for the anchor in the scroller holding the
  thread's timeline rows (`[data-timeline-row-id^="<thread>:"]` and their scrollable ancestor, never
  BB's hashed classes). While it is missing, scroll that timeline to its top so BB loads older
  history, until the anchor appears, 20 s pass, or it has scrolled to the top 40 times (an
  unchanged height doesn't stop it: BB can show its loading row for seconds). Then
  `scrollIntoView({ block: "start" })` and a brief highlight. Leaving the thread or scrolling by
  hand cancels it; not finding it is a toast, never an error.
- **Lost connection:** `useTutorRpc` turns a response that is not one of BB's JSON errors (for
  example the Codespaces port-forwarding proxy's empty 401) or a fetch `TypeError` into
  `ConnectionLostError` (`app/model/rpc-errors.ts`); every error surface then says the connection
  to the Codespace was lost and offers Reload, never a raw "HTTP 401".

- **CSS:** `app/paper.css` holds the fonts and tokens. Wrap plugin-owned markup in
  `.tutor-paper`. Use `.tutor-grid` for grid-paper backgrounds that may contain BB components; it
  sets nothing that inherits. `.tutor-nav` is a third root, for the simple navigation, which uses
  BB's tokens and no paper typography. Classes are `tp-*` and tokens are `--tp-*`: BB's theme uses unprefixed
  names such as `--ink`, and a bare token would leak into BB's own components. Never style BB's
  chat. Light mode only.
- **Fonts:** `app/fonts/fonts.css` is generated (`npm run fonts`), because `bb plugin build` has no
  loader for `.woff2`. A test checks that it is current.
- **Directives are leaf directives:** each one sits on its own line and renders as a block. So
  `::term` is a small chip that pops up the definition. It cannot be an inline word in a sentence
  as mocked.

### End-to-end (FEATURE)

- The credential-free provider is the spike's scripted provider, copied to
  [`test/tutor/fixtures/scripted-provider/`](https://github.com/lean-software-production/devcontainer-features/tree/main/test/tutor/fixtures/scripted-provider) in devcontainer-features. It opens each reply with the prompt's `::`
  lines and those of its successful tool results (so the lesson card and Rule cards lead as a coach
  writes them), and a `CALL <tool> {json}` line makes a real tool call whose JSON matches
  `toolParameterSchemas`. It forks at the tip, so BB side chats work. Real Claude Code and Codex are
  never used in tests.
- The feature's scenarios live in [`test/tutor/`](https://github.com/lean-software-production/devcontainer-features/tree/main/test/tutor) and follow the `test/bb/` conventions. The
  codespace entry point is [`.devcontainer/tutor/devcontainer.json`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor/devcontainer.json): `bb`, the `claude-code`,
  `codex` and `pi` agent CLIs, and `tutor`, cloning the public tutorial repo and the upstream
  `capstone-project-starter` (the `starter` / `starterRepo` options) at start-up, with `factory`
  set to the starter's `tetris/.factory`. The start-up hook registers a dot-folder factory as the
  BB project `<parent>/<name>` ("tetris/.factory").
  `sync-features.sh` copies every `./features/<id>` it names from `src/<id>`.

## Stubs to replace

- `server.ts`: `TODO(backend)`. It serves the fixtures over the real contract, registers the six
  tools (which refuse), and scopes `configure`.
- `app.tsx`: `TODO(frontend)`. It registers every slot with a placeholder.
- `skills/tutor/SKILL.md`: `TODO(backend)`.
