import type { CSSProperties } from "react";
import {
  assColorToCss,
  createDefaultScriptInfo,
  createDefaultStyles,
  getCueDisplay,
  PRIMARY_STYLE,
  SECONDARY_STYLE,
  type AssScriptInfo,
  type AssStyle,
  type SubtitleCue,
} from "@hikaru/ass-core";

export interface AssViewport {
  width: number;
  height: number;
}

export interface AssPlacement {
  vertical: "top" | "middle" | "bottom";
  horizontal: "left" | "center" | "right";
}

export interface AssRenderItem {
  key: string;
  text: string;
  style: AssStyle;
}

const DEFAULT_SCRIPT_INFO = createDefaultScriptInfo();

function effectiveScriptInfo(scriptInfo: AssScriptInfo | null): AssScriptInfo {
  return scriptInfo ?? DEFAULT_SCRIPT_INFO;
}

function effectiveViewport(viewport: AssViewport): AssViewport {
  return {
    width: viewport.width > 0 ? viewport.width : DEFAULT_SCRIPT_INFO.playResX,
    height: viewport.height > 0 ? viewport.height : DEFAULT_SCRIPT_INFO.playResY,
  };
}

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scaleAssLength(
  value: number,
  axis: "x" | "y",
  scriptInfo: AssScriptInfo | null,
  viewport: AssViewport,
): number {
  const info = effectiveScriptInfo(scriptInfo);
  const view = effectiveViewport(viewport);
  const base = axis === "x" ? info.playResX : info.playResY;
  const size = axis === "x" ? view.width : view.height;
  if (base <= 0) return value;
  return roundPx(value * (size / base));
}

export function findAssStyle(styles: AssStyle[], styleName?: string): AssStyle {
  const defaults = createDefaultStyles();
  const allStyles = styles.length > 0 ? styles : defaults;
  const fallbackPrimary = allStyles.find((style) => style.name === PRIMARY_STYLE);
  const fallback = fallbackPrimary ?? allStyles[0] ?? defaults[0];

  if (!styleName) return fallback;
  return allStyles.find((style) => style.name === styleName) ?? fallback;
}

export function assAlignmentToPlacement(alignment: number): AssPlacement {
  switch (alignment) {
    case 1:
      return { vertical: "bottom", horizontal: "left" };
    case 2:
      return { vertical: "bottom", horizontal: "center" };
    case 3:
      return { vertical: "bottom", horizontal: "right" };
    case 4:
      return { vertical: "middle", horizontal: "left" };
    case 5:
      return { vertical: "middle", horizontal: "center" };
    case 6:
      return { vertical: "middle", horizontal: "right" };
    case 7:
      return { vertical: "top", horizontal: "left" };
    case 8:
      return { vertical: "top", horizontal: "center" };
    case 9:
      return { vertical: "top", horizontal: "right" };
    default:
      return { vertical: "bottom", horizontal: "center" };
  }
}

function textDecoration(style: AssStyle): CSSProperties["textDecorationLine"] {
  const decorations: string[] = [];
  if (style.underline) decorations.push("underline");
  if (style.strikeOut) decorations.push("line-through");
  return decorations.length > 0 ? decorations.join(" ") : undefined;
}

export function buildTextShadow(
  style: AssStyle,
  scriptInfo: AssScriptInfo | null,
  viewport: AssViewport,
): string | undefined {
  const outline = scaleAssLength(style.outline, "y", scriptInfo, viewport);
  const shadow = scaleAssLength(style.shadow, "y", scriptInfo, viewport);
  const outlineColor = assColorToCss(style.outlineColor);
  const shadowColor = assColorToCss(style.backColor);
  const shadows: string[] = [];

  if (style.borderStyle !== 3 && outline > 0) {
    const px = Math.max(1, Math.round(outline));
    const offsets = [
      [-px, 0],
      [px, 0],
      [0, -px],
      [0, px],
      [-px, -px],
      [px, -px],
      [-px, px],
      [px, px],
    ];
    shadows.push(...offsets.map(([x, y]) => `${x}px ${y}px 0 ${outlineColor}`));
  }

  if (shadow > 0) {
    const px = Math.max(1, Math.round(shadow));
    shadows.push(`${px}px ${px}px ${px}px ${shadowColor}`);
  }

  return shadows.length > 0 ? shadows.join(", ") : undefined;
}

