import { createDefaultStyles, type AssStyle } from "@/lib/ass";
import { loadStyleLibraryText, saveStyleLibraryText } from "./tauri";

export const STYLE_LIBRARY_VERSION = 1 as const;

const ASS_STYLE_TEMPLATE = createDefaultStyles()[0];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function parseAssStyle(raw: unknown, index: number): AssStyle {
  if (!isObject(raw)) {
    throw new Error(`样式库第 ${index + 1} 条不是对象`);
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(ASS_STYLE_TEMPLATE) as (keyof AssStyle)[]) {
    if (!(key in raw)) {
      throw new Error(`样式库第 ${index + 1} 条缺少字段 ${String(key)}`);
    }
    const expected = ASS_STYLE_TEMPLATE[key];
    const value = raw[key as string];
    if (typeof expected === "string") {
      if (typeof value !== "string") {
        throw new Error(
          `样式库第 ${index + 1} 条字段 ${String(key)} 类型错误（期望 string，实际 ${fieldType(value)}）`,
        );
      }
      result[key] = value;
      continue;
    }
    if (typeof expected === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(
          `样式库第 ${index + 1} 条字段 ${String(key)} 类型错误（期望 boolean，实际 ${fieldType(value)}）`,
        );
      }
      result[key] = value;
      continue;
    }
    if (typeof expected === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          `样式库第 ${index + 1} 条字段 ${String(key)} 必须是有限数字`,
        );
      }
      result[key] = value;
      continue;
    }
    throw new Error(`样式库第 ${index + 1} 条字段 ${String(key)} 不受支持`);
  }
  // Template walk filled every AssStyle field; cast after validation.
  const typed = result as unknown as AssStyle;
  const name = typed.name.trim();
  if (!name) {
    throw new Error(`样式库第 ${index + 1} 条样式名为空`);
  }
  typed.name = name;
  return typed;
}

/** Parse and validate a version-1 style-library JSON document. */
export function parseStyleLibrary(content: string): AssStyle[] {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    throw new Error("样式库文件不是有效的 JSON");
  }
  if (!isObject(root)) {
    throw new Error("样式库文件根节点必须是对象");
  }
  if (root.version !== STYLE_LIBRARY_VERSION) {
    throw new Error(
      `不支持的样式库版本：${String(root.version)}（当前支持 ${STYLE_LIBRARY_VERSION}）`,
    );
  }
  if (!Array.isArray(root.styles)) {
    throw new Error("样式库 styles 必须是数组");
  }

  const styles = root.styles.map((item, index) => parseAssStyle(item, index));
  const seen = new Set<string>();
  for (const style of styles) {
    if (seen.has(style.name)) {
      throw new Error(`样式库存在重复样式名：${style.name}`);
    }
    seen.add(style.name);
  }
  return styles;
}

/** Serialize styles into the version-1 envelope. */
export function serializeStyleLibrary(styles: AssStyle[]): string {
  return JSON.stringify({ version: STYLE_LIBRARY_VERSION, styles }, null, 2);
}

// Coalesce concurrent first-open loads (React Strict Mode remount).
let loadInflight: Promise<AssStyle[]> | null = null;

/**
 * Load the application style library.
 * Missing file → seed Primary/Secondary and persist before returning.
 * Existing empty array stays empty. Invalid/unreadable files throw.
 */
export async function loadStyleLibrary(): Promise<AssStyle[]> {
  if (loadInflight) return loadInflight;
  loadInflight = (async () => {
    const raw = await loadStyleLibraryText();
    if (raw === null) {
      const defaults = createDefaultStyles();
      await saveStyleLibraryText(serializeStyleLibrary(defaults));
      return defaults;
    }
    return parseStyleLibrary(raw);
  })().finally(() => {
    loadInflight = null;
  });
  return loadInflight;
}

/** Persist the full library. Caller owns validation of the style list. */
export async function saveStyleLibrary(styles: AssStyle[]): Promise<void> {
  // Re-validate via parse of our own serialization to catch empty/dup names.
  const content = serializeStyleLibrary(styles);
  parseStyleLibrary(content);
  await saveStyleLibraryText(content);
}
