function formatClockSeconds(totalSeconds: number, msSuffix = ""): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = minutes.toString().padStart(2, "0");
  const ss = seconds.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${mm}:${ss}${msSuffix}`;
  }
  return `${minutes}:${ss}${msSuffix}`;
}

/**
 * 格式化毫秒为播放器时间字符串。
 * - withMs=true：附加 3 位毫秒（M:SS.mmm / H:MM:SS.mmm），用于精细对齐的当前时间。
 * - withMs=false：秒级（M:SS / H:MM:SS），用于总时长等静态引用。
 * 小时与无小时下的分钟均不补零（与既有 5:30、1:30:00 风格一致）。
 */
export function formatPlaybackTime(ms: number, withMs: boolean): string {
  const totalMs = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const totalSeconds = Math.floor(totalMs / 1000);
  const millis = totalMs % 1000;
  const msPart = withMs ? `.${millis.toString().padStart(3, "0")}` : "";
  return formatClockSeconds(totalSeconds, msPart);
}

/**
 * 格式化毫秒为四舍五入到秒的时钟时长字符串（M:SS / H:MM:SS），
 * 用于下载、转录、压制等任务进度展示；非有限或非正数返回 "0:00"。
 */
export function formatDurationSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  return formatClockSeconds(Math.round(ms / 1000));
}
