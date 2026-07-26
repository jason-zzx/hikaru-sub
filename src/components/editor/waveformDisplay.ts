/**
 * 波形显示层纯函数：自动对比度（噪声底扣除）与手动纵向增益。
 * 仅影响显示映射，不改变提取数据（extract_waveform 输出）。
 */

export const WAVEFORM_GAIN_MIN = 0.25;
export const WAVEFORM_GAIN_MAX = 8;
export const WAVEFORM_GAIN_FACTOR = 1.25;

/** floor/ceil 过近时的除零防护 */
const EPSILON = 1e-6;

/** Rust 侧峰值已量化到 3 位小数（0.001 步长），1001 桶直方图可覆盖全部取值 */
const HISTOGRAM_BINS = 1001;

/**
 * 直方图 nearest-rank 百分位：rank = max(0, ceil(p·total) - 1)，单次累计扫描取值。
 * fromBin=1 时跳过 0 桶即非零分布。与线性插值口径相比，
 * 对量化到 0.001 的输入输出最多偏一个量化步长（噪声底/顶估计无感）。
 */
function histogramPercentile(
  counts: Uint32Array,
  fromBin: number,
  total: number,
  p: number,
): number {
  if (total <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const rank = Math.max(0, Math.ceil(clamped * total) - 1);
  let cumulative = 0;
  for (let bin = fromBin; bin < counts.length; bin += 1) {
    cumulative += counts[bin];
    if (rank < cumulative) return bin / (HISTOGRAM_BINS - 1);
  }
  return 1;
}

/**
 * 构建显示映射：floor = 非零桶 p20（噪声底估计），ceil = 全桶 p99.5（防单尖峰拉低整体）。
 * 返回 v → clamp((v - floor) / max(ceil - floor, ε), 0, 1)。
 * 恒定 BGM 底噪被压到 ≈0、语音增量占满高度；普通素材 floor≈0、ceil≈1 时映射近似恒等。
 *
 * 主路径不排序：一次 O(n) 扫描建 1001 桶直方图同时得全桶/非零两个分布，
 * 72 万桶素材不再因复制排序两份数组卡顿主线程（~0.5s）。
 */
export function buildWaveformTransform(peaks: number[]): (v: number) => number {
  if (peaks.length === 0) {
    return (v) => Math.min(1, Math.max(0, v));
  }
  const counts = new Uint32Array(HISTOGRAM_BINS);
  let maxPeak = 0;
  for (const v of peaks) {
    const bin = Math.min(
      HISTOGRAM_BINS - 1,
      Math.max(0, Math.round(v * (HISTOGRAM_BINS - 1))),
    );
    counts[bin] += 1;
    if (v > maxPeak) maxPeak = v;
  }
  const nonZeroTotal = peaks.length - counts[0];
  let floor =
    nonZeroTotal > 0 ? histogramPercentile(counts, 1, nonZeroTotal, 0.2) : 0;
  let ceil = histogramPercentile(counts, 0, peaks.length, 0.995);
  // 大面积静音 + 少量尖峰（稀疏短音素材）时非零 p20 会高于全桶 p99.5，
  // 噪声底估计不成立：回退 floor=0、ceil=max，避免把真实峰值映射为 0。
  // 恒定值素材（ceil == floor）同样回退，保持波形可见；全 0 素材 ceil 仍为 0，
  // 退化为恒等 clamp。
  if (ceil <= floor) {
    floor = 0;
    ceil = maxPeak;
  }
  const range = Math.max(ceil - floor, EPSILON);
  return (v) => Math.min(1, Math.max(0, (v - floor) / range));
}

/**
 * 像素列聚合：取 [startMs, endMs) 覆盖的桶区间峰值 max（区间至少含一个桶），
 * 消除缩小视图时的跳桶混叠。与波形数据无交集（越界）时返回 0。
 */
export function aggregatePixelPeak(
  peaks: number[],
  startMs: number,
  endMs: number,
  samplesPerMs: number,
): number {
  if (peaks.length === 0 || samplesPerMs <= 0) return 0;
  const startIdx = Math.floor(startMs * samplesPerMs);
  const endIdx = Math.max(startIdx + 1, Math.ceil(endMs * samplesPerMs));
  const from = Math.max(0, startIdx);
  const to = Math.min(peaks.length, endIdx);
  if (from >= to) return 0;
  let max = 0;
  for (let i = from; i < to; i += 1) {
    if (peaks[i] > max) max = peaks[i];
  }
  return max;
}

/** 手动纵向增益：放大后削顶在 1。 */
export function applyGain(v: number, gain: number): number {
  return Math.min(1, v * gain);
}

/** Shift+滚轮增益步进：每格 ×1.25，收敛到 [0.25, 8]；direction > 0 增大。 */
export function stepWaveformGain(gain: number, direction: number): number {
  const next =
    direction > 0 ? gain * WAVEFORM_GAIN_FACTOR : gain / WAVEFORM_GAIN_FACTOR;
  return Math.min(WAVEFORM_GAIN_MAX, Math.max(WAVEFORM_GAIN_MIN, next));
}
