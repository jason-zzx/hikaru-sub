import type { AssDocument, AssScriptInfo, AssStyle, BilingualOptions } from "./types";

/** 默认双语 Style 名。 */
export const PRIMARY_STYLE = "Primary";
export const SECONDARY_STYLE = "Secondary";

export const DEFAULT_BILINGUAL_OPTIONS: BilingualOptions = {
  primaryStyle: PRIMARY_STYLE,
  secondaryStyle: SECONDARY_STYLE,
};

export const DEFAULT_PLAY_RES_X = 1920;
export const DEFAULT_PLAY_RES_Y = 1080;

/** 自增 + 随机的 cue id，足够前端 key/去重使用。 */
let idCounter = 0;
export function createId(prefix = "cue"): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${rand}`;
}

function baseStyle(overrides: Partial<AssStyle> & Pick<AssStyle, "name">): AssStyle {
  return {
    fontName: "Noto Sans SC",
    fontSize: 54,
    primaryColor: "&H00FFFFFF",
    secondaryColor: "&H000000FF",
    outlineColor: "&H00000000",
    backColor: "&H80000000",
    bold: false,
    italic: false,
    underline: false,
    strikeOut: false,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    angle: 0,
    borderStyle: 1,
    outline: 2,
    shadow: 1,
    alignment: 2,
    marginL: 20,
    marginR: 20,
    marginV: 40,
    encoding: 1,
    ...overrides,
  };
}

/**
 * 默认双语样式：
 * - Primary（原文）：底部主行，字号较大
 * - Secondary（译文）：原文上方一行，字号略小
 */
export function createDefaultStyles(): AssStyle[] {
  return [
    baseStyle({ name: PRIMARY_STYLE, fontSize: 54, marginV: 40 }),
    baseStyle({
      name: SECONDARY_STYLE,
      fontSize: 44,
      marginV: 95,
      primaryColor: "&H0000F5F5",
    }),
  ];
}

export function createDefaultScriptInfo(title = "Hikaru-Sub"): AssScriptInfo {
  return {
    title,
    scriptType: "v4.00+",
    playResX: DEFAULT_PLAY_RES_X,
    playResY: DEFAULT_PLAY_RES_Y,
    wrapStyle: 0,
    scaledBorderAndShadow: true,
    extra: {},
  };
}

/** 创建空白双语 ASS 文档（含默认样式）。 */
export function createDefaultDocument(title = "Hikaru-Sub"): AssDocument {
  return {
    scriptInfo: createDefaultScriptInfo(title),
    styles: createDefaultStyles(),
    cues: [],
  };
}
