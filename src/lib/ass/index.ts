export type {
  SubtitleCue,
  AssStyle,
  AssEvent,
  AssScriptInfo,
  AssDocument,
  BilingualOptions,
  ParseOptions,
  SerializeOptions,
  SubtitleMergeMode,
  SubtitleTextOrder,
} from "./types";

export { parseAssTime, formatAssTime } from "./time";

export {
  type Rgba,
  clampByte,
  toHexByte,
  parseAssColor,
  rgbaToAssColor,
  assColorToCss,
} from "./color";

export {
  PRIMARY_STYLE,
  SECONDARY_STYLE,
  DEFAULT_BILINGUAL_OPTIONS,
  DEFAULT_PLAY_RES_X,
  DEFAULT_PLAY_RES_Y,
  createId,
  createDefaultStyles,
  createDefaultScriptInfo,
  createDefaultDocument,
  findAssStyleByName,
} from "./defaults";

export {
  INLINE_CUE_SEPARATOR,
  toAssText,
  fromAssText,
  formatInlineCueText,
  getCueDisplay,
  cueToEvents,
  cuesToEvents,
  eventsToCues,
} from "./bilingual";
export type { CueDisplay } from "./bilingual";

export { parseAss } from "./parse";
export { serializeAss } from "./serialize";
export {
  formatDialogueEventLine,
  parseDialogueEventLine,
} from "./eventLine";

export {
  type AsrSegment,
  type MergeOptions,
  segmentsToCues,
  mergeShortCues,
} from "./postprocess";

export {
  type AssInlineOverrides,
  type AssTextRun,
  type AssTextLine,
  type ParseAssTextOptions,
  parseAssTextLines,
} from "./assTags";
