# Tutor in the Sketchbook brand

Status: **built in 0.3.0 (unreleased)**; approved design 2026-09-27. See
[What was built](#what-was-built) for the decisions taken and the mockup fixes. This redraws Tutor, and the BB theme it
installs, in the Lean Software Production brand from
[`lean-software-production/brand`](https://github.com/lean-software-production/brand). The brand is
"warm, whimsical, wise": cream paper, wobbly ink, marker lettering, a teal accent, the highlighter
swash, and plain words, one idea at a time. It replaces the workbook look (Tutor paper: workbook
blue, Archivo and Spectral, graph-paper cards) described in [`DESIGN.md`](DESIGN.md) and
[`mockups.html`](mockups.html). Terms follow [`GLOSSARY.md`](GLOSSARY.md).

## Decisions

1. **The brand repo owns the BB theme.** `bb-theme/sketchbook/theme.css` in the brand repo is the
   only copy. The plugin takes it from a pinned brand commit and doesn't fork it: fixes the plugin
   needs go back to the brand repo, and the pin moves.
2. **Handwriting everywhere, as the brand says.** Patrick Hand for all of BB's text, chat
   included; Luckiest Guy titles and Patrick Hand SC labels on Tutor's own surfaces. Code, diffs
   and terminals stay monospaced. Screenshots of a long coach message are checked at the mockup
   step.
3. **Full sketchbook on Tutor's own surfaces**: wobbly panels, the highlighter, step colours,
   icons, speech bubbles, a loop arrow, characters, and small animations.
4. **Brand voice first, then Tutor.** The brand's "Voice and tone" (a `TODO.md` item) is drafted
   in the brand repo for a person to decide; Tutor's skill and UI copy follow it.
5. ~~**Ship the brand's proposed dark mode** (ink page, paper text, lighter teal), contrast-tested
   here; what the tests find goes back to the brand's dark-mode decision.~~ *Superseded
   2026-09-28 by [D12](#what-was-built): the brand is light mode only.*
6. **Sketchbook replaces Tutor paper.** Students on Paper are moved; a theme a student chose
   themselves is never replaced.

## How the brand reaches the plugin

A committed, pinned copy (the same pattern as the Feature repo's `sync-features.sh --check`):

- `scripts/sync-brand.ts <commit>` fetches the brand repo at a commit and writes `vendor/brand/`:
  `PIN` (the commit), `bb-theme/sketchbook/theme.css`, `kit/tokens.json`, the icons and characters
  Tutor uses, and the voice section of the brand `README.md`. `--check` re-fetches the pinned
  commit and fails on any difference; CI runs it.
- Fonts: the brand loads them from Google Fonts. The plugin self-hosts Latin subsets of Luckiest
  Guy (Apache 2.0), Patrick Hand and Patrick Hand SC (SIL OFL 1.1) in `app/fonts/`, registered as
  `Tutor …` families as today, so a codespace needs no network for them and they never shadow
  another plugin's fonts.

Rejected: a brand release tarball (the brand repo has no releases and pushes straight to `main`),
and loading the kit live from GitHub Pages (breaks offline codespaces and pinning).

## Theme

- `app/theme/build.ts` builds `themes/sketchbook.css` from `vendor/brand/.../theme.css`: drops
  the `@import`, prepends the inlined `@font-face` rules, and maps `--font-sans` to the `Tutor`
  families. One light code theme (`themes/sketchbook-code-light.json`) is built from
  `tokens.json`; the manifest names it for both of BB's modes (D12).
- `package.json` contributes `sketchbook` ("Sketchbook"). `theme.test.ts` checks text-tier
  contrast against the built CSS, that each grey BB mixes from ink and paper in oklch is re-mixed
  in oklab (see D11), and that the page is the same with BB's `.dark` class as without it (D12). A failure is fixed in the brand repo and re-pinned, not
  patched here.
- **Retiring Paper.** For one release, `paper` stays registered with the Sketchbook CSS and the
  name "Tutor paper (now Sketchbook)", so a student who selected it, and a codespace on Feature
  ≤0.6 whose default is `plugin:tutor:paper`, see Sketchbook without breaking. The release after
  removes it.
- **Feature 0.7.0**: the `theme` default becomes `plugin:tutor:sketchbook`. At start-up, once per
  state directory (a `theme-migrated` marker), an active `plugin:tutor:paper` is switched to
  `plugin:tutor:sketchbook`. Any other theme, including BB's own a student picked, is left alone,
  as `select_theme` already does.

## Tutor's surfaces

`app/paper.css` becomes `app/sketchbook.css`; its `--tp-*` tokens are generated from
`tokens.json` (no literal colours in component CSS). They were generated in light and dark until
D12; they are light only now.

The kit pieces come from the brand kit, not from Tutor. The kit now has them all:

- the panel wash (`sk-wash`);
- the highlighter on any text (`sk-hl`), with an optional sweep (`sk-sweep`) that is off under
  reduced motion;
- the tick (`sk-tick`);
- buttons (`sk-btn`, and `sk-secondary` for the quiet one);
- the progress meter (`sk-meter`);
- the paper patch (`sk-patch`) and dark role tokens under `.dark` and `.sk-dark`. *Both removed
  from the kit with light mode only (D12).*

Tutor's own CSS keeps only BB-shell and Tutor layout. Small components in `app/ui/sketch/`,
each usable alone, wrap those pieces:

| Component | What it draws |
|---|---|
| `WobbleDefs` | The kit's thin, chunky and soft wobble filters, mounted once per surface (as `sketchbook.js` does). Without it outlines vanish in Firefox. |
| `Panel` | A kit panel: wobbly outline, pastel wash, optional `dashed` to single one out. |
| `Highlight` | The highlighter swash behind text; optional sweep-in. |
| `Tick`, `Button`, `Meter` | The kit's tick, buttons and progress meter. A meter always has its count in words beside it. |
| ~~`Patch`~~ | ~~The kit's paper patch behind an icon or character.~~ *Removed (D12): with no ink page, a drawing needs no paper behind it.* |
| `StepBadge` | A lesson or Rule number in the step order mustard → teal → forest → coral → blue, repeating. |
| `KitIcon`, `Character` | A vendored icon or character, as a whole file, never recoloured (in a `.tp-drawing` wrapper; in a `Patch` until D12). |
| `Bubble`, `Ribbon` | Speech bubble and ribbon banner. |
| `LoopArrow` | The kit's hand-drawn loop-back arrow. |

Where they go:

- **Outline**: `StepBadge` per lesson; the current lesson and Rule on the highlighter; passed
  Rules get the kit tick. No loop arrow here: it was too busy next to the lesson list.
- **Lesson card** (`::tutor-lesson`): a `Panel` with the lesson title in Luckiest Guy on the
  highlighter, the Rules as a checklist with the `checklist` icon.
- **Rule and progress cards** (`::tutor-progress`): `Panel`s; "not yet" and coach notes in a
  `Bubble`; passing a Rule sweeps its highlighter in.
- **Lesson complete**: a `Ribbon` ("Lesson 3 done!") and the `group` characters as a small
  celebration scene; "What's next" as a marker-lettered link. The `LoopArrow` lives here now. It
  runs from the stats back round to "What's next": you finish, then you go again. It crosses
  nothing.
- **Welcome, home and start pages, empty states**: one small character at the edge, doing
  something, never the centrepiece. We use real kit characters: the `waver` says hello on the
  welcome page, the `explainer` points at the next step on home, and the `group` cheers a
  finished lesson. The kit has no learner with a laptop.
- **Motion**: the highlighter sweep and a short ribbon unfurl only, both off under
  `prefers-reduced-motion`.
- **Missing drawings** are not drawn here: the closest kit element is used and the gap is raised
  in the brand repo (brand skill rule 4).

*Superseded 2026-09-28 (D12), kept for the record:* In dark mode the surfaces sit on the ink
page: washes are mixed toward ink, and the highlighter becomes the teal tint BB's dark theme uses
for selection. Characters and icons keep their own colours. Each one sits on a paper patch, a
small wobbly piece of cream paper. In light mode the patch is invisible, because the page is
already paper.

Now the surfaces stay on paper in both of BB's modes, and characters and icons sit straight on the
page.

## Mockup

[`mockups-sketchbook/`](mockups-sketchbook/) is the mockup. It replaces the look of
[`mockups.html`](mockups.html). It loads the kit from the plugin's `vendor/brand/` (pinned at `vendor/brand/PIN`) and
draws seven screens. `shoot.mjs` takes the seven screenshots; `--check` reports any text under
4.5:1. (It drew them in light and dark, 14 screenshots, until D12.)

The outline screen is a composite. It puts states from different moments on one screen, so the
outline shows every kind of row at once: passed, current, not reached, and a side chat. BB never
shows exactly this screen.

## Words

- **Brand repo**: a drafted "Voice and tone" section in `README.md` — sample phrases, how we write
  headlines, words we avoid, explaining jargon briefly, and cheering small wins without gushing.
  A person decides it; it's then removed from `TODO.md`. The same pass records the dark-mode
  decision and what the contrast tests say about mustard and coral text (likely decorative only).
  *The dark-mode decision, 2026-09-28: light mode only (D12).*
- **Tutor skill** (`skills/tutor/SKILL.md`): a short Voice section from the vendored brand voice.
  The coaching method stays the course's coach file; Tutor only adds how to sound.
- **UI copy**: every string in `app/ui/` rewritten to the voice (short, warm, plain, one idea per
  line).

## Order

1. Brand repo: voice draft → decided; dark mode decided (light mode only, D12).
2. A Sketchbook mockup of the outline, lesson card, Rule card, lesson complete, welcome and home,
   in light and dark (light only since D12), built from the kit (replaces `mockups.html`).
   Screenshots reviewed before plugin code.
3. Plugin 0.3.0: vendor + sync check, fonts, theme, surfaces, copy, skill voice, Paper alias.
4. Feature 0.7.0: default theme and the Paper migration.
5. A real codespace from capstone-project-starter's "BB tutor" config.

## Testing

- `sync-brand.ts --check` in CI.
- `theme.test.ts`: text-tier contrast on the built Sketchbook CSS, and that the theme's light
  values also apply under BB's `.dark` (D12). Until D12 it checked light and dark contrast.
- Unit tests for `StepBadge`'s colour order and the token generation.
- The e2e walk (`scripts/tutor-dev/e2e`) with new screenshots, plus a Firefox pass (wobble
  filters present, outlines visible) and a reduced-motion pass (no animation).
- Feature tests: the new default is selected; Paper is migrated once; a student's own theme and a
  re-chosen Paper after migration are both left alone.

## Acceptance criteria

### 1. New codespaces open in Sketchbook
1. Create a codespace from capstone-project-starter's "BB tutor" config and open the BB port.
2. Open Settings → Appearance.
3. Expect: the active theme is "Sketchbook"; BB's text is in Patrick Hand on cream paper.

### 2. Paper students are moved, others are not
1. In a BB state directory with `plugin:tutor:paper` active, start a codespace with Feature 0.7.0.
2. Repeat with BB's `nord` theme active.
3. Expect: the first ends on `plugin:tutor:sketchbook`; the second is still `nord`.

### 3. The course outline is drawn in the kit
1. Open a lesson whose coach thread has passed one Rule.
2. Look at the sidebar outline.
3. Expect: step-coloured lesson badges in the mustard → teal → forest → coral → blue order, the
   current Rule on the highlighter, a tick on the passed Rule, and no loop arrow.

### 4. Finishing a lesson celebrates
1. Complete a lesson in its coach thread.
2. Expect: the lesson-complete card shows a ribbon and the group characters, with a "What's next"
   link and a loop arrow from the stats back to it.

### 5. ~~Dark mode reads~~ Dark mode stays light
*Superseded 2026-09-28 (D12). It was:* switch BB to dark mode on a lesson with a coach thread;
expect paper-coloured text on the ink page, every icon and character on a paper patch, and
`theme.test.ts` passing its dark contrast checks.

1. Switch BB to dark mode on a lesson with a coach thread.
2. Expect: the page, the sidebar and code blocks stay cream paper with ink text, the drawings
   sit straight on the page, and `theme.test.ts` passes its check that every BB token resolves
   the same with `.dark`.

### 6. Reduced motion is respected
1. Turn on the OS "reduce motion" setting and pass a Rule.
2. Expect: the highlighter appears without sweeping in.

### 7. The brand copy can't drift
1. Change a byte in `vendor/brand/bb-theme/sketchbook/theme.css` and run `scripts/sync-brand.ts
   --check`.
2. Expect: it fails, naming the file.

### 8. The coach sounds like the brand
1. Read `skills/tutor/SKILL.md`.
2. Expect: a Voice section that matches the decided brand "Voice and tone" and leaves the
   coaching method to the course's coach file (human-verify for tone).

## What was built

Plugin 0.3.0 (unreleased) on `tutor/sketchbook`, with the brand pinned at `71944a2` (it was
`2824384` until D12, `ef29ca3` until D13).

**Mockup fixes.** The first mockup had three weak spots, fixed before any plugin code:

- **Loop arrow.** The lesson-complete loop is drawn 1:1 from `loopPath()` in a band under the row,
  not stretched. It leaves the stats, curls once, comes back under "What's next", and crosses no
  text.
- **Patches at the frame's edge.** The welcome waver sits 40px in from the frame, and the outline's
  books patch moved in. Every patch is now at least 16px inside the frame. (Since D12 there are no
  patches; the same 16px check applies to the drawings.)
- **Chips.** A chip is a filled wash with the kit's 3px line. The old 2px line thinned to a hairline
  where `sk-wobble` shifted it by a whole pixel.

`shoot.mjs --check` now checks all three: patch margins (drawing margins since D12), the loop clear
of text, and the loop's end within 12px of "What's next".

**Decisions taken** (numbered as in the build plan):

- **D1.** The kit CSS is a generated copy scoped under `.tutor-sk`, not the kit verbatim.
- **D2.** Fonts are Fontsource 5.3.0 Latin woff2 files, with their sha256 sums and licences.
- **D3.** The meter's 1px steps at 1x come from `sk-wobble-line`'s whole-pixel displacement, and
  the kit is unchanged. Tutor adds no filter of its own.
- **D4.** The one contrast failure (light-mode subtle text, 4.23:1) was fixed in the brand repo and
  re-pinned (4.76:1).
- **D5.** The in-thread lesson-complete card fetches its own stats. While they load, or if they
  fail, it shows the ribbon and the link, with no loop.
- **D6.** Archivo, Spectral and JetBrains Mono are gone. Code uses BB's mono.
- **D7.** The outline's brand mark is the kit's books icon.
- **D8.** Step colours follow list position, so lesson 0 is mustard, as in the mockup.
- **D10.** Tutor owns the tall loop's geometry and draws it with the kit's class, marker and filter.
- **D11.** BB mixes its greys (sidebar, borders, muted, pills) from ink and paper in oklch. Between
  two near-greys Chrome drops the hue and renders it as 0, so they came out pink. The brand theme
  now re-mixes each of them in oklab at BB's own percentages (brand `2824384`); lightness, and so
  contrast, is unchanged. **Known gap:** BB's open-in-split sidebar row keeps a faint pink tint. It
  is an oklch mix BB sets on its own class, which the theme can't reach through tokens.
- **D9** (where the long e2e runs) is still open.
- **D12. Light mode only (2026-09-28).** The brand is light mode only (brand `ef29ca3`), and so
  is Tutor. This supersedes decision 5 and acceptance criterion 5.
  - The brand theme's one block is `:root, .light, .dark` with `color-scheme: light`. It pins
    every value BB's `.dark` changes to BB's light values, so someone who picks dark mode in BB
    still gets paper and ink. The oklab re-mixes of D11 stay.
  - `codeTheme.dark` names the light code theme. The field is optional in BB's schema, but BB
    falls back to its own dark code theme when it is missing, which would put dark code blocks on
    a paper page. `sketchbook-code-dark.json` is gone.
  - The kit's dark role block, its paper patch (`sk-patch`) and the `Patch` component are gone.
    Drawings sit straight on the page in a plain `.tp-drawing` wrapper that lays out as before.
    The kit transform refuses a `.dark` or `.sk-dark` selector.
  - `theme.test.ts` checks that the built theme has that one block and no separate `.dark` one,
    and that every BB grey and role resolves to the same colour with `.dark` as without it. The
    warm-grey tests stay. The mockup and the e2e scripts lost their dark screens.
- **D13. Bigger thread text (2026-09-28).** Patrick Hand is small for its size, so BB's 13-15px
  thread text read tiny. The brand theme (brand `71944a2`) now makes the thread 1.5 times bigger.
  - A second rule on `[data-thread-window]` (BB's thread pane: the timeline and the message box,
    not the sidebar or the thread's header) sets BB's `--text-*` sizes to BB's own values times
    `--sk-thread-text-scale: 1.5`. BB's phone sizes (`(width <= 767px) and (pointer: coarse)`)
    are mirrored the same way. A size can't be defined from itself, so BB's values are written
    out; line heights BB gives as a ratio grow with the text.
  - List indents in the thread grow by the same scale. Without that, a user message's bubble cut
    the bigger bullets off.
  - 1.5 is the low end of what was asked (150-200%). 1.75 and 2 were tried: both work, but at 2
    code blocks scroll sideways sooner and BB's fixed-height rows (the tool rows, the project and
    branch row under the message box) are tight.
  - No CSS `zoom`: the variables grow the text alone, and the timeline, which measures its rows,
    scrolls as before. Not scaled: BB's few fixed px sizes, and Tutor's own cards in the thread,
    which keep their px sizes and now read smaller than the text around them.
  - `theme.test.ts` allows the thread rules after the one colour block, pins the sizes against
    BB 0.43.4's, and checks nothing outside the thread pane sets `--text-*`.
