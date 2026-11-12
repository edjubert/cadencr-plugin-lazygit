import type { ThemeSnapshot } from "@cadencr/tab-sdk";
import type { ITheme } from "@xterm/xterm";

/** Resolve CSS colors in the browser; the backend accepts only six-digit hex. */
function hex(value: string, fallback: string): string {
  if (!CSS.supports("color", value)) return fallback;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  return "#" + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0")).join("");
}

type Rgb = [number, number, number];
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const parse = (value: string): Rgb => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
const format = (color: Rgb): string =>
  "#" + color.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
const mix = (from: Rgb, to: Rgb, weight: number): Rgb => from.map((v, i) => v + (to[i] - v) * weight) as Rgb;

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z), min = Math.min(x, y, z), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === x ? ((y - z) / d) % 6 : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Move lightness away from the background until the text is readable (WCAG 4.5:1). */
function readable(h: number, s: number, l: number, background: Rgb, light: boolean): Rgb {
  let color = fromHsl(h, s, l);
  while (contrast(color, background) < 4.5 && l > 0.05 && l < 0.95) {
    l += light ? -0.02 : 0.02;
    color = fromHsl(h, s, l);
  }
  return color;
}

function ansiColors(base: Record<string, string>, light: boolean): Record<string, string> {
  const bg = parse(base.background);
  const fg = parse(base.foreground);
  const dark = light ? fg : bg;
  const clear = light ? bg : fg;
  const saturation = clamp(toHsl(parse(base.primary))[1], 0.45, 0.85);
  const start = light ? 0.4 : 0.65;
  const shift = light ? -0.08 : 0.08;
  const tone = (hue: number, extra = 0) =>
    readable(hue, saturation, clamp(start + extra, 0.05, 0.95), bg, light);
  const fit = (value: string, extra = 0) => {
    const [h, s, l] = toHsl(parse(value));
    return readable(h, s, clamp(l + extra, 0.05, 0.95), bg, light);
  };
  return {
    black: format(mix(dark, clear, 0.1)),
    red: format(fit(base.error)),
    green: format(tone(140)),
    yellow: format(tone(50)),
    blue: format(fit(base.primary)),
    magenta: format(tone(300)),
    cyan: format(tone(185)),
    white: format(mix(dark, clear, 0.9)),
    brightBlack: format(parse(base.muted)),
    brightRed: format(fit(base.error, shift)),
    brightGreen: format(tone(140, shift)),
    brightYellow: format(tone(50, shift)),
    brightBlue: format(fit(base.primary, shift)),
    brightMagenta: format(tone(300, shift)),
    brightCyan: format(tone(185, shift)),
    brightWhite: format(clear),
  };
}

export function terminalTheme(snapshot: ThemeSnapshot): ITheme {
  const base = resolve(snapshot);
  return {
    background: base.background,
    foreground: base.foreground,
    cursor: base.foreground,
    selectionBackground: base.selection,
    ...ansiColors(base, snapshot.appearance === "light"),
  };
}

export function palette(snapshot: ThemeSnapshot): Record<string, string> {
  const base = resolve(snapshot);
  return { ...base, warning: ansiColors(base, snapshot.appearance === "light").yellow };
}

function resolve(snapshot: ThemeSnapshot): Record<string, string> {
  const tokens = snapshot.tokens;
  const light = snapshot.appearance === "light";
  return {
    background: hex(tokens.background, light ? "#ffffff" : "#101218"),
    foreground: hex(tokens.foreground, light ? "#202020" : "#e2e4e9"),
    muted: hex(tokens["muted-foreground"], "#9297a5"),
    border: hex(tokens.border, "#424655"),
    primary: hex(tokens.primary ?? tokens.accent, "#23b5d3"),
    selection: hex(tokens.accent, light ? "#dce8f0" : "#343a49"),
    error: hex(tokens.destructive, "#f38ba8"),
  };
}
