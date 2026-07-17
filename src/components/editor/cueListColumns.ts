import type { SubtitleCue } from "@/lib/ass";

export type OptionalDialogueColumn =
  | "layer"
  | "name"
  | "marginL"
  | "marginR"
  | "marginV"
  | "effect";

export type CueListColumn =
  | "index"
  | OptionalDialogueColumn
  | "start"
  | "end"
  | "style"
  | "text";

const OPTIONAL_ORDER: OptionalDialogueColumn[] = [
  "layer",
  "name",
  "marginL",
  "marginR",
  "marginV",
  "effect",
];

/**
 * Grid track sizes for each column.
 * Start/end hug ASS time `H:MM:SS.cc`; style hugs content (cap long names);
 * text takes the leftover space.
 */
const COLUMN_TRACK: Record<CueListColumn, string> = {
  index: "2.5rem",
  layer: "3rem",
  start: "max-content",
  end: "max-content",
  style: "fit-content(6rem)",
  name: "minmax(3.5rem, 6rem)",
  marginL: "3.25rem",
  marginR: "3.25rem",
  marginV: "3.25rem",
  effect: "minmax(3.5rem, 6rem)",
  text: "minmax(0, 1fr)",
};

export interface CueListColumnVisibility {
  columns: CueListColumn[];
  gridTemplate: string;
}

function isNonEmpty(value: string | undefined): boolean {
  return (value ?? "").trim() !== "";
}

/** Document-level optional Dialogue columns in ASS Format order. */
export function getCueListColumnVisibility(
  cues: SubtitleCue[],
): CueListColumnVisibility {
  const showLayer = cues.some((cue) => cue.layer !== 0);
  const showName = cues.some((cue) => isNonEmpty(cue.name));
  const showMarginL = cues.some((cue) => (cue.marginL ?? 0) !== 0);
  const showMarginR = cues.some((cue) => (cue.marginR ?? 0) !== 0);
  const showMarginV = cues.some((cue) => (cue.marginV ?? 0) !== 0);
  const showEffect = cues.some((cue) => isNonEmpty(cue.effect));

  const optionalVisible: Record<OptionalDialogueColumn, boolean> = {
    layer: showLayer,
    name: showName,
    marginL: showMarginL,
    marginR: showMarginR,
    marginV: showMarginV,
    effect: showEffect,
  };

  // Always: # | Start | End | Style | Text
  // Optional insert in Format order: Layer after #; Name after Style;
  // margins/Effect between Name and Text.
  const columns: CueListColumn[] = ["index"];
  if (optionalVisible.layer) columns.push("layer");
  columns.push("start", "end", "style");
  for (const key of OPTIONAL_ORDER) {
    if (key === "layer") continue;
    if (optionalVisible[key]) columns.push(key);
  }
  columns.push("text");

  return {
    columns,
    gridTemplate: columns.map((col) => COLUMN_TRACK[col]).join(" "),
  };
}

export const CUE_LIST_COLUMN_LABELS: Record<CueListColumn, string> = {
  index: "#",
  layer: "Layer",
  start: "开始",
  end: "结束",
  style: "样式",
  name: "Name",
  marginL: "MarginL",
  marginR: "MarginR",
  marginV: "MarginV",
  effect: "Effect",
  text: "文本",
};
