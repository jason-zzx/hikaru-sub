import type { CSSProperties } from "react";
import {
  assColorToCss,
  parseAssColor,
  rgbaToAssColor,
  type AssInlineOverrides,
  type AssStyle,
  type AssScriptInfo,
} from "@/lib/ass";
import {
  assFontFamily,
  assFontWeight,
  buildTextShadow,
  scaleAssFontSize,
  scaleAssLength,
  type AssViewport,
} from "./assStyleCss";

function effectiveColor(
  base: AssStyle,
  inline: AssInlineOverrides,
): string {
  const assColor = inline.primaryColor ?? base.primaryColor;
  const { r, g, b, a } = parseAssColor(assColor);
  const alpha = inline.primaryAlpha ?? a;
  if (alpha >= 1) {
    return assColorToCss(assColor);
  }
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

function textDecoration(
  base: AssStyle,
  inline: AssInlineOverrides,
): CSSProperties["textDecorationLine"] {
  const underline = inline.underline ?? base.underline;
  const strikeOut = inline.strikeOut ?? base.strikeOut;
  const parts: string[] = [];
  if (underline) parts.push("underline");
  if (strikeOut) parts.push("line-through");
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** Rebuild an ASS color string with an inline alpha override baked into the alpha byte. */
function colorWithAlpha(assColor: string, alpha: number | undefined): string {
  if (alpha === undefined) return assColor;
  const { r, g, b } = parseAssColor(assColor);
  return rgbaToAssColor({ r, g, b, a: alpha });
}

function shadowStyle(base: AssStyle, inline: AssInlineOverrides): AssStyle {
  return {
    ...base,
    outline: inline.outline ?? base.outline,
    shadow: inline.shadow ?? base.shadow,
    outlineColor: colorWithAlpha(
      inline.outlineColor ?? base.outlineColor,
      inline.outlineAlpha,
    ),
    backColor: colorWithAlpha(
      inline.backColor ?? base.backColor,
      inline.backAlpha,
    ),
  };
}

/** 将 base Style + 行内 override 映射为 span 级 CSS。 */
export function assInlineToCss(
  base: AssStyle,
  inline: AssInlineOverrides,
  scriptInfo: AssScriptInfo | null,
  viewport: AssViewport,
): CSSProperties {
  const bold = inline.bold ?? base.bold;
  const fontSize = scaleAssFontSize(
    inline.fontSize ?? base.fontSize,
    scriptInfo,
    viewport,
  );
  const spacing = scaleAssLength(
    inline.spacing ?? base.spacing,
    "x",
    scriptInfo,
    viewport,
  );
  const scaleX = (inline.scaleX ?? base.scaleX) / 100;
  const scaleY = (inline.scaleY ?? base.scaleY) / 100;
  const fontName = inline.fontName ?? base.fontName;
  const fontWeight = assFontWeight(fontName, bold);

  const css: CSSProperties = {
    display: "inline",
    color: effectiveColor(base, inline),
    fontFamily: assFontFamily(fontName, bold),
    fontSize,
    fontWeight,
    fontStyle: (inline.italic ?? base.italic) ? "italic" : "normal",
    textDecorationLine: textDecoration(base, inline),
    letterSpacing: spacing,
    textShadow:
      buildTextShadow(shadowStyle(base, inline), scriptInfo, viewport) ??
      "none",
  };

  if (scaleX !== 1 || scaleY !== 1) {
    css.transform = `scale(${scaleX}, ${scaleY})`;
    css.transformOrigin = "center bottom";
  }

  return css;
}
