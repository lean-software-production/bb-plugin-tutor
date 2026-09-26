# Changes from the approved design

This log covers the MVP build, made while the owner was away. It records every place where the
build diverges from [`DESIGN.md`](DESIGN.md) as reviewed in PR #4, and why. Entries are
newest-first.

## Plugin moved to its own repo (2026-09-26)

2026-09-26: plugin moved to its own repo; the tutor Feature installs a pinned release.

- **The plugin is `lean-software-production/bb-plugin-tutor`**, extracted with its history from
  `src/tutor/plugin` in devcontainer-features. These docs moved with it from `docs/tutor/`, and the
  local harness from `scripts/tutor-dev/`. The Feature, its tests and the Codespace entry point stay
  in devcontainer-features ([`src/tutor`](https://github.com/lean-software-production/devcontainer-features/tree/main/src/tutor)).
- **Releases are tags `v<version>`** with two assets, `bb-plugin-tutor-<version>.tgz` (a
  `git archive` of the tag: no docs, harness or CI) and its `.sha256`. The tutor Feature downloads
  the release it pins and checks that SHA-256, so it no longer ships the plugin's source itself.
- **The Feature's `config.json` carries `"schemaVersion": 1`.** Absent means 1. The plugin refuses
  any other value through its course-error surface (the Course page and outline say which version
  it got and which it supports, and the coach tools refuse without writing), since a Feature and a
  plugin released apart could otherwise disagree about the file silently.

## Starter layout (2026-09-26)

Upstream moved the student's side of the course into `lean-software-production/capstone-project-starter`
(2026-09-25). The student forks the starter; its `tetris/` folder is the codebase, `tetris/.factory`
is the factory and the coding agent's working folder, and the fork is the Git repo. The starter's
`fetch-iteration` skill (`fetch.sh`) adopts a homework and its `coach-me` skill coaches it. The
tutorial deleted `.agents/coach-me.md` (fa5e3d1), so Tutor had been coaching with no coach file.
Tutor now follows the starter. Every place this diverges from DESIGN.md:

- **Decision 1 now wraps the starter, not the course's `coach-me.md`.** The conventions Tutor keeps
  are the starter's: `ITERATION` at the factory root, the three lesson files in `spec/`, the seed in
  `../seeds/` and `stand-ins/`. A student can still leave BB and carry on with the starter's skills.
- **`ITERATION` sits at the factory root**, not in `spec/ITERATION`. Tutor reads the root file first
  and falls back to an older factory's `spec/ITERATION`. It always writes the root file, then
  removes `spec/ITERATION`, but only when `spec/` is a real folder, never through a symbolic link.
  Problems name the file they came from. `spec/PROGRESS.yaml` stays where it was.
- **`tutor_adopt_iteration` gives exactly what `fetch.sh` gives, from the local course checkout.**
  It replaces only `spec/README.md`, `spec/FACTORY.md` and `spec/features/`, leaving anything else
  in `spec/` alone (it used to replace the whole folder but `PROGRESS.yaml` and `ITERATION`). A
  lesson without FACTORY.md removes the old one. The staged, symlink-safe swap is kept. Checked
  against `fetch.sh` from the same course: the two trees were byte-identical, modes and links
  included, after adopting 001 and again after 002.
- **The seed goes to `../seeds/tetris.md`**, named after the codebase folder, and only when that
  file is absent (written with `wx`). This supersedes "Seeds are named `seeds/<slug of the seed's
  first heading>.md`" below. `../seeds/` must be a real folder that doesn't overlap the course, and
  the seed path must not be a symbolic link. `../seeds/` is created only when there is a seed.
- **`stand-ins/` is refreshed wholesale** at the factory root from the course's root `stand-ins/`,
  by the same staged swap, with its working folders inside `stand-ins/` (the folder is gitignored),
  links copied as links. A course without `stand-ins/` leaves the factory's alone. Every check for
  `spec/`, the seed and `stand-ins/` runs before anything is written, and ITERATION is written last.
- **An old-layout factory keeps its progress but can't adopt.** A factory folder that holds `.git`
  itself (such as `/workspaces/my-factory`) would put `../seeds/` outside the student's repo, so
  adoption is refused with a plain message before anything is touched. Reading progress still works.
- **The commits are the starter's.** Tutor still doesn't commit. The coach is told to commit
  `spec/`, `../seeds/` and `ITERATION` as "Adopt spec for iteration NNN", and on completion the
  implementation, `ITERATION` and `spec/PROGRESS.yaml` as "Implement homework NNN".
- **The coaching method falls back to the starter's skill.** The lookup is course.yaml's `coach`,
  then the course's `.agents/coach-me.md`, then `<realpath(factory)>/../.agents/skills/coach-me/SKILL.md`.
  The status text and the coach's prompts name whichever was found.
- **Tutor and the starter's skills coexist.** The coach instructions and the `tutor` skill forbid
  running `fetch-iteration` or `fetch.sh` and editing `ITERATION` or `spec/PROGRESS.yaml` by hand;
  the skill maps "fetch-iteration / fetch.sh" to `tutor_adopt_iteration`. A lesson set to WIP
  outside Tutor, with no progress recorded, can be adopted again by its own coach; before, that
  deadlocked, since the lesson demanded adoption and none was offered. `tutor_status` says "Not
  adopted in Tutor yet" for such a lesson. A `spec/PROGRESS.yaml` that is there but can't be read
  or parsed is not "no progress": adopting over it would lose its marks, so the tools refuse and
  ask for the file to be repaired.
- **First run finds starter factories.** A folder qualifies with a root `ITERATION`, an older
  `spec/ITERATION`, or an AGENTS.md naming the coach, compared without the file's extension, so the
  starter's AGENTS.md naming **coach-me** qualifies. The detail reads "ITERATION · NNN status" or
  "no ITERATION". Decision 8's reasoning changes: the factory is now the student's fork of the
  starter, not a repo coach-me creates, and the welcome page says to fork the starter and add its
  `tetris/.factory` folder as a BB project.
- **The feature clones the starter** (feature 0.4.0). The new options `starter` and `starterRepo`
  mirror `course` and `courseRepo` and default to empty. The post-create hook
  (tutor-feature-bootstrap) clones `starterRepo` into `starter` when that folder is missing; a failed clone, of either repo, never fails the hook
  or stops the other. `starter` must be a safe absolute path different from `course`, and
  `starterRepo` needs a `starter` and must be https. `factory` stays explicit. A dot-folder factory
  is registered as the BB project `<parent>/<name>`, so the starter's is "tetris/.factory".
- **The codespace entry point uses the starter.** [`.devcontainer/tutor/devcontainer.json`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor/devcontainer.json) sets
  `starter` to `/workspaces/capstone-project-starter`, `starterRepo` to the upstream starter and
  `factory` to `/workspaces/capstone-project-starter/tetris/.factory`, where the design had
  `/workspaces/my-factory`.

Not done here: fast-forwarding the local course to GitHub's, shipping Tutor inside the starter's
own devcontainer (a PR to that repo), and cloning the student's fork rather than the upstream
starter in the codespace.

## The tutorial dropped Set after (2026-09-25)

The tutorial's lesson table lost its `Set after` column ("Drop days from the iterations"), and
Tutor refused to load the course. Only `Iteration` and `Spec` are required now; `set` was already
optional past the header check.

## Review fixes (2026-09-25)

A Codex (gpt-6-sol) review of the one-tree build found five defects, each reproduced. Each fix has
a regression test that failed before it and passes after.

- **T1: a coach thread changes only its own lesson.** The tools used to act on the current lesson
  whoever called them, so the Lesson 000 coach, still open after the student adopted Lesson 001,
  could mark Lesson 001's Examples. The caller's lesson is now its coach thread's (from the Tutor
  metadata written at spawn; side chats inherit it). Moving the focus, marking and completing refuse
  unless that is the current lesson, and say which coach to open. A coach adopts only its own
  lesson, so an old coach no longer adopts the next lesson in its thread: the student starts it
  from the outline, which spawns its coach. `tutor_status` still answers and says when the thread's
  lesson isn't current, and a side chat an old coach opens is filed under that coach's lesson. The
  metadata is writable by other API clients and the thread's own agent, so this guards against
  mistakes, not a hostile agent (which has a shell in the factory anyway). The skill says so.
- **T2: a failed tab write no longer leaves a side chat behind.** A side chat is a fork plus a tab
  in the coach thread's right panel. When the tab write failed (say, BB's tab strip kept changing
  the tabs), the fork stayed alive: listed in the outline, with no tab to reach it. The button and
  `tutor_side_chat` now share `openSideChat`, which archives the fork when the tab write fails and
  reports both errors when archiving fails too.
- **T3: adopting can't erase the previous spec snapshot.** Adoption cleared `spec/` and then copied
  the lesson, skipping a README.md that had gone missing since the course loaded, so the student
  was left with the old features and no README. The lesson is now copied into a staging folder
  inside `spec/` first (README.md required, FACTORY.md optional) and swapped in only when all of it
  copied; the old files move aside during the swap and come back if it fails. The symbolic-link
  refusals for `spec/`, `seeds/` and the seed are unchanged. (Since the starter layout the seed
  goes to `../seeds/`, and the swap replaces only the lesson's three names in `spec/`.)
- **T4: the jump to a Rule waits for a slow page.** The search gave up after three loads in a row
  left the timeline's height unchanged, under 3 s in, although BB can show its loading row for
  longer before an older page arrives, so an early Rule was reported "Couldn't find" well within
  the 20 s it was meant to try. Now only the 20 s deadline and a cap of 40 scrolls to the top end
  the search; the history height is no longer read.
- **T5: coach discovery reads every page.** Tutor listed only the newest 200 of its threads, side
  chats included, so after a couple of hundred side chats a lesson's coach thread fell off the list
  and "Start with your coach" spawned a duplicate. Tutor's threads and a coach thread's side chats
  are now read page by page (`listAllThreads`, de-duplicated by id), and past 10 000 threads the
  listing fails with a readable error instead of silently truncating.

A second, independent Codex verification of those fixes found new failure paths in three of them.
Each fix again has a regression test that failed before it and passes after.

- **R1 (T2): a side chat with a tab is never archived.** A failed tab write is not proof that no
  tab exists: BB can store the write and still answer with an error, and another client can write
  the same tab during the last conflict. `openSideChat` archived the fork anyway, leaving a tab
  that pointed at an archived thread. It now reads the coach thread's tabs again first: if one
  shows the fork, the side chat opened after all. Only a fork confirmed tab-less is archived; when
  the tabs can't be read, the fork is left alone and the error says so.
- **R2 (T3): a failed swap keeps the previous files, and a crashed one is recovered.** When the
  rollback of a failed swap couldn't put an old file back (say, a folder appeared at
  `spec/README.md` after the old README moved aside), the error was ignored and the moved-aside
  folder deleted, losing the previous README. The old files are now deleted only once the swap
  finished or all of them are back; otherwise they stay in `spec/.tutor-previous/` and the error
  names each one. The working folders now have fixed names, `spec/.tutor-adopting/` (the staged
  lesson) and `spec/.tutor-previous/` (the old files during the swap), instead of random
  `.tutor-staging-*` suffixes, so a crash's leftovers are found by name. Every adoption first
  recovers them: files from `.tutor-previous/` (and from legacy `.tutor-staging-*` folders) that
  `spec/` is missing are moved back, never overwriting one that is there, then the folders are
  removed. A leftover that is a symbolic link is removed without being read or followed. The folders
  sit at the top of `spec/`, never in `spec/features/`, which still holds exactly the lesson's.
- **R3 (T5): finding a coach thread survives threads vanishing mid-listing.** `threads.list` pages
  by offset, so with 201 of Tutor's threads, one archived between the first page and the second
  shifted the coach thread onto the page already read; the second page came back empty and
  `openCoach` spawned a duplicate. SDK 0.5.9 offers no cursor or keyset paging, but it does filter:
  coach discovery now asks only for visible threads without a parent (`includeHidden: false,
  hasParent: false`), so side chats and old side threads never enter that listing. Tutor also
  records each lesson's coach thread in its own `bb.storage.kv` when it finds or spawns one, and
  `openCoach` trusts that record first, as long as `threads.get` shows the thread live, in the
  factory project, structurally Tutor's coach thread (`isTutorCoachThread`) and with that course and
  lesson in its metadata. Without a valid record it lists, and lists once more before spawning. The
  coach-thread lock still covers the whole find-or-spawn.
- **Follow-ups from verifying R1–R3.** Every fix held up under red/green. Two minor defects were
  found and fixed, each with a test that failed first:
  - Trusting the record first let `openCoach` pick a different coach thread from the one the
    outline and start page showed, once a student had unarchived an older coach thread by hand.
    Now the newest listed coach thread wins everywhere. The record is only used when a listing
    finds no coach thread, and it's updated to whatever was found.
  - The swap's rollback put old files back with a plain rename, which silently replaced a file
    written at the same path during the swap. The rollback now skips any path that's taken, as
    recovery already did: the newer file stays, and the old copy is kept in
    `spec/.tutor-previous/` and named in the error. This was in the code before R2.

## Names follow the glossary (2026-09-25)

Code, docs and the feature now use the words in [`GLOSSARY.md`](GLOSSARY.md), so a name means the
same thing to the student, the docs and the code. It is a rename only, with no new behaviour.
Older entries below keep the names that were current when they were written.

- **Start page.** The RPC payload shared by the start page, the lesson card, the Rule card and the
  Rule tab is `LessonDetail` (`getLessonDetail`, was `Lesson` / `getLesson`). `LessonPage.tsx`
  is `StartPage.tsx`, and the course route `lesson/NNN[/<rule>]` is `start/NNN[/<rule>]`.
- **Homework → lesson** everywhere Tutor names it: `Lesson`, `lessonId`, `findLesson`,
  `nextLesson`, `lessonStatus`, `BUILTIN_LESSON_ID`, `startNextLesson`, `server/course/lesson.ts`,
  the built-in `lesson-0/`, `course.yaml`'s `lessons:` list, the card line `lesson-complete`, the
  directive `::tutor-lesson{lesson="NNN"}` and the thread metadata key `lesson` (was
  `iteration`). The course's own words stay: `docs/iterations/`, `spec/ITERATION`,
  PROGRESS.yaml's `iteration` key (its format is unchanged), the `tutor_adopt_iteration` and
  `tutor_complete_iteration` tools and their `iteration` parameters, the `homework-NNN.md` seed
  name, the "Implement homework N" commit message from coach-me, and the course READMEs'
  "Homework N" titles.
- **Rail → outline:** `Outline.tsx`, `app/model/outline.ts`, `buildOutline`, the `tp-outline`
  classes, slot `course-outline` (was `course-rail`), the feature option `selectOutline` (was
  `selectRail`) and its `outline-selected` marker, and the test `no_clone_no_outline.sh`.
- **Main thread → coach thread, side thread → side chat:** thread roles `coach` and `sideChat`
  (were `main` and `side`), `coachThreadId`, `findCoachThread`, `coachThreadPrompt`,
  `startSideChat` (was the RPC `startSideThread`). `TutorThread`'s boolean `sideChat` is now
  `fork`. "Side thread" is kept only for the child threads spawned before side chats.
- **Binding → factory project:** `FactoryProject` (`factoryProjectSchema`), the `factoryProject`
  field on the overview, `server/coach/factory-project.ts`, and the statuses `unset` / `found` /
  `missing` (were `unbound` / `bound` / `missing`). The setting was already `factoryProject`.
- **Novelty → new/reworded:** `changeSchema` / `Change` (`new`, `reworded`, `unchanged`), the
  `change` field, `withChanges` in `server/course/changes.ts`, and `ChangeBadge` (was `NewDot`,
  class `tp-change-badge`).
- **Cursor → focus** needed no code change: the code already said `focus`.
- **Existing Codespaces need a fresh start.** There are no compatibility shims. Coach threads and
  side chats made before this carry the old metadata (`iteration`, `role: "main"` / `"side"`), so
  Tutor no longer lists them. Their lesson cards use the old `homework=` attribute and show as plain
  text. Links to `lesson/NNN` open the course home. The sidebar selection names the old
  `course-rail` slot. A `course.yaml` must say `lessons:`, and a devcontainer that sets
  `selectRail` must set `selectOutline` instead.

## One tree (2026-09-25)

After trying the MVP, the owner found the split sidebar (course rail above, conversations below)
and the lesson page confusing. Decisions made with the owner, and the deviations they cause. Words
follow [`GLOSSARY.md`](GLOSSARY.md): the student reads *lesson* for homework, *course outline* for
the rail, *side chat* for side thread, *focus* for cursor. The feature is now version 0.3.0.

- **One course outline replaces the rail and the conversations tray** (revises mockup 1B and the
  3A rail). The homework chips, the progress card, the separate Rule list, the Conversations and
  Earlier homeworks sections are gone. The sidebar is one tree: every lesson (id, title, n/m with a
  thin bar, done/current/ahead), the current one open; under a lesson its coach thread (or "Start
  with your coach"), the coach thread's Rules grouped by feature, and its side chats; then Other
  threads as before. The code keeps its names (`Rail.tsx`, `rail.ts`, slot `course-rail`).
- **The coach lives in BB's own thread view; the lesson page is retired as a coach surface**
  (revises mockup 2A and the spike's `ThreadChat layout="document"` refinement). The lesson still
  leads the thread, but inside it: the coach's first reply opens with the lesson card
  (`::tutor-lesson{homework="NNN"}`, from the first prompt), and each Rule's section starts at its
  Rule card, the `focus` progress card drawn as annotated Gherkin (6B) with live status. Why: one
  conversation in BB's normal thread view is less confusing than a second, embedded one. The
  route `lesson/NNN[/<rule>]` opens the coach thread (at the Rule's section when it names one);
  without a coach thread it is the start page, which keeps the paper lesson and "Start with your
  coach". Home, the completion page and the Rule tab lead to the thread too.
- **A plugin cannot open a thread "replace-style"**: `navigate.toThread` always pushes. So the
  lesson route marks its history entry and opens the coach thread only once; Back to it shows
  "Open the coach thread →" instead of bouncing.
- **Clicking a Rule goes to its section; Rules are greyed until the coach reaches them.** A Rule
  has a section only once the coach has focused it in the coach thread, so `tutor_focus_rule`
  records it in the coach thread's metadata (`reachedRules`) and returns the Rule card with an
  instruction to put it at the top of the next message. The record lives on the coach thread, not
  in `PROGRESS.yaml`, because sections exist only there: a new coach thread, or coaching outside
  BB, has none, and carry-over has nothing to move. Clicking a Rule no longer messages the coach;
  "Work on this Rule next" moved to the Rule tab.
- **Jumping to a section loads older history.** BB's thread view keeps only recent messages in the
  DOM, so the jump scrolls the timeline to its top until BB has loaded the page with the Rule card,
  then scrolls the card into view and highlights it. It finds the timeline by the rows BB renders
  for the thread, not by class names, stops when the history stops growing or after 20 s, and
  cancels if the student leaves or scrolls. A section it can't find is a toast.
- **Side threads are replaced by BB side chats.** "Ask a side question" and the coach's new
  `tutor_side_chat` tool (it replaces `tutor_side_thread`) do what BB's side-chat plugin does: a
  hidden, seed-only fork of the coach thread, plus the "Side chat" tab BB writes for "Reply in side
  chat" in the coach thread's right panel. The RPC keeps its name, `startSideThread`. Side chats
  BB makes itself are listed too. Side threads spawned before this still show under their lesson.
- **A plugin cannot select another plugin's panel tab** (`openThreadPanel` refuses it; a written
  tab arrives unselected). So after opening a side chat Tutor opens the coach thread and a toast
  points to the "Side chat" tab (Ctrl+J shows the right panel). Choosing a side chat in the outline
  puts its tab back if it was closed (`ensureSideChatTab`).
- **Side chats did not show up through BB's sidebar thread list** in BB 0.43.4 (the SDK says hidden
  threads may be in it), so the outline lists them from the backend, per coach thread, refreshed
  when BB creates one (`thread.created`).
  BB names its own side chats after the replied-to message; the outline drops any card syntax
  that message opens with.
- **BB's own side chats get Tutor's powers.** A hidden fork of a coach thread made by BB's "Reply
  in side chat" is treated as a side chat of that lesson without a Rule: it is offered the tools
  and skill, and the tools accept it. Like Tutor's side chats it can read the status and mark
  Examples but not move the focus. A visible fork ("Fork into new thread") and a fork of a side
  chat get nothing. A fork is never taken for the coach thread, whatever its metadata says.
  `configure` is synchronous and can't ask BB about a fork's source, so it checks the coach
  threads Tutor has listed; every tool call re-checks with BB.
- **A provider that cannot fork gets a clear error**, and nothing is spawned in its place.
- **Lesson 0 teaches the new interface**: the course outline, the lesson card, jumping to a Rule
  and side chats. It now has 5 Rules and 10 Examples; its keys changed, so a student part-way
  through the old Lesson 0 sees its Examples as pending again.
- **User-facing copy says "lesson"**: "Lesson 0", coach threads titled `Coach · Lesson 000` (older
  threads keep their titles; the outline shows the new one). Code, routes and the course's files
  keep "homework" and "iteration".
- **The scripted e2e provider forks at the tip** (declared at registration and at the bridge's
  `initialize`), and opens each reply with the directive lines of its prompt and of its tool
  results, the way a coach writes the lesson card and Rule cards.

## Codespace polish (2026-09-25)

After the owner tried a real Codespace from [`.devcontainer/tutor`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor), five changes. The feature is now
version 0.2.0.

- **All of BB wears the Tutor colours.** The plugin contributes the theme `plugin:tutor:paper`
  (the workbook's paper, ink and blue on BB's tokens, Archivo as the UI font, a paper-coloured code
  theme, and a dark "paper at night" variant, since BB themes need one). The feature's new `theme`
  option selects it once per BB state directory, and only while BB's default theme is active.
  Tutor's own rail and pages stay light paper in dark mode. The muted text colour is darkened to
  `#56616c` so every text/surface pair reaches 4.5:1.
- **Default BB features students don't need are off.** The feature's new `disablePlugins` option
  switches off automations, workflows, scheduled send, Connect, keep-awake, the plugin API tools
  and others once per id per BB state directory, so a student can turn any back on and it stays
  on. And the plugin's sidebar navigation hides BB's Plugins and Skills rows while its
  `simpleNavigation` setting is on (default). Tutor's navigation draws its own rows, so it has no
  "More" overflow or per-row menus.
- **The Claude Code, Codex and Pi CLIs are installed** in the Codespace from this repo's
  `claude-code`, `codex` and `pi` Features, at their latest release and with no credentials.
- **A lost connection says so.** When a Tutor call gets an answer that is not BB's (the
  Codespaces port-forwarding proxy's empty 401 after the Codespace stopped, an HTML 502, a network
  error), the page says the connection to the Codespace was lost, it may have stopped after being
  idle, and offers Reload, instead of `rpc "openCoach" failed (HTTP 401)`.
- **Keeping the Codespace awake, best effort.** GitHub does not count browser traffic through a
  forwarded port as activity. The plugin stamps `<BB data dir>/.tutor-feature/activity` while the
  student uses BB, and `tutor-keepalive`, run in the attach terminal by the entry point's
  `postAttachCommand`, prints a line every 30 s while that stamp is under 120 s old, since terminal
  output does count. Whether it works must be confirmed in a real Codespace; the reliable fix is
  a longer idle timeout in the student's GitHub settings (up to 240 min).

## Review rounds (2026-09-25)

Three Codex (gpt-6-sol) reviewers covered the backend, the feature packaging and the UI, and found
19 defects. All were fixed with red-then-green tests. A fourth Codex pass verified the fixes
independently by reverting each one: 14 were confirmed, 4 were partial, and it found 5 new small
issues. Four of the partial fixes and four of the new issues were closed in round 2.
Behaviour-visible changes:

- **Symbolic links never lead outside their folder.** Tutor refuses to adopt, seed or write
  progress through a symlinked `spec/`, `seeds/` (now `../seeds/`, see Starter layout) or seed file
  (a dangling seed link included), or, since the starter layout, a symlinked `stand-ins/`. It
  refuses a course whose `course.yaml`, ledger, root `README.md`, homework folders, coach or
  lexicon are symlinks leading outside the course.
- **The course checkout can't be chosen as the factory.** Neither can a folder inside it or one
  holding it. First run marks such projects "shares a folder with the course". The check is
  repeated on every load: a stored binding whose folder later leads into the course is treated as
  missing, so no coach runs and nothing is written.
- **A homework needs `README.md` and at least one `.feature` file.** `FACTORY.md` and `spec.md`
  are optional. A homework without feature files is a course load error and can never be adopted.
- **Concurrency.** Progress mutations and "find or spawn the main coach" are serialised per
  factory / homework with an in-process lock (BB runs one server process).
- **`PROGRESS.yaml` never loses what it doesn't understand.** Unknown fields survive, including
  when a homework moves into `history`. Malformed history is reported and written back verbatim.
- **Pages revalidate their data on mount.** A 3-second sharing window deliberately lets the rail,
  the page and the nav badge share one request. The reviewer's "a remount within 3 s shows cached
  data" was rejected as the intended trade-off.
- **The rail's "Start with your coach" opens the lesson.** While no factory is bound, coach
  actions lead to the welcome page. While the binding is still loading, none is offered.
- **Rule links carry the Rule in the URL** (`lesson/NNN/<feature>/<rule>`), so they survive a new
  tab or a reload.
- **Word spaces render in the fallback sans face.** Archivo's own space is very narrow in some
  renderers.
- **The start-up script checks the plugin's status, not just its install path.** A disabled
  plugin is left off; a failed one is reloaded, and the script fails if it stays down. The
  plugin copy's digest includes the built bundle, so a bb-app upgrade restages it.

## Build (2026-09-25)

Judgement calls the four builders made that change user-visible behaviour or the design's
contracts. Smaller implementation choices are in `IMPLEMENTATION.md`.

**Course content**
- **Homework 0 is a built-in course** in `server/course/builtin/`, with its own `course.yaml`,
  shown first as homework "000". It has 5 Rules and 9 Examples. It is tracked only in
  `spec/PROGRESS.yaml`, never `spec/ITERATION`. Its evidence is the student describing what they
  saw.
- **A mistake in `course.yaml` fails loudly.** A named `coach` or `lexicon` file that doesn't
  exist, or a path that leaves the course folder, stops loading with an error naming the line.
  A course without `course.yaml` falls back to the ledger table.
- **The lesson's dek skips boilerplate.** Sentences that repeat across a course's READMEs (for
  example "Read `FACTORY.md`, then…") are left out.
- **The "New since" box is generated from the data**, one line per changed feature file, instead
  of the mockup's hand-written bullets. It is omitted when everything is new.

**Coach and progress**
- **Tools act on the homework the repo says is current.** They refuse threads Tutor didn't spawn
  and threads outside the bound factory project. A thread's role (main or side) comes from its
  BB-set parent, not from metadata. Only the main thread can move the focus.
- **Adopting homeworks:** Homework 0 first; the first real homework can be adopted from Homework
  0, so the student can skip it. After that, only the homework after a Done one.
- **`tutor_complete_iteration` doesn't require every Example to pass** for a real homework, because
  coach-me decides when it's done; it notes how many are open. Homework 0 does require them.
- **Seeds are named `seeds/<slug of the seed's first heading>.md`.** coach-me hard-codes
  `seeds/tetris.md`; the generic rule gives the same name for this course. Superseded by the
  starter layout: the seed is `../seeds/<codebase folder>.md`, `tetris/seeds/tetris.md`.
- **File I/O uses `node:fs` on the BB server's machine**, not `bb.sdk.files`, because a course
  codespace is a single machine.
- **Opening a done homework with no coach thread spawns a "revisit" coach** that is told not to
  change the student's progress.
- **The collision guard holds a turn with `wait`** (backstop `sendAt` 60 s) while a sibling
  Tutor thread in the project is running, and releases it when that thread goes idle.

**UI**
- **Clicking a Rule in the rail opens it on the lesson page.** A "Work on this Rule next" button
  then tells the coach (decision 4's redirect), so a stray sidebar click never messages the coach.
- **Lesson page layout:** other features are listed folded above the feature in focus, so the
  lesson still ends at the Rule in focus. Without a stored focus, the first unfinished Rule is
  shown as "up next". Each Example gets its own gutter/steps/margin row in the annotated Gherkin.
- **The red margin rule runs beside the paper lesson but not beside BB's chat**, because
  `ThreadChat` centres its own column.
- **Additions beyond the mockups:** a "You finished homework N, see what's next" banner; a
  status-chip row under the dek; and a progress badge on the Course nav row
  (`experimental_sidebarAccessory`).
- **First run says "Start the course →"**, and the nothing-found state offers "Check again" and
  "use one of these projects anyway".

**Feature and packaging**
- **The tutor feature has no `installsAfter`.** The devcontainer CLI can't resolve the unpublished
  `bb` feature, so compositions use `overrideFeatureInstallOrder`. Add `installsAfter` once `bb`
  is published.
- **The Codespace entry point commits copies of [`src/bb`](https://github.com/lean-software-production/devcontainer-features/tree/main/src/bb) and [`src/tutor`](https://github.com/lean-software-production/devcontainer-features/tree/main/src/tutor)** under
  [`.devcontainer/tutor/features`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor/features). Symlinks fail ("Failed to fetch feature"). The copies are kept
  current by `sync-features.sh`, which CI checks.
- **Node comes from the `javascript-node:24` image**, not the node feature, because BB runs with a
  fixed system `PATH` that can't see nvm's node.
- **The feature seeds BB's plugin build toolchain at start**, so starting needs no network (BB
  would otherwise download about 30 MB on first start).
- **The course is registered as a BB project too**, alongside the factory.
- **The rail is selected at most once per BB state directory**, and only while BB's default list
  is active. A student who switches back is never overridden.
- **Extra feature options:** `courseRepo` (https only; empty means don't clone) and `selectRail`.
  The feature was version 0.1.0 (0.2.0 after the Codespace polish).

## Integration (2026-09-25)

Proven end to end in a fresh container built from [`.devcontainer/tutor`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor) (ports moved to
48886/48887, `/workspaces` bind-mounted) with the scripted provider. Changes made while
integrating:

- **`spec/PROGRESS.yaml` keeps a `history`.** Adopting the next homework used to replace the
  finished homework's progress, so its lesson said "0 of 9 examples hold · Complete ✓" and its
  completion page lost the coach's summary. The previous homework's statuses, `adopted` and
  `summary` now move under `history.<id>` (evidence is left out; it stays in git history).
- **Coach threads work directly in the factory folder** (`host` environment with an unmanaged
  workspace) rather than `project-default`, so the coach always edits the folder whose
  `spec/PROGRESS.yaml` Tutor reads, and side threads share it.
- **The completion page continues a homework that has already started** ("Continue homework N with
  your coach", which opens the existing coach) instead of offering "Start", which would fail.
- **Homework 0's "Coming back later" Example** now says BB home's "Continue with your coach" returns
  to the coach thread; the home section's separate "Open the lesson" opens the lesson.
- **The feature installs the plugin from a user-owned, digest-named copy** in BB's data directory,
  because BB rebuilds `dist/` on every path install.

## Spike results (2026-09-25)

All six probes worked in a containerised BB 0.43.4. The evidence is in [`scripts/tutor-dev/`](../scripts/tutor-dev/README.md) and
the spike notes. Changes that follow from it:

- **Lesson page uses `ThreadChat layout="document"` inside a scroller the page owns.** This
  refines decision 6 / mockup 2A. With `contained`, BB's opaque scroll container hides the grid
  paper and can only be see-through by overriding BB-internal classes. `document` paints no
  background.
- **Every Tutor tool re-checks the calling thread inside `execute()`** (plugin metadata or
  origin), and refuses otherwise. This is new. `configure` scoping controls which tools are
  *offered*, but BB 0.43.4 still runs a plugin tool that a provider calls without being offered
  it. This was reproduced with a scripted provider.
- **The course rail must be selected once.** `experimental_threadList` never wins by default: the
  user picks it under Settings → Appearance → Sidebar, and the choice is stored server-side. The
  feature's start-up script selects it when BB exposes a way to do so; otherwise first run asks
  the student to.
- **The rail works out the active lesson from its own route.** BB passes `activeThreadId` as null
  on plugin pages.
- **The "Continue" section on BB home finds the coach thread itself** (with
  `threads.list({originPluginId})`), because `homepageSection`'s `projectId` is usually null.
- **Directive cards (`::tutor-progress`, `::term`) render in any thread**, not just Tutor's.
  Their attributes are treated as untrusted and validated.
- **A scripted provider plugin becomes the credential-free end-to-end test fixture.** It echoes
  directives and makes real tool calls. This is new; real Claude Code and Codex are not used in
  tests.
- **The plugin is path-installed by a `postStartCommand` that runs after `bb-feature-autostart`.**
  It is idempotent: it skips when the plugin is already installed from the same path. The `bb`
  feature does not export `BB_SERVER_URL`, `BB_DATA_DIR` or `BB_HOST_DAEMON_PORT`, so the `tutor`
  feature sets them for its hooks.
- **Harness ports.** Local development uses 47886/47887 rather than the defaults, so it never
  touches the host's own BB.

## Decisions taken at kick-off (2026-09-25)

- **Stacked on PR #3.** The `tutor` feature depends on the unmerged `bb` feature, so this branch
  (`tutor/mvp`) is based on `bb/add-bb-standalone-devcontainer-feature`.
- **bb-app pin bumped from 0.43.3 to 0.43.4.** 0.43.4 is npm `latest` and bundles host plugin SDK
  0.5.9. The plugin compiles against that exact SDK, not npm's newer 0.5.24.
- **Tutorial repo is optional for the MVP.** The engine reads `course.yaml` when present and
  otherwise falls back to parsing the ledger table in `docs/iterations/README.md`.
  `course.yaml` and the `coach-me.md` change go to the tutorial repo as a separate PR and are not
  blocking.
- **Codespace entry point.** [`.devcontainer/tutor/devcontainer.json`](https://github.com/lean-software-production/devcontainer-features/tree/main/.devcontainer/tutor/devcontainer.json) in devcontainer-features combines `bb`
  and `tutor`, and clones the public `tutorial` repo at start-up.
- **"Done" is proven locally**, with the `devcontainer` CLI and in CI. The final check, a real
  GitHub Codespace, is the owner's.
