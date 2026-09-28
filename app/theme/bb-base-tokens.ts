// BB's own values for the tokens a theme's contrast depends on, per mode, so
// the theme test can resolve what BB paints when a theme leaves a token unset
// (--sidebar, --secondary, --muted, --sidebar-accent and --surface-selected
// are derived from the theme's --ink, --canvas and --primary).
//
// Copied from bb-app 0.44.0's app/dist/assets/index-*.css: the `:root,.light`
// and `.dark` blocks, taking the `@supports (color: color-mix(…))` value where
// BB gives one. bb-app 0.43.4 (the version CI builds with) has identical
// values for every token here. Re-check on each bb bump.
//
// The cascade the theme test models, in order: BB light, then BB dark (dark
// mode only), then the theme's `:root, .light`, then its `.dark` (dark mode
// only). The theme is injected after BB's CSS with equal specificity, so its
// `:root` values also beat BB's `.dark` ones.
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
  },
};
