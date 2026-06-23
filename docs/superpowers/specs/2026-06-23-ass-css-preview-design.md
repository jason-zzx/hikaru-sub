# ASS CSS Preview Design

## Purpose

Hikaru-Sub needs a CSS-based ASS subtitle preview that is close enough to FFmpeg/libass output for editing and burn/export decisions, without embedding libass in the frontend. This design covers the first practical version of the preview: common ASS style fields are mapped to CSS, editor preview and BurnView preview share the same renderer, and the UI remains explicit that CSS preview is approximate.

## Current Context

The project already has the right data foundation:

- `packages/ass-core/src/types.ts` models `AssStyle`, `AssScriptInfo`, and `SubtitleCue`.
- `packages/ass-core/src/color.ts` provides ASS color parsing and CSS color conversion.
- `src/stores/projectStore.ts` stores `assScriptInfo` and `assStyles` alongside `cues`.
- Transcription writes `PlayResX/Y` from video resolution into ASS, and translate/edit saves preserve that Script Info.
- `packages/ass-core/src/bilingual.ts` exposes `getCueDisplay`, keeping inline/separate display consistent with serialization.

The current gap is rendering. `src/components/player/VideoPlayer.tsx` still uses hardcoded Tailwind/CSS for subtitle overlay, so it does not honor ASS font, color, outline, margins, alignment, or PlayRes scaling. `src/components/workflow/BurnView.tsx` is still a placeholder and has no reusable preview surface.

## Goals

- Map common ASS V4+ style fields to CSS for an approximate preview.
- Reuse one subtitle overlay renderer in both `VideoPlayer` and future `BurnView`.
- Preserve inline/separate behavior exactly as `getCueDisplay` and `serializeAss` define it.
- Use `AssScriptInfo.playResX/Y` to scale font sizes, outlines, shadows, margins, and positioning into the current video preview box.
- Keep the implementation dependency-free and local to TypeScript/React.
- Make limitations explicit in BurnView: CSS preview is approximate; final hard subtitles are rendered by FFmpeg/libass.

## Non-Goals

- Do not implement libass-level exact rendering.
- Do not support ASS override tags such as `{\pos}`, `{\move}`, `\fad`, `\k`, per-span colors, or inline animation.
- Do not implement karaoke effects.
- Do not build the full subtitle style editor in this phase.
- Do not change ASS serialization semantics.

## Recommended Architecture

Implement a small reusable preview module, instead of putting style logic directly into `VideoPlayer`.

### Files

- `src/utils/assStyleCss.ts`
  - Pure functions for locating styles, scaling ASS coordinates, mapping ASS alignment, and converting `AssStyle` to React CSS.
- `src/components/player/AssSubtitleOverlay.tsx`
  - React component that renders active subtitle cue(s) with CSS mapped from ASS styles.
- `src/components/player/VideoPlayer.tsx`
  - Replace hardcoded `SubtitleOverlay` with `AssSubtitleOverlay`.
- `src/components/workflow/BurnView.tsx`
  - Later reuses `AssSubtitleOverlay` for export preview.
- Tests should live next to the pure mapping utility if the repo test setup supports it, or be covered by `pnpm build` plus targeted test setup added in the implementation plan.

## Style Mapping Scope

First version supports these `AssStyle` fields:

| ASS field | CSS behavior |
| --- | --- |
| `fontName` | `fontFamily` with fallback to sans-serif |
| `fontSize` | scaled by preview height / `PlayResY` |
| `primaryColor` | `color` via `assColorToCss` |
| `bold` | `fontWeight: 700` when true |
| `italic` | `fontStyle: italic` when true |
| `underline` | `textDecorationLine` includes underline |
| `strikeOut` | `textDecorationLine` includes line-through |
| `outlineColor` + `outline` | approximate outline via multi-direction `text-shadow` |
| `shadow` | offset shadow via `text-shadow` |
| `alignment` | ASS numpad alignment maps to top/middle/bottom and left/center/right |
| `marginL/R/V` | scaled margins used in absolute positioning |
| `scaleX/Y` | `transform: scale(...)`, anchored by mapped alignment |
| `spacing` | `letterSpacing` scaled by preview width / `PlayResX` |
| `borderStyle=3` | approximate opaque box using `backgroundColor: backColor`, border radius, and padding |

Unsupported fields are ignored for preview, not stripped from ASS.

