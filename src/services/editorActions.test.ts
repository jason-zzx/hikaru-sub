import { describe, expect, it } from "vitest";
import {
  assignCueLanes,
  appendCueAfter,
  appendCueAfterWithUniqueId,
  copyCueRows,
  createCueAtPlayhead,
  createCueAtPlayheadWithUniqueId,
  createUniqueCueId,
  deleteCuesById,
  duplicateCues,
  findSubtitleBoundary,
  frameStepTarget,
  insertCueRelative,
  mergeSelectedCues,
  nextAfterCommit,
  normalizeBoundaryDrag,
  pasteCueRows,
  selectCueAfterDelete,
  selectCueByOffset,
  splitCueAtTime,
  swapSelectedCues,
} from "./editorActions";
import type { SubtitleCue } from "../types";

function cue(id: string, startMs: number, endMs: number): SubtitleCue {
  return { id, startMs, endMs, primaryText: id, style: "Primary", layer: 0 };
}

const CUES = [cue("a", 0, 1000), cue("b", 2000, 3000), cue("c", 5000, 6000)];

describe("selectCueByOffset", () => {
  it("选中下一条/上一条", () => {
    expect(selectCueByOffset(CUES, "a", 1)?.id).toBe("b");
    expect(selectCueByOffset(CUES, "b", -1)?.id).toBe("a");
  });

  it("越界收在首/末条", () => {
    expect(selectCueByOffset(CUES, "a", -1)?.id).toBe("a");
    expect(selectCueByOffset(CUES, "c", 1)?.id).toBe("c");
    expect(selectCueByOffset(CUES, "a", Infinity)?.id).toBe("c");
    expect(selectCueByOffset(CUES, "c", -Infinity)?.id).toBe("a");
  });

  it("未选中时从第一条开始；空列表返回 null", () => {
    expect(selectCueByOffset(CUES, null, 1)?.id).toBe("a");
    expect(selectCueByOffset([], null, 1)).toBeNull();
  });
});

describe("findSubtitleBoundary", () => {
  it("找到后方最近边界（跳过 1ms 容差内的当前位置）", () => {
    expect(findSubtitleBoundary(CUES, 500, 1)).toBe(1000);
    expect(findSubtitleBoundary(CUES, 1000, 1)).toBe(2000);
    expect(findSubtitleBoundary(CUES, 1000.4, 1)).toBe(2000);
  });

  it("找到前方最近边界", () => {
    expect(findSubtitleBoundary(CUES, 2500, -1)).toBe(2000);
    expect(findSubtitleBoundary(CUES, 2000, -1)).toBe(1000);
  });

  it("越过首/末边界或空列表返回 null", () => {
    expect(findSubtitleBoundary(CUES, 0, -1)).toBeNull();
    expect(findSubtitleBoundary(CUES, 6000, 1)).toBeNull();
    expect(findSubtitleBoundary([], 100, 1)).toBeNull();
  });
});

describe("frameStepTarget", () => {
  it("按 fps 帧中心步进", () => {
    // 25fps：一帧 40ms；当前 0ms（第 0 帧）→ 下一帧中心 = 1.5 × 40 = 60ms
    expect(frameStepTarget(0, 25, 1, 60000)).toBeCloseTo(60);
    // 回退一帧被 clamp 到 0
    expect(frameStepTarget(0, 25, -1, 60000)).toBe(0);
  });

  it("从帧中心前进/后退恰好一帧（不跳帧、不卡死）", () => {
    // 25fps 帧中心：20, 60, 100, ... 当前位于帧 1 中心（60ms）
    expect(frameStepTarget(60, 25, 1, 60000)).toBe(100); // → 帧 2 中心
    expect(frameStepTarget(60, 25, -1, 60000)).toBe(20); // → 帧 0 中心
  });

  it("fps 为 null 或非正时按 30fps 回退", () => {
    // 30fps：一帧 ≈33.33ms；0ms → 下一帧中心 = 1.5 × 33.33 ≈ 50ms
    expect(frameStepTarget(0, null, 1, 60000)).toBeCloseTo(50, 0);
    expect(frameStepTarget(0, 0, 1, 60000)).toBeCloseTo(50, 0);
  });

  it("clamp 到时长", () => {
    expect(frameStepTarget(59990, 25, 10, 60000)).toBe(60000);
  });
});

