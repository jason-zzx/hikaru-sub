import type { SelectOption } from "@/components/ui/select-adapter";

/** UI 可选目标语言列表（翻译页与设置页共用）。 */
export const TARGET_LANG_OPTIONS: SelectOption[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

/** 翻译 Prompt 使用的语言代码到中文名称映射。 */
export const TRANSLATION_LANG_NAMES: Record<string, string> = {
  ...Object.fromEntries(TARGET_LANG_OPTIONS.map((opt) => [opt.value, opt.label])),
  zh: "中文",
  fr: "法语",
  de: "德语",
  es: "西班牙语",
  ru: "俄语",
};
