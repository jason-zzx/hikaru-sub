import type { CSSProperties } from "react";
import {
  assColorToCss,
  parseAssColor,
  type AssInlineOverrides,
  type AssStyle,
  type AssScriptInfo,
} from "@hikaru/ass-core";
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

function shadowStyle(base: AssStyle, inline: AssInlineOverrides): AssStyle {
  return {
    ...base,
    outline: inline.outline ?? base.outline,
    shadow: inline.shadow ?? base.shadow,
    outlineColor: inline.outlineColor ?? base.outlineColor,
    backColor: inline.backColor ?? base.backColor,
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
