/**
 * 格式化毫秒为播放器时间字符串。
 * - withMs=true：附加 3 位毫秒（M:SS.mmm / H:MM:SS.mmm），用于精细对齐的当前时间。
 * - withMs=false：秒级（M:SS / H:MM:SS），用于总时长等静态引用。
 * 分钟在无小时时不补零（与既有 5:30 风格一致），小时段补零到 2 位。
 */
export function formatPlaybackTime(ms: number, withMs: boolean): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = totalMs % 1000;

  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");
  const msPart = withMs ? `.${millis.toString().padStart(3, "0")}` : "";

  if (hours > 0) {
    return `${hours}:${mm}:${ss}${msPart}`;
  }
  return `${minutes}:${ss}${msPart}`;
}
