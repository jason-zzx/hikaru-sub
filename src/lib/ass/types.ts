/**
 * 逻辑字幕条：编辑器与工作流使用的内存模型。
 * 一条 cue 在双语 ASS 中展开为两行 Dialogue（原文 + 译文，同 start/end）。
 */
export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  /** 原文（转录结果） */
  primaryText: string;
  /** 译文（可选） */
  secondaryText?: string;
  /** 原文所用 ASS Style 名 */
  style: string;
  layer: number;
}

/**
 * ASS V4+ Style，字段顺序与 [V4+ Styles] 的 Format 行一致。
 * 颜色统一以 ASS 颜色串保存（如 `&H00FFFFFF`），UI 可用 color.ts 转换。
 */
export interface AssStyle {
  name: string;
  fontName: string;
  fontSize: number;
  primaryColor: string;
  secondaryColor: string;
  outlineColor: string;
  backColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  scaleX: number;
  scaleY: number;
  spacing: number;
  angle: number;
  /** 1 = Outline+Shadow, 3 = Opaque box */
  borderStyle: number;
  outline: number;
  shadow: number;
  /** numpad 对齐：1-9 */
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  encoding: number;
}

/** 低层 ASS 事件行（Dialogue / Comment），双向映射 SubtitleCue。 */
export interface AssEvent {
  kind: "Dialogue" | "Comment";
  layer: number;
  startMs: number;
  endMs: number;
  style: string;
  name: string;
  marginL: number;
  marginR: number;
  marginV: number;
  effect: string;
  /** 原始文本，换行以 `\N` 表示 */
  text: string;
}

/** [Script Info] 段，保留未知键以便无损往返。 */
export interface AssScriptInfo {
  title: string;
  scriptType: string;
  playResX: number;
  playResY: number;
  wrapStyle: number;
  scaledBorderAndShadow: boolean;
  /** 其他未显式建模的键值对，按出现顺序保留 */
  extra: Record<string, string>;
}

/** ASS 文档：以逻辑 cue 为核心，序列化时展开为双语 Dialogue。 */
export interface AssDocument {
  scriptInfo: AssScriptInfo;
  styles: AssStyle[];
  cues: SubtitleCue[];
}

/** 双语展开/合并选项。 */
export interface BilingualOptions {
  /** 原文 Style 名（cue.style 缺省时使用） */
  primaryStyle: string;
  /** 译文 Style 名 */
  secondaryStyle: string;
}

/** 解析选项。 */
export interface ParseOptions extends Partial<BilingualOptions> {
  /** 是否把成对的 primary/secondary Dialogue 合并为单条 cue（默认 true） */
  mergeBilingual?: boolean;
}

/** 序列化选项。 */
export interface SerializeOptions extends Partial<BilingualOptions> {
  /** 字幕合并模式：inline = 单行拼接（译文 / 原文），separate = 分离双行 */
  mergeMode?: "inline" | "separate";
}