export function placementToCss(
  style: AssStyle,
  scriptInfo: AssScriptInfo | null,
  viewport: AssViewport,
): CSSProperties {
  const placement = assAlignmentToPlacement(style.alignment);
  const marginL = scaleAssLength(style.marginL, "x", scriptInfo, viewport);
  const marginR = scaleAssLength(style.marginR, "x", scriptInfo, viewport);
  const marginV = scaleAssLength(style.marginV, "y", scriptInfo, viewport);
  const css: CSSProperties = {
    position: "absolute",
    textAlign: placement.horizontal,
    whiteSpace: "pre-wrap",
    pointerEvents: "none",
  };
  const transforms: string[] = [];

  if (placement.vertical === "top") {
    css.top = marginV;
  } else if (placement.vertical === "middle") {
    css.top = "50%";
    transforms.push("translateY(-50%)");
  } else {
    css.bottom = marginV;
  }

  // 水平居中用 left+right 约束宽度，避免 left:50% 时可用宽度只剩右半区导致误换行。
  if (placement.horizontal === "left") {
    css.left = marginL;
  } else if (placement.horizontal === "center") {
    css.left = marginL;
    css.right = marginR;
  } else {
    css.right = marginR;
  }

  if (transforms.length > 0) {
    css.transform = transforms.join(" ");
  }

  return css;
}

function alignmentToTransformOrigin(alignment: number): string {
  const placement = assAlignmentToPlacement(alignment);
  const x =
    placement.horizontal === "left"
      ? "0%"
      : placement.horizontal === "right"
        ? "100%"
        : "50%";
  const y =
    placement.vertical === "top"
      ? "0%"
      : placement.vertical === "bottom"
        ? "100%"
        : "50%";
  return `${x} ${y}`;
}

export function assStyleToCss(
  style: AssStyle,
  scriptInfo: AssScriptInfo | null,
  viewport: AssViewport,
): CSSProperties {
  const placementCss = placementToCss(style, scriptInfo, viewport);
  const fontSize = scaleAssLength(style.fontSize, "y", scriptInfo, viewport);
  const spacing = scaleAssLength(style.spacing, "x", scriptInfo, viewport);
  const decorations = textDecoration(style);
  const transforms: string[] = [];
  if (placementCss.transform) transforms.push(String(placementCss.transform));
  if (style.scaleX !== 100 || style.scaleY !== 100) {
    transforms.push(`scale(${style.scaleX / 100}, ${style.scaleY / 100})`);
  }

  return {
    ...placementCss,
    color: assColorToCss(style.primaryColor),
    fontFamily: `"${style.fontName}", sans-serif`,
    fontSize,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textDecorationLine: decorations,
    letterSpacing: spacing,
    lineHeight: 1.2,
    textShadow: buildTextShadow(style, scriptInfo, viewport),
    backgroundColor:
      style.borderStyle === 3 ? assColorToCss(style.backColor) : undefined,
    borderRadius: style.borderStyle === 3 ? 4 : undefined,
    padding:
      style.borderStyle === 3
        ? `${Math.max(2, scaleAssLength(style.outline, "y", scriptInfo, viewport))}px ${Math.max(
            4,
            scaleAssLength(style.outline * 2, "x", scriptInfo, viewport),
          )}px`
        : undefined,
    transformOrigin: alignmentToTransformOrigin(style.alignment),
    transform: transforms.length > 0 ? transforms.join(" ") : undefined,
  };
}

export function resolveAssRenderItems(
  cue: SubtitleCue,
  styles: AssStyle[],
  mergeMode: "inline" | "separate",
): AssRenderItem[] {
  const display = getCueDisplay(cue, mergeMode);
  if (display.mode === "single") {
    return [
      {
        key: `${cue.id}-inline`,
        text: display.text,
        style: findAssStyle(styles, cue.style),
      },
    ];
  }

  return [
    {
      key: `${cue.id}-primary`,
      text: display.primaryText,
      style: findAssStyle(styles, cue.style),
    },
    {
      key: `${cue.id}-secondary`,
      text: display.secondaryText,
      style: findAssStyle(styles, SECONDARY_STYLE),
    },
  ];
}
