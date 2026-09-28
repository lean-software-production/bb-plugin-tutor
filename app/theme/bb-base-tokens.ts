// BB's own values for the tokens a theme's contrast depends on, per mode, so
// the theme test can resolve what BB paints when a theme leaves a token unset
// (--sidebar, --secondary, --muted, --sidebar-accent and --surface-selected
// are derived from the theme's --ink, --canvas and --primary). It also holds
// every other grey BB mixes from --ink and --canvas in oklch, so the theme
// test can check the theme re-mixes each one (see theme.test.ts).
//
// Copied from bb-app 0.44.0's app/dist/assets/index-*.css: the `:root,.light`
// and `.dark` blocks, taking the `@supports (color: color-mix(…))` value where
// BB gives one. bb-app 0.43.4 (the version CI builds with) has identical
// values for every token here. Re-check on each bb bump.
//
// The cascade the theme test models, in order: BB light, then BB dark (when
// BB's `.dark` class is on <html>), then the theme's one block. The theme is
// light mode only: its block is `:root, .light, .dark`, injected after BB's
// CSS with equal specificity, so its values beat BB's `.dark` ones and the
// page stays light when someone picks dark mode (theme.test.ts).
import type { Tokens } from "./color.ts";

export const BB_VERSION = "0.44.0";

export const BB_BASE_TOKENS: { light: Tokens; dark: Tokens } = {
  light: {
    "--canvas": "oklch(100% 0 0)",
    "--ink": "oklch(32.11% 0 0)",
    "--foreground": "var(--ink)",
    "--sidebar": "color-mix(in oklch, var(--ink) 2.2%, var(--canvas))",
    "--sidebar-foreground": "var(--ink)",
    "--secondary": "color-mix(in oklch, var(--ink) 8%, var(--canvas))",
    "--muted": "color-mix(in oklch, var(--ink) 11%, var(--canvas))",
    "--sidebar-accent": "color-mix(in oklch, var(--ink) 8%, var(--canvas))",
    "--muted-foreground": "oklch(44% 0 0)",
    "--subtle-foreground": "oklch(50% 0 0)",
    "--readback-foreground": "oklch(47% 0 0)",
    "--primary": "oklch(27% 0 0)",
    "--primary-foreground": "oklch(100% 0 0)",
    // Translucent: composite over the canvas before measuring contrast.
    "--surface-selected": "color-mix(in oklab, var(--primary) 16%, transparent)",
    "--destructive": "oklch(45% .19 25.8625)",
    "--destructive-foreground": "oklch(100% 0 0)",
    "--warning-text": "oklch(55% .14 50)",
    "--success": "oklch(70% .15 155)",
    "--timeline-accent": "oklch(55% .1 250)",
    "--file-accent": "var(--timeline-accent)",
    // The rest of BB's ink-into-canvas oklch greys.
    "--sidebar-border": "color-mix(in oklch, var(--ink) 14%, var(--canvas))",
    "--accent": "color-mix(in oklch, var(--ink) 8%, var(--canvas))",
    "--border": "color-mix(in oklch, var(--ink) 14%, var(--canvas))",
    "--border-hairline": "color-mix(in oklch, var(--ink) 14.7%, var(--canvas))",
    "--border-seam": "color-mix(in oklch, var(--ink) 9.5%, var(--canvas))",
    "--input": "color-mix(in oklch, var(--ink) 29.5%, var(--canvas))",
    "--pill-surface": "linear-gradient(to bottom, color-mix(in oklch, var(--ink) 4.4%, var(--canvas)), color-mix(in oklch, var(--ink) 4.7%, var(--canvas)))",
    "--pill-surface-selected":
      "linear-gradient(to bottom, color-mix(in oklch, var(--ink) 11.8%, var(--canvas)), color-mix(in oklch, var(--ink) 13%, var(--canvas)))",
    "--pill-surface-selected-border": "color-mix(in oklch, var(--ink) 19.2%, var(--canvas))",
    "--surface-recessed-soft-solid": "color-mix(in oklch, var(--ink) 4.2%, var(--canvas))",
    "--version-upgrade": "color-mix(in oklch, var(--ink) 96%, var(--canvas))",
  },
  dark: {
    "--canvas": "oklch(19.5% 0 0)",
    "--ink": "oklch(81% 0 0)",
    "--foreground": "var(--ink)",
    "--sidebar": "color-mix(in oklch, var(--ink) 4.3%, var(--canvas))",
    "--sidebar-foreground": "var(--ink)",
    "--secondary": "color-mix(in oklch, var(--ink) 13%, var(--canvas))",
    "--muted": "color-mix(in oklch, var(--ink) 16%, var(--canvas))",
    "--sidebar-accent": "color-mix(in oklch, var(--ink) 12%, var(--canvas))",
    "--muted-foreground": "oklch(78% 0 0)",
    "--subtle-foreground": "oklch(68% 0 0)",
    "--readback-foreground": "oklch(71.5% 0 0)",
    "--primary": "oklch(82% 0 0)",
    "--primary-foreground": "oklch(21.78% 0 0)",
    "--surface-selected": "color-mix(in oklab, var(--primary) 12%, transparent)",
    "--destructive": "oklch(56% .19 22.1703)",
    "--destructive-foreground": "oklch(100% 0 0)",
    "--warning-text": "oklch(75% .16 50)",
    "--success": "oklch(74% .15 155)",
    "--timeline-accent": "oklch(72% .09 250)",
    "--file-accent": "var(--timeline-accent)",
    // The rest of BB's ink-into-canvas oklch greys.
    "--sidebar-border": "color-mix(in oklch, var(--ink) 18.1%, var(--canvas))",
    "--accent": "color-mix(in oklch, var(--ink) 13%, var(--canvas))",
    "--border": "color-mix(in oklch, var(--ink) 19.4%, var(--canvas))",
    "--border-hairline": "color-mix(in oklch, var(--ink) 21%, var(--canvas))",
    "--border-seam": "color-mix(in oklch, var(--ink) 11%, var(--canvas))",
    "--input": "color-mix(in oklch, var(--ink) 32.6%, var(--canvas))",
    "--pill-surface": "linear-gradient(to bottom, color-mix(in oklch, var(--ink) 13%, var(--canvas)), color-mix(in oklch, var(--ink) 11.9%, var(--canvas)))",
    "--pill-surface-selected":
      "linear-gradient(to bottom, color-mix(in oklch, var(--ink) 20.7%, var(--canvas)), color-mix(in oklch, var(--ink) 18.7%, var(--canvas)))",
    "--pill-surface-selected-border": "color-mix(in oklch, var(--ink) 25.2%, var(--canvas))",
    "--surface-recessed-soft-solid": "color-mix(in oklch, var(--ink) 4.2%, var(--canvas))",
    "--version-upgrade": "color-mix(in oklch, var(--ink) 96%, var(--canvas))",
  },
};

