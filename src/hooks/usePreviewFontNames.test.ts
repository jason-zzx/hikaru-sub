import { describe, expect, it } from "vitest";
import { fontNamesFromFiles } from "./usePreviewFontNames";

describe("fontNamesFromFiles", () => {
  it("derives a deduplicated sorted font list from discovered font files", () => {
    expect(
      fontNamesFromFiles([
        "NotoSansSC-Regular.otf",
        "NotoSansSC-Bold.otf",
        "Arial.ttf",
        "YuGothic.ttc",
      ]),
    ).toEqual(["Arial", "NotoSansSC", "YuGothic"]);
  });
});
