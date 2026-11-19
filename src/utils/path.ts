function lastSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

/** 提取路径末尾文件名（无分隔符时返回原字符串）。 */
export function getFileName(path: string): string {
  const idx = lastSeparatorIndex(path);
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** 提取父目录；无分隔符返回空串，`preserveRoot=true` 时保留单斜杠根目录。 */
export function getParentDir(
  path: string,
  options?: { preserveRoot?: boolean },
): string {
  const idx = lastSeparatorIndex(path);
  if (idx < 0) return "";
  if (idx === 0 && options?.preserveRoot) return path[0];
  return path.slice(0, idx);
}

/** 提取不含扩展名的文件主干名，空主干时回退 `fallback`。 */
export function getFileStem(path: string, fallback = "output"): string {
  return getFileName(path).replace(/\.[^.]+$/, "") || fallback;
}