/**
 * Every custom property whose value BB's `.dark` blocks change from its
 * `:root, .light` ones (bb-app 0.44.0, `@supports` values included). The
 * theme test checks the theme pins each one it needs to, so dark mode
 * changes nothing a student sees.
 */
export const BB_DARK_MODE_CHANGES: readonly string[] = [
  "--lightningcss-light",
  "--lightningcss-dark",
  "--canvas",
  "--ink",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--accent",
  "--muted",
  "--muted-foreground",
  "--subtle-foreground",
  "--readback-foreground",
  "--timeline-accent",
  "--state-hover",
  "--state-active",
  "--destructive",
  "--destructive-text",
  "--attention",
  "--warning",
  "--warning-text",
  "--success",
  "--diff-added",
  "--diff-removed",
  "--pr-merged",
  "--brand-discord",
  "--border",
  "--border-hairline",
  "--border-seam",
  "--input",
  "--surface-destructive",
  "--surface-destructive-border",
  "--surface-attention",
  "--surface-selected",
  "--pill-surface",
  "--pill-shadow",
  "--pill-surface-selected",
  "--pill-surface-selected-border",
  "--sidebar",
  "--sidebar-accent",
  "--sidebar-border",
  "--sidebar-search-match",
  "--sidebar-search-match-border",
  "--shadow-opacity",
  "--shadow-color",
  "--shadow-2xs",
  "--shadow-xs",
  "--shadow-sm",
  "--shadow",
  "--shadow-md",
  "--shadow-lift",
  "--shadow-lg",
  "--shadow-xl",
  "--shadow-2xl",
  "--ansi-0",
  "--ansi-1",
  "--ansi-2",
  "--ansi-3",
  "--ansi-4",
  "--ansi-5",
  "--ansi-6",
  "--ansi-7",
  "--ansi-8",
  "--ansi-9",
  "--ansi-10",
  "--ansi-11",
  "--ansi-12",
  "--ansi-13",
  "--ansi-14",
  "--ansi-15",
  "--ansi-bg-fg-0",
  "--ansi-bg-fg-1",
  "--ansi-bg-fg-2",
  "--ansi-bg-fg-3",
  "--ansi-bg-fg-4",
  "--ansi-bg-fg-5",
  "--ansi-bg-fg-6",
  "--ansi-bg-fg-7",
  "--ansi-bg-fg-8",
  "--ansi-bg-fg-9",
  "--ansi-bg-fg-10",
  "--ansi-bg-fg-11",
  "--ansi-bg-fg-12",
  "--ansi-bg-fg-13",
  "--ansi-bg-fg-14",
  "--ansi-bg-fg-15",
  "--diffs-dark-bg",
  "--diffs-dark",
  "--diffs-dark-addition-color",
  "--diffs-dark-deletion-color",
];
