// A small CSS colour resolver, enough to check the theme's contrast without a
// browser: #rgb/#rrggbb, rgb(), oklch(), oklab(), color-mix(in oklch|oklab|srgb, …)
// and var(--x, fallback) against a token map. It returns sRGB and follows
// Chromium where CSS leaves room (checked against color-fixture.json, recorded
// in Chromium by scripts/record-color-fixture.mjs):
// - a colour converted into oklch with chroma <= 0.02 has a missing hue, so a
//   mix takes the other colour's hue, and a missing hue renders as 0;
// - color-mix interpolates premultiplied, with the shorter hue arc in oklch;
// - out-of-gamut sRGB is clipped.

export type Tokens = Readonly<Record<string, string>>;

type Space = "srgb" | "oklab" | "oklch";

/** A colour in one space; `null` is a missing (`none`) component. sRGB is gamma-encoded, 0–1. */
export interface Colour {
  space: Space;
  c: [number | null, number | null, number | null];
  alpha: number;
}

/** Chromium treats a hue as missing below this oklch chroma when converting into oklch. */
const ACHROMATIC_CHROMA = 0.02;

// ------------------------------------------------------------------ parsing

/** Splits `s` at top-level (not parenthesised) occurrences of `sep`. */
function splitTop(s: string, sep: string, limit = Infinity): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === sep && depth === 0 && parts.length < limit - 1) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((part) => part.trim());
}

/** `name(body)` when `s` is exactly one function call. */
function asFunction(s: string): { name: string; body: string } | undefined {
  const match = /^([a-z-]+)\(/i.exec(s);
  if (!match?.[1] || !s.endsWith(")")) return undefined;
  let depth = 0;
  for (let i = match[1].length; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) {
      if (i !== s.length - 1) return undefined;
      return { name: match[1].toLowerCase(), body: s.slice(match[1].length + 1, -1) };
    }
  }
  return undefined;
}

function number(token: string, percentScale: number, context: string): number | null {
  if (token === "none") return null;
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)(%|deg)?$/i.exec(token);
  if (!match?.[1]) throw new Error(`cannot read ${JSON.stringify(token)} in ${context}`);
  const value = Number(match[1]);
  return match[2] === "%" ? (value / 100) * percentScale : value;
}

/** The three components and alpha of rgb()/oklch()/oklab(), modern or legacy comma syntax. */
function components(body: string, context: string): { parts: string[]; alpha: string | undefined } {
  const [main = "", slashAlpha, ...rest] = splitTop(body, "/");
  if (rest.length > 0) throw new Error(`cannot read ${context}`);
  const parts = main.split(/[\s,]+/).filter(Boolean);
  let alpha = slashAlpha;
  if (alpha === undefined && parts.length === 4) alpha = parts.pop();
  if (parts.length !== 3) throw new Error(`cannot read ${context}`);
  return { parts, alpha };
}

function parseAlpha(token: string | undefined, context: string): number {
  if (token === undefined) return 1;
  return number(token, 1, context) ?? 0;
}

function parseHex(hex: string): Colour {
  const digits = hex.slice(1);
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(digits)) throw new Error(`not a #rgb or #rrggbb colour: ${hex}`);
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  const value = Number.parseInt(full, 16);
  return { space: "srgb", c: [(value >> 16) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255], alpha: 1 };
}

const KEYWORDS: Record<string, Colour> = {
  transparent: { space: "srgb", c: [0, 0, 0], alpha: 0 },
  black: { space: "srgb", c: [0, 0, 0], alpha: 1 },
  white: { space: "srgb", c: [1, 1, 1], alpha: 1 },
};

function parse(expr: string, tokens: Tokens, stack: readonly string[]): Colour {
  const e = expr.trim();
  if (e.startsWith("#")) return parseHex(e);
  const keyword = KEYWORDS[e.toLowerCase()];
  if (keyword) return { ...keyword, c: [...keyword.c] };
  const fn = asFunction(e);
  if (!fn) throw new Error(`unsupported colour ${JSON.stringify(e)}`);
  switch (fn.name) {
    case "var": {
      const [name = "", fallback] = splitTop(fn.body, ",", 2);
      if (stack.includes(name)) throw new Error(`var() cycle: ${[...stack, name].join(" -> ")}`);
      const value = tokens[name];
      if (value !== undefined) return parse(value, tokens, [...stack, name]);
      if (fallback !== undefined) return parse(fallback, tokens, stack);
      throw new Error(`${name} is not set and var() has no fallback`);
    }
    case "rgb":
    case "rgba": {
      const { parts, alpha } = components(fn.body, e);
      const c = parts.map((p) => {
        const v = number(p, 255, e);
        return v === null ? null : v / 255;
      }) as Colour["c"];
      return { space: "srgb", c, alpha: parseAlpha(alpha, e) };
    }
    case "oklch": {
      const { parts, alpha } = components(fn.body, e);
      const [l = "", ch = "", h = ""] = parts;
      return { space: "oklch", c: [number(l, 1, e), number(ch, 0.4, e), number(h, 1, e)], alpha: parseAlpha(alpha, e) };
    }
    case "oklab": {
      const { parts, alpha } = components(fn.body, e);
      const [l = "", a = "", b = ""] = parts;
      return { space: "oklab", c: [number(l, 1, e), number(a, 0.4, e), number(b, 0.4, e)], alpha: parseAlpha(alpha, e) };
    }
    case "color-mix":
      return parseMix(fn.body, tokens, stack, e);
    default:
      throw new Error(`unsupported colour function ${fn.name}() in ${JSON.stringify(e)}`);
  }
}