describe("appendCueAfter", () => {
  it("起点接当前行结束、时长 2s、文本空、继承样式与 layer", () => {
    const base: SubtitleCue = {
      id: "x",
      startMs: 1000,
      endMs: 3000,
      primaryText: "text",
      secondaryText: "译",
      style: "Secondary",
      layer: 2,
    };
    const appended = appendCueAfter(base);
    expect(appended.id).toBeTruthy();
    expect(appended.id).not.toBe("x");
    expect(appended.startMs).toBe(3000);
    expect(appended.endMs).toBe(5000);
    expect(appended.primaryText).toBe("");
    expect(appended.secondaryText).toBeUndefined();
    expect(appended.style).toBe("Secondary");
    expect(appended.layer).toBe(2);
  });
});

describe("createCueAtPlayhead", () => {
  it("沿用现有新建参数：2s、占位文本、Primary、layer 0", () => {
    const created = createCueAtPlayhead(1234);
    expect(created.startMs).toBe(1234);
    expect(created.endMs).toBe(3234);
    expect(created.primaryText).toBe("新建字幕");
    expect(created.style).toBe("Primary");
    expect(created.layer).toBe(0);
  });
});

describe("createUniqueCueId", () => {
  it("returns the first generated id when unique", () => {
    expect(createUniqueCueId(CUES, () => "new-id")).toBe("new-id");
  });

  it("retries collisions up to the first unique id", () => {
    const ids = ["a", "b", "new-id"];
    expect(createUniqueCueId(CUES, () => ids.shift()!)).toBe("new-id");
  });

  it("returns null after three collisions", () => {
    const ids = ["a", "b", "c"];
    expect(createUniqueCueId(CUES, () => ids.shift()!)).toBeNull();
  });
});

describe("unique cue creation wrappers", () => {
  it("createCueAtPlayheadWithUniqueId keeps existing new-cue defaults", () => {
    const created = createCueAtPlayheadWithUniqueId(1234, CUES, () => "new-id");
    expect(created).toEqual({
      id: "new-id",
      startMs: 1234,
      endMs: 3234,
      primaryText: "新建字幕",
      secondaryText: undefined,
      style: "Primary",
      layer: 0,
    });
  });

  it("appendCueAfterWithUniqueId keeps append defaults and inherits style/layer", () => {
    const base = { ...CUES[1], style: "Secondary", layer: 2 };
    const appended = appendCueAfterWithUniqueId(base, CUES, () => "new-id");
    expect(appended).toEqual({
      id: "new-id",
      startMs: 3000,
      endMs: 5000,
      primaryText: "",
      secondaryText: undefined,
      style: "Secondary",
      layer: 2,
    });
  });

  it("returns null when no unique id can be generated", () => {
    expect(createCueAtPlayheadWithUniqueId(1234, CUES, () => "a")).toBeNull();
    expect(appendCueAfterWithUniqueId(CUES[0], CUES, () => "b")).toBeNull();
  });
});

describe("selectCueAfterDelete", () => {
  it("selects the next cue at the deleted cue's original index", () => {
    expect(selectCueAfterDelete(CUES, "b")?.id).toBe("c");
  });

  it("selects the previous cue when deleting the last cue", () => {
    expect(selectCueAfterDelete(CUES, "c")?.id).toBe("b");
  });

  it("returns null when deleting the only cue or when id is missing", () => {
    expect(selectCueAfterDelete([CUES[0]], "a")).toBeNull();
    expect(selectCueAfterDelete(CUES, "missing")).toBeNull();
  });
});

