import {
  parseAssColor,
  rgbaToAssColor,
  type Rgba,
} from "@hikaru/ass-core";

export type RGBA = Rgba;

/** ASS `&HAABBGGRR` -> RGBA. Invalid input falls back to opaque white. */
export function assToRgba(ass: string): RGBA {
  return parseAssColor(ass);
}

/** RGBA -> ASS `&HAABBGGRR`. Channels and alpha are clamped by ass-core. */
export function rgbaToAss(rgba: RGBA): string {
  return rgbaToAssColor(rgba);
}
