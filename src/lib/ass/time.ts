/**
 * ASS 时间格式工具。
 * ASS 时间为 `H:MM:SS.cc`（厘秒，2 位小数），最小精度 10ms。
 */

/** 解析 ASS 时间串为毫秒。无法解析时返回 0。 */
export function parseAssTime(input: string): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(input.trim());
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  // 补齐到 3 位作为毫秒（ASS 通常为厘秒 2 位）
  const frac = m[4].padEnd(3, "0").slice(0, 3);
  const ms = Number(frac);
  return ((h * 60 + min) * 60 + sec) * 1000 + ms;
}

/** 毫秒格式化为 ASS 时间串 `H:MM:SS.cc`（四舍五入到厘秒）。 */
export function formatAssTime(totalMs: number): string {
  const clamped = Math.max(0, Math.round(totalMs));
  // 四舍五入到 10ms（厘秒）
  const cs = Math.round(clamped / 10);
  const h = Math.floor(cs / 360000);
  const min = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const centi = cs % 100;
  const mm = String(min).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  const cc = String(centi).padStart(2, "0");
  return `${h}:${mm}:${ss}.${cc}`;
}
