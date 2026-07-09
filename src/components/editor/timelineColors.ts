export type TimelineColors = {
  bg: string;
  waveBg: string;
  tick: string;
  wave: string;
  cue: string;
  cueSelected: string;
  cueText: string;
  cueHandle: string;
  playhead: string;
};

export const TIMELINE_COLOR_VARS = {
  bg: "--timeline-bg",
  waveBg: "--timeline-wave-bg",
  tick: "--timeline-tick",
  wave: "--timeline-wave",
  cue: "--timeline-cue",
  cueSelected: "--timeline-cue-selected",
  cueText: "--timeline-cue-text",
  cueHandle: "--timeline-cue-handle",
  playhead: "--timeline-playhead",
} as const;

/** 深色现状硬编码，作 CSS 未定义时的回退 */
export const TIMELINE_COLOR_FALLBACKS: TimelineColors = {
  bg: "#111827",
  waveBg: "#1a1a1a",
  tick: "#888",
  wave: "#3b82f6",
  cue: "#4b5563",
  cueSelected: "#3b82f6",
  cueText: "#fff",
  cueHandle: "rgba(255,255,255,0.75)",
  playhead: "#ef4444",
};

function readVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

export function resolveTimelineColors(el: Element): TimelineColors {
  const style = getComputedStyle(el);
  return {
    bg: readVar(style, TIMELINE_COLOR_VARS.bg, TIMELINE_COLOR_FALLBACKS.bg),
    waveBg: readVar(
      style,
      TIMELINE_COLOR_VARS.waveBg,
      TIMELINE_COLOR_FALLBACKS.waveBg,
    ),
    tick: readVar(style, TIMELINE_COLOR_VARS.tick, TIMELINE_COLOR_FALLBACKS.tick),
    wave: readVar(style, TIMELINE_COLOR_VARS.wave, TIMELINE_COLOR_FALLBACKS.wave),
    cue: readVar(style, TIMELINE_COLOR_VARS.cue, TIMELINE_COLOR_FALLBACKS.cue),
    cueSelected: readVar(
      style,
      TIMELINE_COLOR_VARS.cueSelected,
      TIMELINE_COLOR_FALLBACKS.cueSelected,
    ),
    cueText: readVar(
      style,
      TIMELINE_COLOR_VARS.cueText,
      TIMELINE_COLOR_FALLBACKS.cueText,
    ),
    cueHandle: readVar(
      style,
      TIMELINE_COLOR_VARS.cueHandle,
      TIMELINE_COLOR_FALLBACKS.cueHandle,
    ),
    playhead: readVar(
      style,
      TIMELINE_COLOR_VARS.playhead,
      TIMELINE_COLOR_FALLBACKS.playhead,
    ),
  };
}
