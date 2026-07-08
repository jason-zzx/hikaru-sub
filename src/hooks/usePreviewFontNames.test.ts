import { describe, expect, it } from "vitest";
import { fontNamesFromFiles, mergePreviewFontNames } from "./usePreviewFontNames";

describe("fontNamesFromFiles", () => {
  it("derives a deduplicated sorted font list from discovered font files", () => {
    expect(
      fontNamesFromFiles([
        "NotoSansSC-Regular.otf",
        "NotoSansSC-Bold.otf",
        "Arial.ttf",
        "msyh.ttc",
        "simfang.ttf",
        "YuGothic.ttc",
      ]),
    ).toEqual([
      "Arial",
      "FangSong",
      "Microsoft YaHei",
      "Noto Sans SC",
      "Yu Gothic",
    ]);
  });

  it("prefers localized display names from discovered font metadata", () => {
    expect(
      fontNamesFromFiles([
        {
          fileName: "msyh.ttc",
          displayName: "微软雅黑",
          familyNames: ["微软雅黑", "Microsoft YaHei"],
        },
        {
          fileName: "simfang.ttf",
          displayName: "仿宋",
          familyNames: ["仿宋", "FangSong"],
        },
      ] as any),
    ).toEqual(["仿宋", "微软雅黑"]);
  });
});

describe("mergePreviewFontNames", () => {
  it("keeps discovered font order before extra current/style names", () => {
    expect(
      mergePreviewFontNames(["Arial", "Noto Sans SC", "微软雅黑"], [
        "微软雅黑",
        "Custom Font",
        "Arial",
      ]),
    ).toEqual(["Arial", "Noto Sans SC", "微软雅黑", "Custom Font"]);
  });
});
