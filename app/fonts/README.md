# Fonts

Self-hosted Latin subsets, copied unchanged from `tutorial-engine/web-workbook/src/fonts/` on the
`workbook-tutor` branch of `software-factory-tutorial` (commit `2d0194bf`). That code is MIT
licensed; the typefaces themselves are under the SIL Open Font License 1.1:

| File | Typeface |
|---|---|
| `archivo-variable.woff2` | Archivo (variable, 300–800) |
| `jetbrains-mono-variable.woff2` | JetBrains Mono (variable, 100–800) |
| `spectral-400.woff2`, `spectral-500.woff2`, `spectral-600.woff2` | Spectral |

`../paper.css` registers them under `Tutor …` family names so they can never shadow a font BB or
another plugin loads.

The Archivo face leaves out U+0020 and U+00A0 (`unicode-range`), so word spaces come from the
fallback sans-serif: Archivo's own 0.2em space runs words together at the rail's small sizes. The
file itself matches Google Fonts' Archivo Latin subset (same space advance, `HVAR` and widths).
