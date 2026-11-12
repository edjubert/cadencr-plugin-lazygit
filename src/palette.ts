import type { ThemeSnapshot } from "@cadencr/tab-sdk";

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

export function palette(snapshot: ThemeSnapshot): Record<string, string> {
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
