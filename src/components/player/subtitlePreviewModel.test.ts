import { describe, expect, it } from "vitest";
import {
  formatAssTime,
  parseAssTime,
  type SubtitleCue,
} from "@/lib/ass";
import {
  findPreviewCue,
  getLibassFontKey,
  getLibassRenderTimeMs,
  resolvePausedPreviewCueId,
  resolveSegmentStopPreview,
  shouldUseCssFallback,
} from "./subtitlePreviewModel";

// 相邻两句共享边界（前句 endMs === 后句 startMs）：段播停点与点选边界的典型场景
const cues: SubtitleCue[] = [
  {
    id: "cue-1",
    startMs: 0,
    endMs: 1000,
    primaryText: "一",
    style: "Primary",
    layer: 0,
  },
  {
    id: "cue-2",
    startMs: 1000,
    endMs: 2000,
    primaryText: "二",
    style: "Primary",
    layer: 0,
  },
];

describe("subtitlePreviewModel", () => {
  it("prefers the selected cue over the timeline cue", () => {
    expect(findPreviewCue(cues, "cue-2", 500)?.id).toBe("cue-2");
  });

  it("falls back to the current timeline cue when no cue is selected", () => {
    expect(findPreviewCue(cues, null, 500)?.id).toBe("cue-1");
  });

  it("keeps the ending cue at a shared boundary when matching by time", () => {
    // 普通暂停沿用闭区间；find 返回文档顺序中第一个命中的 cue
    expect(findPreviewCue(cues, null, 999)?.id).toBe("cue-1");
    expect(findPreviewCue(cues, null, 1000)?.id).toBe("cue-1");
    expect(findPreviewCue(cues, null, 2000)?.id).toBe("cue-2");
    expect(findPreviewCue(cues, null, 2001)).toBeNull();
  });

  it("keeps the paused pin inside the cue and at its segment stop point", () => {
    expect(resolvePausedPreviewCueId(cues, "cue-1", 0, null)).toBe("cue-1");
    expect(resolvePausedPreviewCueId(cues, "cue-1", 999, null)).toBe("cue-1");
    // 段播精确停在 endMs（segmentStop 驻留且绑定选中句）：即使下一句恰从
    // 该时刻开始，停点仍钉帧显示被播放句
    expect(
      resolvePausedPreviewCueId(cues, "cue-1", 1000, {
        cueId: "cue-1",
        stopMs: 1000,
      }),
    ).toBe("cue-1");
    expect(
      resolvePausedPreviewCueId(cues, "cue-2", 1000, {
        cueId: "cue-1",
        stopMs: 1000,
      }),
    ).toBe("cue-1");
    // 末句停点（无下一句）同样驻留，且不受当前选择变化影响
    expect(
      resolvePausedPreviewCueId(cues, "cue-1", 2000, {
        cueId: "cue-2",
        stopMs: 2000,
      }),
    ).toBe("cue-2");
  });

  it("drops regular pins outside the selected cue but keeps segment snapshots", () => {
    // 普通暂停在 endMs 仍保留选中句，离开闭区间后释放钉帧
    expect(resolvePausedPreviewCueId(cues, "cue-1", 1000, null)).toBe("cue-1");
    expect(resolvePausedPreviewCueId(cues, "cue-1", 1001, null)).toBeNull();
    expect(resolvePausedPreviewCueId(cues, "cue-2", 500, null)).toBeNull();
    expect(resolvePausedPreviewCueId(cues, null, 500, null)).toBeNull();
    expect(resolvePausedPreviewCueId(cues, "missing", 500, null)).toBeNull();
    // 无效 cue id 的驻留标记不得抢占当前选择
    expect(
      resolvePausedPreviewCueId(cues, "cue-1", 2000, {
        cueId: "missing",
        stopMs: 2000,
      }),
    ).toBeNull();
    // cue 的 endMs 已被编辑时，旧停点仍绑定启动段播的 cue。
    expect(
      resolvePausedPreviewCueId(cues, "cue-1", 2000, {
        cueId: "cue-1",
        stopMs: 2000,
      }),
    ).toBe("cue-1");
  });

  it("builds one stop preview from the tracker hit set", () => {
    const source: SubtitleCue[] = [
      {
        ...cues[0]!,
        id: "played",
        startMs: 2200,
        endMs: 2300,
        primaryText: "played",
      },
      {
        ...cues[0]!,
        id: "overlap",
        startMs: 1500,
        endMs: 2500,
        primaryText: "overlap",
      },
      {
        ...cues[0]!,
        id: "next",
        startMs: 2000,
        endMs: 3000,
        primaryText: "next",
      },
      {
        ...cues[0]!,
        id: "expired",
        startMs: 500,
        endMs: 1200,
        primaryText: "expired",
      },
    ];

    const preview = resolveSegmentStopPreview(
      source,
      ["played", "overlap"],
      2000,
    );

    expect(preview?.cues.map((cue) => cue.id)).toEqual([
      "played",
      "overlap",
    ]);
    expect(preview?.renderTimeMs).toBe(1999);
    for (const cue of preview?.cues ?? []) {
      expect(parseAssTime(formatAssTime(cue.startMs))).toBeLessThanOrEqual(
        1999,
      );
      expect(parseAssTime(formatAssTime(cue.endMs))).toBeGreaterThan(1999);
    }
    // 预览钉帧只构造临时 cue，不改写已编辑的文档时间。
    expect(source[0]).toMatchObject({ startMs: 2200, endMs: 2300 });
    expect(resolveSegmentStopPreview(source, null, 2000)).toBeNull();
  });

  it("renders selected cues at their own time in libass preview", () => {
    expect(getLibassRenderTimeMs(cues, "cue-2", 500)).toBe(1001);
  });

  it("renders selected cues inside their serialized ASS time range", () => {
    expect(
      getLibassRenderTimeMs(
        [
          {
            id: "cue-rounded",
            startMs: 1009,
            endMs: 2000,
            primaryText: "丸め",
            style: "Primary",
            layer: 0,
          },
        ],
        "cue-rounded",
        500,
      ),
    ).toBe(1011);
  });

  it("renders timeline cues at the current time when nothing is selected", () => {
    expect(getLibassRenderTimeMs(cues, null, 500)).toBe(500);
  });

  it("uses CSS fallback when libass is disabled, unavailable, or has failed", () => {
    expect(shouldUseCssFallback("css", true, null)).toBe(true);
    expect(shouldUseCssFallback("auto", false, null)).toBe(true);
    expect(shouldUseCssFallback("auto", true, "worker failed")).toBe(true);
    expect(shouldUseCssFallback("auto", true, null)).toBe(false);
  });

  it("changes the libass retry key when available font names change", () => {
    const first = getLibassFontKey({
      defaultFont: ".苹方-简",
      fontUrls: ["font://pingfang"],
      availableFonts: {
        ".苹方-简": "font://pingfang",
      },
    });
    const second = getLibassFontKey({
      defaultFont: ".苹方-简",
      fontUrls: ["font://pingfang"],
      availableFonts: {
        ".苹方-简": "font://pingfang",
        "PingFangSC-Regular": "font://pingfang",
      },
    });

    expect(second).not.toBe(first);
  });
});
