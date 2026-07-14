import { describe, expect, it } from "vitest";
import { createDefaultScriptInfo, createDefaultStyles } from "@/lib/ass";
import { assInlineToCss } from "./assRunCss";

const viewport = { width: 960, height: 540 };
const scriptInfo = createDefaultScriptInfo("Test", 1920, 1080);
const primary = createDefaultStyles()[0];

describe("assInlineToCss", () => {
  it("maps inline color and bold overrides", () => {
    const css = assInlineToCss(
      primary,
      { bold: true, primaryColor: "&H000000FF" },
      scriptInfo,
      viewport,
    );
    expect(css.fontWeight).toBe(700);
    expect(css.color).toBe("#FF0000");
  });

  it("maps inline font size with ASS renderer point scaling", () => {
    const css = assInlineToCss(
      primary,
      { fontSize: 54 },
      scriptInfo,
      viewport,
    );

    expect(css.fontSize).toBe(19.98);
  });

  it("uses the libass-selected thin Noto Sans SC weight for non-bold inline text", () => {
    const css = assInlineToCss(primary, {}, scriptInfo, viewport);

    expect(css.fontFamily).toBe(
      '"Noto Sans SC", sans-serif',
    );
    expect(css.fontWeight).toBe(100);
  });

  it("maps inline outline and shadow overrides to the run text shadow", () => {
    const css = assInlineToCss(
      primary,
      {
        outline: 4,
        shadow: 3,
        outlineColor: "&H000000FF",
        backColor: "&H80000000",
      },
      scriptInfo,
      viewport,
    );

    expect(css.textShadow).toContain("-2px 0px 0 #FF0000");
    expect(css.textShadow).toContain("2px 2px 0 rgba(0, 0, 0, 0.498)");
  });

  it("can clear inherited outline and shadow for an inline run", () => {
    const css = assInlineToCss(
      primary,
      { outline: 0, shadow: 0 },
      scriptInfo,
      viewport,
    );

    expect(css.textShadow).toBe("none");
  });
});
