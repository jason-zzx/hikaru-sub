import {
  parseAssColor,
  rgbaToAssColor,
  type Rgba,
} from "@/lib/ass";

export type RGBA = Rgba;

/** ASS `&HAABBGGRR` -> RGBA. Invalid input falls back to opaque white. */
export function assToRgba(ass: string): RGBA {
  return parseAssColor(ass);
}

/** RGBA -> ASS `&HAABBGGRR`. Channels and alpha are clamped by the ASS module. */
export function rgbaToAss(rgba: RGBA): string {
  return rgbaToAssColor(rgba);
}
