# Fonts

The Sketchbook brand's three families (`vendor/brand/kit/tokens.json`, `font`), self-hosted as
Latin 400 woff2 files copied unchanged from the [Fontsource](https://fontsource.org) 5.3.0 npm
packages (`files/*-latin-400-normal.woff2`, fetched with `npm pack @fontsource/<id>@5.3.0`).
Fontsource builds them from [google/fonts](https://github.com/google/fonts). They are not a
dependency: only the files are copied in.

| File | Family | Source | sha256 | Licence | Copyright |
|---|---|---|---|---|---|
| `luckiest-guy-latin-400-normal.woff2` | Luckiest Guy | `@fontsource/luckiest-guy@5.3.0` | `3877b522181765adf66ba89bd68d288ecb9f2483b441baab3424646b0c7aaa0a` | Apache-2.0 ([`LICENSES/luckiest-guy.txt`](LICENSES/luckiest-guy.txt)) | Copyright (c) 2010 by Brian J. Bonislawsky DBA Astigmatic (AOETI) |
| `patrick-hand-latin-400-normal.woff2` | Patrick Hand | `@fontsource/patrick-hand@5.3.0` | `ac5bc9033b2572bf84d39f7150c1634e37ed16e8dbee632d6d0bceac0bbf0199` | OFL-1.1 ([`LICENSES/patrick-hand.txt`](LICENSES/patrick-hand.txt)) | Copyright (c) 2010-2012 Patrick Wagesreiter |
| `patrick-hand-sc-latin-400-normal.woff2` | Patrick Hand SC | `@fontsource/patrick-hand-sc@5.3.0` | `681b6be08abd18d3e27d49d85f525a9c73c25fdc70f106febac0040eb3c3be59` | OFL-1.1 ([`LICENSES/patrick-hand-sc.txt`](LICENSES/patrick-hand-sc.txt)) | Copyright 2012 The Patrick Hand Authors |

`LICENSES/` holds each package's `LICENSE` file unchanged. The copyright lines come from each
package's `metadata.json` (`license.attribution`).

`embed.ts` registers them as `Tutor Luckiest Guy`, `Tutor Patrick Hand` and `Tutor Patrick Hand SC`
(weight 400, `font-display: swap`, Fontsource's Latin `unicode-range`) in the generated `fonts.css`,
so they can never shadow a font BB or another plugin loads. The theme inlines only Patrick Hand.
Code and diffs on Tutor surfaces use BB's `var(--font-mono)`.
