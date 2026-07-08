const FONT_STYLE_SUFFIX =
  /[-_\s](regular|bold|italic|bolditalic|bold-italic|medium|semibold|semi-bold|light|thin|black|heavy|demibold|demi-bold|book|oblique)$/i;
const FONT_FILE_EXTENSION = /\.(ttf|otf|ttc|otc)$/i;

const CJK_TEXT_RE =
  /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/u;

interface FontFamilyAlias {
  family: string;
  cjk: boolean;
  aliases: string[];
}

const KNOWN_FONT_FAMILIES: FontFamilyAlias[] = [
  {
    family: "Noto Sans SC",
    cjk: true,
    aliases: ["notosanssc", "notosanscjksc"],
  },
  {
    family: "Microsoft YaHei",
    cjk: true,
    aliases: ["microsoftyahei", "microsoftyaheiui", "msyh", "msyhbd"],
  },
  {
    family: "Source Han Sans SC",
    cjk: true,
    aliases: ["sourcehansanssc", "sourcehansc", "sourcehansanscn"],
  },
  {
    family: "PingFang SC",
    cjk: true,
    aliases: ["pingfang", "pingfangsc"],
  },
  { family: "SimHei", cjk: true, aliases: ["simhei"] },
  { family: "SimSun", cjk: true, aliases: ["simsun", "nsimsun"] },
  { family: "DengXian", cjk: true, aliases: ["deng", "dengb", "dengl", "dengxian"] },
  { family: "FangSong", cjk: true, aliases: ["fangsong", "simfang", "stfangsong"] },
  { family: "KaiTi", cjk: true, aliases: ["kaiti", "simkai", "stkaiti"] },
  {
    family: "Microsoft JhengHei",
    cjk: true,
    aliases: ["microsoftjhenghei", "microsoftjhengheiui", "msjh", "msjhl", "msjhbd"],
  },
  { family: "MingLiU", cjk: true, aliases: ["mingliu"] },
  { family: "PMingLiU", cjk: true, aliases: ["pmingliu"] },
  { family: "DFKai-SB", cjk: true, aliases: ["dfkai", "dfkaisb"] },
  {
    family: "Noto Sans CJK JP",
    cjk: true,
    aliases: ["notosansjp", "notosanscjkjp"],
  },
  {
    family: "Source Han Sans JP",
    cjk: true,
    aliases: ["sourcehansansjp", "sourcehanjp"],
  },
  { family: "Meiryo", cjk: true, aliases: ["meiryo"] },
  { family: "Yu Gothic", cjk: true, aliases: ["yugothic", "yugoth"] },
  { family: "Yu Mincho", cjk: true, aliases: ["yumincho", "yumin"] },
  { family: "MS Gothic", cjk: true, aliases: ["msgothic"] },
  { family: "MS Mincho", cjk: true, aliases: ["msmincho"] },
  { family: "Hiragino Sans", cjk: true, aliases: ["hiragino", "hiraginosans"] },
  {
    family: "Noto Sans CJK KR",
    cjk: true,
    aliases: ["notosanskr", "notosanscjkkr"],
  },
  {
    family: "Source Han Sans KR",
    cjk: true,
    aliases: ["sourcehansanskr", "sourcehankr"],
  },
  { family: "Malgun Gothic", cjk: true, aliases: ["malgun", "malgungothic"] },
];

export function normalizeFontLookupName(value: string): string {
  return value
    .replace(FONT_FILE_EXTENSION, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function stripFontFileStyle(value: string): string {
  const stem = value.replace(FONT_FILE_EXTENSION, "");
  return stem.replace(FONT_STYLE_SUFFIX, "").trim() || stem;
}

export function canonicalFontFamilyName(value: string): string | null {
  const compact = normalizeFontLookupName(stripFontFileStyle(value));
  if (!compact) return null;

  for (const entry of KNOWN_FONT_FAMILIES) {
    const familyKey = normalizeFontLookupName(entry.family);
    if (compact === familyKey || entry.aliases.includes(compact)) {
      return entry.family;
    }
  }

  return null;
}

export function previewFontNameFromFileName(fileName: string): string {
  return canonicalFontFamilyName(fileName) ?? stripFontFileStyle(fileName);
}

export function isKnownCjkFontName(fontName: string): boolean {
  const compact = normalizeFontLookupName(stripFontFileStyle(fontName));
  if (!compact) return false;
  if (CJK_TEXT_RE.test(compact)) return true;

  return KNOWN_FONT_FAMILIES.some((entry) => {
    if (!entry.cjk) return false;
    const familyKey = normalizeFontLookupName(entry.family);
    return compact === familyKey || entry.aliases.includes(compact);
  });
}

export function cjkFallbackPriority(fontName: string): number {
  const family = canonicalFontFamilyName(fontName);
  if (!family) return Number.POSITIVE_INFINITY;
  const index = KNOWN_FONT_FAMILIES.findIndex((entry) => entry.family === family);
  return index >= 0 ? index : Number.POSITIVE_INFINITY;
}
