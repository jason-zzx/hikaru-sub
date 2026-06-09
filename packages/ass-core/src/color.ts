/**
 * ASS 颜色工具。
 * ASS 颜色串为 `&HAABBGGRR`（或 `&HBBGGRR` 无 alpha），字节序为 ABGR。
 * alpha 语义与常规相反：0x00 = 不透明，0xFF = 全透明。
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** CSS 风格 alpha：0=透明，1=不透明 */
  a: number;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHexByte(n: number): string {
  return clampByte(n).toString(16).toUpperCase().padStart(2, "0");
}

/** 解析 ASS 颜色串为 RGBA。无法解析时回退为不透明白色。 */
export function parseAssColor(input: string): Rgba {
  const hex = input.trim().replace(/^&H/i, "").replace(/&$/, "");
  if (!/^[0-9a-fA-F]{6,8}$/.test(hex)) {
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  const padded = hex.padStart(8, "0");
  const aa = parseInt(padded.slice(0, 2), 16);
  const bb = parseInt(padded.slice(2, 4), 16);
  const gg = parseInt(padded.slice(4, 6), 16);
  const rr = parseInt(padded.slice(6, 8), 16);
  return { r: rr, g: gg, b: bb, a: (255 - aa) / 255 };
}

/** RGBA 转 ASS 颜色串 `&HAABBGGRR`。 */
export function rgbaToAssColor({ r, g, b, a }: Rgba): string {
  const aa = clampByte((1 - a) * 255);
  return `&H${toHexByte(aa)}${toHexByte(b)}${toHexByte(g)}${toHexByte(r)}`;
}

/** ASS 颜色串转 CSS（`#RRGGBB` 或 `rgba(...)`，含半透明时用 rgba）。 */
export function assColorToCss(input: string): string {
  const { r, g, b, a } = parseAssColor(input);
  if (a >= 1) {
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

/** `#RRGGBB` / `#RGB` 十六进制转 ASS 颜色串，alpha 默认不透明。 */
export function hexToAssColor(hex: string, alpha = 1): string {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    return "&H00FFFFFF";
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return rgbaToAssColor({ r, g, b, a: alpha });
}