function parseMix(body: string, tokens: Tokens, stack: readonly string[], context: string): Colour {
  const [method = "", first = "", second = "", ...rest] = splitTop(body, ",");
  const space = /^in\s+(oklch|oklab|srgb)(?:\s+shorter\s+hue)?$/i.exec(method)?.[1]?.toLowerCase() as Space | undefined;
  if (!space || rest.length > 0 || !second) throw new Error(`unsupported color-mix: ${context}`);
  const [a, b] = [first, second].map((arg) => {
    const trailing = /^(.*\S)\s+(-?[\d.]+)%$/s.exec(arg);
    const leading = /^(-?[\d.]+)%\s+(.*)$/s.exec(arg);
    if (trailing?.[1] && trailing[2]) return { colour: parse(trailing[1], tokens, stack), p: Number(trailing[2]) };
    if (leading?.[1] && leading[2]) return { colour: parse(leading[2], tokens, stack), p: Number(leading[1]) };
    return { colour: parse(arg, tokens, stack), p: undefined };
  }) as [{ colour: Colour; p: number | undefined }, { colour: Colour; p: number | undefined }];
  // CSS Color 5 percentage normalisation.
  let p1 = a.p;
  let p2 = b.p;
  if (p1 === undefined && p2 === undefined) [p1, p2] = [50, 50];
  else if (p1 === undefined) p1 = 100 - (p2 ?? 0);
  else if (p2 === undefined) p2 = 100 - p1;
  const sum = (p1 ?? 0) + (p2 ?? 0);
  if (sum === 0) throw new Error(`color-mix percentages sum to zero: ${context}`);
  return mix(space, a.colour, b.colour, (p2 ?? 0) / sum, Math.min(sum, 100) / 100);
}

// -------------------------------------------------------------- conversion

function toLinear(v: number): number {
  const s = Math.abs(v);
  return Math.sign(v) * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
}
function toGamma(v: number): number {
  const s = Math.abs(v);
  return Math.sign(v) * (s <= 0.0031308 ? s * 12.92 : 1.055 * s ** (1 / 2.4) - 0.055);
}

function srgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToSrgb([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toGamma) as [number, number, number];
}

const filled = (c: Colour["c"]): [number, number, number] => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];

function convert(colour: Colour, to: Space): Colour {
  if (colour.space === to) return colour;
  let lab: [number, number, number];
  if (colour.space === "srgb") lab = srgbToOklab(filled(colour.c));
  else if (colour.space === "oklab") lab = filled(colour.c);
  else {
    const [L, C, h] = filled(colour.c);
    const rad = (h * Math.PI) / 180;
    lab = [L, C * Math.cos(rad), C * Math.sin(rad)];
  }
  if (to === "oklab") return { space: "oklab", c: lab, alpha: colour.alpha };
  if (to === "srgb") return { space: "srgb", c: oklabToSrgb(lab), alpha: colour.alpha };
  const [L, a, b] = lab;
  const C = Math.hypot(a, b);
  const hue = C <= ACHROMATIC_CHROMA ? null : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { space: "oklch", c: [L, C, hue], alpha: colour.alpha };
}

/** color-mix: `t` is the second colour's share after normalisation, `alphaScale` the leftover when the percentages sum under 100. */
function mix(space: Space, first: Colour, second: Colour, t: number, alphaScale: number): Colour {
  const x = convert(first, space);
  const y = convert(second, space);
  const alpha = x.alpha * (1 - t) + y.alpha * t;
  const c: Colour["c"] = [null, null, null];
  for (let i = 0; i < 3; i++) {
    let u = x.c[i] ?? null;
    let v = y.c[i] ?? null;
    if (u === null && v === null) continue;
    u ??= v as number;
    v ??= u;
    if (space === "oklch" && i === 2) {
      if (v - u > 180) u += 360;
      else if (v - u < -180) v += 360;
      c[i] = ((u * (1 - t) + v * t) % 360 + 360) % 360;
    } else {
      const premultiplied = u * x.alpha * (1 - t) + v * y.alpha * t;
      c[i] = alpha === 0 ? premultiplied : premultiplied / alpha;
    }
  }
  return { space, c, alpha: alpha * alphaScale };
}

// ------------------------------------------------------------------ public

/** Resolves a CSS colour expression against `tokens`; throws on anything it cannot read. */
export function resolveColor(expr: string, tokens: Tokens): Colour {
  return parse(expr, tokens, []);
}

/** Gamma-encoded sRGB, clipped to 0–1. */
export function toSrgb(colour: Colour): [number, number, number] {
  return filled(convert(colour, "srgb").c).map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

/** sRGB scaled to 0–255, unrounded, for comparing with 8-bit readbacks. */
export function toBytes(colour: Colour): [number, number, number] {
  return toSrgb(colour).map((v) => v * 255) as [number, number, number];
}

/** `top` composited over `bottom` in sRGB, as a browser paints it. */
export function over(top: Colour, bottom: Colour): Colour {
  const t = toSrgb(top);
  const b = toSrgb(bottom);
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha);
  const c = t.map((v, i) => (alpha === 0 ? 0 : (v * top.alpha + (b[i] ?? 0) * bottom.alpha * (1 - top.alpha)) / alpha));
  return { space: "srgb", c: c as [number, number, number], alpha };
}

/** WCAG 2 relative luminance of an opaque colour. */
export function luminance(colour: Colour): number {
  const [r, g, b] = toSrgb(colour).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two opaque colours (expressions are resolved with no tokens). */
export function contrast(a: Colour | string, b: Colour | string): number {
  const [x, y] = [a, b].map((c) => (typeof c === "string" ? resolveColor(c, {}) : c)) as [Colour, Colour];
  for (const c of [x, y]) if (c.alpha < 1) throw new Error("contrast of a translucent colour: composite it with over() first");
  const [light, dark] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
