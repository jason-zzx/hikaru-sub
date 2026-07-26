import { describe, expect, it } from "vitest";
import {
  aggregatePixelPeak,
  applyGain,
  buildWaveformTransform,
  stepWaveformGain,
  WAVEFORM_GAIN_MAX,
  WAVEFORM_GAIN_MIN,
} from "./waveformDisplay";

/** 测试内 sort-based nearest-rank 百分位 oracle（与直方图实现同口径） */
function sortBasedPercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, p));
  return sorted[Math.max(0, Math.ceil(clamped * sorted.length) - 1)];
}

describe("buildWaveformTransform", () => {
  it("acts as clamped identity for empty peaks", () => {
    const map = buildWaveformTransform([]);
    expect(map(0.5)).toBe(0.5);
    expect(map(-1)).toBe(0);
    expect(map(2)).toBe(1);
  });

  it("keeps all-zero peaks at zero", () => {
    const map = buildWaveformTransform([0, 0, 0, 0]);
    expect(map(0)).toBe(0);
  });

  it("keeps sparse short peaks visible instead of collapsing them", () => {
    // 大面积静音 + 单尖峰：非零 p20(=1.0) > 全桶 p99.5(=0)，噪声底估计不成立，
    // 守卫回退 floor=0、ceil=max，峰值不得被映射为 0
    const map = buildWaveformTransform([...new Array(1000).fill(0), 1]);
    expect(map(1)).toBeGreaterThanOrEqual(0.99);
    expect(map(0)).toBe(0);
  });

  it("does not collapse a strictly constant signal", () => {
    // ceil == floor 同样触发守卫：恒定 0.5 素材保持可见而非整条映射为 0
    const map = buildWaveformTransform(new Array(100).fill(0.5));
    expect(map(0.5)).toBe(1);
    expect(map(0)).toBe(0);
  });

  it("expands speech contrast above a constant BGM floor", () => {
    const peaks = [...new Array(80).fill(0.3), ...new Array(20).fill(0.8)];
    const map = buildWaveformTransform(peaks);
    // BGM 底压到 0，语音峰占满高度，中间值获得可视对比
    expect(map(0.3)).toBeCloseTo(0, 5);
    expect(map(0.8)).toBeGreaterThanOrEqual(0.99);
    expect(map(0.55)).toBeCloseTo(0.5, 5);
  });

  it("stays near identity for normal material with a near-zero floor", () => {
    const peaks = [0, ...new Array(30).fill(0.01), 0.2, 0.4, 0.5, 0.6, 0.8, 1, 1, 1];
    const map = buildWaveformTransform(peaks);
    expect(Math.abs(map(0.5) - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(map(0.2) - 0.2)).toBeLessThan(0.02);
    expect(map(1)).toBe(1);
  });

  it("ignores a single spike when estimating the ceiling", () => {
    // 主体 ≤0.5、单个 1.0 尖峰：ceil 取 p99.5 由主体决定，主体顶部仍能占满高度
    const body = Array.from({ length: 999 }, (_, i) => ((i + 1) / 999) * 0.5);
    const map = buildWaveformTransform([...body, 1]);
    expect(map(0.5)).toBe(1);
  });

  it("matches the sort-based percentile path on quantized data", () => {
    // 直方图主路径与排序 nearest-rank oracle 在量化到 0.001 的随机数据上
    // 结果一致（容差 0.001）。简单 LCG 保证确定性。
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const peaks = Array.from(
      { length: 5000 },
      () => Math.round(rand() ** 2 * 1000) / 1000,
    );

    const nonZero = peaks.filter((v) => v > 0);
    const floor = nonZero.length > 0 ? sortBasedPercentile(nonZero, 0.2) : 0;
    const ceil = sortBasedPercentile(peaks, 0.995);
    const range = Math.max(ceil - floor, 1e-6);
    const map = buildWaveformTransform(peaks);

    for (const v of [0, 0.05, 0.2, 0.35, 0.5, 0.75, 0.9, 1]) {
      const expected = Math.min(1, Math.max(0, (v - floor) / range));
      expect(Math.abs(map(v) - expected)).toBeLessThanOrEqual(0.001);
    }
  });
});

describe("aggregatePixelPeak", () => {
  // 4 桶对应 400ms → samplesPerMs = 0.01
  const peaks = [0.1, 0.9, 0.2, 0.3];

  it("takes the max across all buckets in the pixel range", () => {
    expect(aggregatePixelPeak(peaks, 0, 300, 0.01)).toBe(0.9);
    expect(aggregatePixelPeak(peaks, 200, 400, 0.01)).toBe(0.3);
  });

  it("keeps short peaks when zoomed out (no bucket skipping)", () => {
    const wide = new Array(100).fill(0.05);
    wide[15] = 0.95;
    // 一列覆盖 [100ms, 200ms) → 桶 10..19，短促尖峰不因跳桶丢失
    expect(aggregatePixelPeak(wide, 100, 200, 0.1)).toBe(0.95);
  });

  it("includes at least one bucket for sub-bucket ranges", () => {
    expect(aggregatePixelPeak(peaks, 100, 100, 0.01)).toBe(0.9);
    expect(aggregatePixelPeak(peaks, 110, 120, 0.01)).toBe(0.9);
  });

  it("clips partially out-of-range columns to available buckets", () => {
    expect(aggregatePixelPeak(peaks, -100, 100, 0.01)).toBe(0.1);
  });

  it("returns 0 outside the waveform", () => {
    expect(aggregatePixelPeak(peaks, 400, 500, 0.01)).toBe(0);
    expect(aggregatePixelPeak(peaks, -200, -100, 0.01)).toBe(0);
    expect(aggregatePixelPeak([], 0, 100, 0.01)).toBe(0);
    expect(aggregatePixelPeak(peaks, 0, 100, 0)).toBe(0);
  });
});

describe("applyGain", () => {
  it("scales and clips at 1", () => {
    expect(applyGain(0.4, 1)).toBe(0.4);
    expect(applyGain(0.4, 2)).toBe(0.8);
    expect(applyGain(0.4, 8)).toBe(1);
    expect(applyGain(0, 8)).toBe(0);
  });
});

describe("stepWaveformGain", () => {
  it("steps by ×1.25 and clamps to [0.25, 8]", () => {
    expect(stepWaveformGain(1, 1)).toBeCloseTo(1.25, 10);
    expect(stepWaveformGain(1, -1)).toBeCloseTo(0.8, 10);
    expect(stepWaveformGain(WAVEFORM_GAIN_MAX, 1)).toBe(WAVEFORM_GAIN_MAX);
    expect(stepWaveformGain(7.9, 1)).toBe(WAVEFORM_GAIN_MAX);
    expect(stepWaveformGain(WAVEFORM_GAIN_MIN, -1)).toBe(WAVEFORM_GAIN_MIN);
    expect(stepWaveformGain(0.26, -1)).toBe(WAVEFORM_GAIN_MIN);
  });
});