describe("nextAfterCommit", () => {
  it("中间行提交后选中下一条", () => {
    const result = nextAfterCommit(CUES, "a");
    expect(result).toEqual({ kind: "select", cue: CUES[1] });
  });

  it("最后一条提交后追加", () => {
    const result = nextAfterCommit(CUES, "c");
    expect(result.kind).toBe("append");
    if (result.kind === "append") {
      expect(result.base.id).toBe("c");
    }
  });

  it("找不到 id 时返回 none", () => {
    expect(nextAfterCommit(CUES, "missing")).toEqual({ kind: "none" });
    expect(nextAfterCommit([], "a")).toEqual({ kind: "none" });
  });
});

describe("assignCueLanes", () => {
  it("puts overlapping cues into separate lanes and reuses lanes after the overlap ends", () => {
    const cues = [
      cue("a", 0, 1000),
      cue("b", 500, 1500),
      cue("c", 1500, 2000),
      cue("d", 1600, 1800),
    ];

    expect(assignCueLanes(cues).map((item) => [item.cue.id, item.lane])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
      ["d", 1],
    ]);
  });

  it("keeps list ordering for cues with equal starts", () => {
    const cues = [cue("a", 0, 1000), cue("b", 0, 500), cue("c", 500, 800)];

    expect(assignCueLanes(cues).map((item) => [item.cue.id, item.lane])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 1],
    ]);
  });
});

describe("normalizeBoundaryDrag", () => {
  it("updates the dragged start boundary without crossing", () => {
    expect(normalizeBoundaryDrag(cue("a", 1000, 3000), "start", 1500, 10000)).toEqual({
      startMs: 1500,
      endMs: 3000,
    });
  });

  it("swaps start and end when dragging start later than end", () => {
    expect(normalizeBoundaryDrag(cue("a", 1000, 3000), "start", 4200, 10000)).toEqual({
      startMs: 3000,
      endMs: 4200,
    });
  });

  it("swaps start and end when dragging end earlier than start", () => {
    expect(normalizeBoundaryDrag(cue("a", 1000, 3000), "end", 400, 10000)).toEqual({
      startMs: 400,
      endMs: 1000,
    });
  });

  it("clamps dragged times to the video duration and rounds to milliseconds", () => {
    expect(normalizeBoundaryDrag(cue("a", 1000, 3000), "end", 12000.7, 10000)).toEqual({
      startMs: 1000,
      endMs: 10000,
    });
  });
});