## Layout Rules

The overlay receives:

```ts
interface AssSubtitleOverlayProps {
  cue: SubtitleCue;
  styles: AssStyle[];
  scriptInfo: AssScriptInfo | null;
  mergeMode: "inline" | "separate";
  className?: string;
}
```

The component measures its own container with `ResizeObserver` and treats that size as the preview viewport. If no `scriptInfo` is available, it falls back to `1920x1080`.

For each rendered line:

- Inline mode renders one text item: `译文 / 原文`, using `cue.style` or `Primary`.
- Separate mode renders:
  - primary text with `cue.style` or `Primary`
  - secondary text with `Secondary`
- If a style name is missing, fall back to default styles from `createDefaultStyles()`.
- If both primary and secondary use bottom alignment, each style's own `marginV` decides vertical separation; default `Primary` and `Secondary` already differ.

ASS alignment maps like this:

| ASS alignment | CSS anchor |
| --- | --- |
| 1 | bottom-left |
| 2 | bottom-center |
| 3 | bottom-right |
| 4 | middle-left |
| 5 | middle-center |
| 6 | middle-right |
| 7 | top-left |
| 8 | top-center |
| 9 | top-right |

Positioning uses absolute elements in a full-size overlay:

- bottom alignments set `bottom: scaled(marginV)`.
- top alignments set `top: scaled(marginV)`.
- middle alignments set `top: 50%` with vertical translate.
- left alignments set `left: scaled(marginL)`.
- right alignments set `right: scaled(marginR)`.
- center alignments set `left: 50%` with horizontal translate.

## Rendering Details

### Scaling

Use separate x/y scale factors:

```ts
scaleX = viewportWidth / playResX
scaleY = viewportHeight / playResY
fontScale = scaleY
```

Use `scaleY` for `fontSize`, `outline`, `shadow`, and `marginV`; use `scaleX` for `marginL`, `marginR`, and `spacing`.

### Text Shadow Approximation

For `borderStyle=1`, generate text shadows:

- Outline: multiple offsets around the glyph, e.g. 8 directions at `outlinePx`.
- Shadow: one offset at `shadowPx shadowPx` using `backColor` or a semi-transparent black fallback.

This is not libass exact, but it makes default white/yellow text readable on video and visually close enough for editing.

### Opaque Box

For `borderStyle=3`, use:

- `backgroundColor: assColorToCss(style.backColor)`
- `padding` scaled from outline/shadow
- small `borderRadius`
- no heavy text outline unless the style also defines meaningful outline.

## Error Handling and Fallbacks

- Missing `assScriptInfo`: fallback to `1920x1080`.
- Empty `assStyles`: fallback to `createDefaultStyles()`.
- Unknown style name: fallback to `Primary`, then first style, then generated default style.
- Invalid ASS color strings already fall back in `parseAssColor`.
- Zero or missing viewport size: render with no overlay until measured, or fall back to `PlayResX/Y` as viewport for stable initial CSS.

## BurnView Integration

BurnView should later use the same overlay component on top of a video preview frame or current video player surface. The first BurnView preview does not need frame-accurate scrubbing; it can reuse project playback state or show the currently selected/active cue.

BurnView must include a concise note:

> 预览为 CSS 近似效果；最终硬字幕由 FFmpeg/libass 渲染，细节可能略有差异。

This keeps user expectations aligned while still making style choices visible before export.

## Testing Strategy

Prioritize pure function tests for `src/utils/assStyleCss.ts`:

- `findAssStyle` returns exact match and falls back predictably.
- `scaleAssStyleLength` uses x/y scale correctly.
- `assAlignmentToPlacement` maps 1-9 correctly.
- `assStyleToCss` maps font, color, weight, decoration, letter spacing, and transform.
- `buildTextShadow` includes outline and shadow components when configured.
- `resolveRenderItems` returns one item for inline and two items for separate.

UI verification:

- `pnpm build` must pass.
- Manual check with default styles:
  - inline mode shows one styled line.
  - separate mode shows two lines with `Secondary` above `Primary`.
  - changing PlayRes and preview size keeps relative placement stable.

## Open Constraints

- This design intentionally does not require adding new runtime dependencies.
- It should not delay the FFmpeg burn command implementation; it prepares a reusable preview component that BurnView can consume.
- CSS preview is a product compromise, not a source of truth. ASS files remain the source of truth for final rendering.