describe("subtitle row operations", () => {
  const richCue = (id: string, startMs: number, endMs: number): SubtitleCue => ({
    id,
    startMs,
    endMs,
    primaryText: `P-${id}`,
    secondaryText: `S-${id}`,
    style: "Primary",
    layer: 2,
  });

  it("inserts empty inherited cues before and after the target", () => {
    const cues = [richCue("a", 2000, 3000)];

    expect(insertCueRelative(cues, "a", "before", () => "before")).toEqual({
      cues: [
        {
          id: "before",
          startMs: 0,
          endMs: 2000,
          primaryText: "",
          secondaryText: undefined,
          style: "Primary",
          layer: 2,
        },
        cues[0],
      ],
      selectedCueIds: ["before"],
    });

    expect(insertCueRelative(cues, "a", "after", () => "after")).toEqual({
      cues: [
        cues[0],
        {
          id: "after",
          startMs: 3000,
          endMs: 5000,
          primaryText: "",
          secondaryText: undefined,
          style: "Primary",
          layer: 2,
        },
      ],
      selectedCueIds: ["after"],
    });
  });

  it("duplicates selected cues with new ids after their originals", () => {
    const cues = [richCue("a", 0, 1000), richCue("b", 1000, 2000)];
    const ids = ["a-copy", "b-copy"];

    const result = duplicateCues(cues, ["a", "b"], () => ids.shift()!);

    expect(result?.cues.map((item) => item.id)).toEqual([
      "a",
      "a-copy",
      "b",
      "b-copy",
    ]);
    expect(result?.cues[1]).toMatchObject({
      startMs: 0,
      endMs: 1000,
      primaryText: "P-a",
      secondaryText: "S-a",
    });
    expect(result?.selectedCueIds).toEqual(["a-copy", "b-copy"]);
  });

  it("splits a cue at the playhead and copies text, translation, style, and layer to the second half", () => {
    const cues = [richCue("a", 1000, 5000)];

    expect(splitCueAtTime(cues, "a", 2500, () => "split")).toEqual({
      cues: [
        { ...cues[0], endMs: 2500 },
        { ...cues[0], id: "split", startMs: 2500, endMs: 5000 },
      ],
      selectedCueIds: ["split"],
    });
  });

  it("does not split when the playhead is outside or on the cue boundary", () => {
    const cues = [richCue("a", 1000, 5000)];

    expect(splitCueAtTime(cues, "a", 1000, () => "split")).toBeNull();
    expect(splitCueAtTime(cues, "a", 5000, () => "split")).toBeNull();
    expect(splitCueAtTime(cues, "a", 900, () => "split")).toBeNull();
  });

  it("deletes selected cues and selects the next row at the first removed index", () => {
    const cues = [
      cue("a", 0, 1000),
      cue("b", 1000, 2000),
      cue("c", 2000, 3000),
    ];

    expect(deleteCuesById(cues, ["b"])).toEqual({
      cues: [cues[0], cues[2]],
      selectedCueIds: ["c"],
    });
  });

  it("swaps exactly two selected rows by list position", () => {
    const cues = [
      cue("a", 0, 1000),
      cue("b", 1000, 2000),
      cue("c", 2000, 3000),
    ];

    expect(swapSelectedCues(cues, ["a", "c"])).toEqual({
      cues: [cues[2], cues[1], cues[0]],
      selectedCueIds: ["c", "a"],
    });
    expect(swapSelectedCues(cues, ["a"])).toBeNull();
  });

  it("merges selected rows by directly concatenating primary and secondary text", () => {
    const cues = [
      richCue("a", 0, 1000),
      richCue("b", 500, 3000),
      richCue("c", 3000, 4000),
    ];

    expect(mergeSelectedCues(cues, ["a", "b"], "concat")).toEqual({
      cues: [
        {
          ...cues[0],
          startMs: 0,
          endMs: 3000,
          primaryText: "P-aP-b",
          secondaryText: "S-aS-b",
        },
        cues[2],
      ],
      selectedCueIds: ["a"],
    });
  });

  it("merges selected rows while keeping the first row text", () => {
    const cues = [
      richCue("a", 0, 1000),
      richCue("b", 500, 3000),
      richCue("c", 3000, 4000),
    ];

    expect(mergeSelectedCues(cues, ["a", "b"], "keep-first")).toEqual({
      cues: [{ ...cues[0], startMs: 0, endMs: 3000 }, cues[2]],
      selectedCueIds: ["a"],
    });
  });
});

describe("cue row clipboard helpers", () => {
  it("copies selected cue rows in list order", () => {
    expect(copyCueRows(CUES, ["b", "a"]).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("pastes clipboard rows after a target with fresh ids", () => {
    const ids = ["a2", "b2"];
    const clipboard = copyCueRows(CUES, ["a", "b"]);

    const result = pasteCueRows(CUES, clipboard, "b", () => ids.shift()!);

    expect(result?.cues.map((item) => item.id)).toEqual([
      "a",
      "b",
      "a2",
      "b2",
      "c",
    ]);
    expect(result?.cues[2]).toMatchObject({
      startMs: 0,
      endMs: 1000,
      primaryText: "a",
    });
    expect(result?.selectedCueIds).toEqual(["a2", "b2"]);
  });
});
