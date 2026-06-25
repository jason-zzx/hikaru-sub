import { describe, expect, it } from "vitest";
import { createDefaultScriptInfo, createDefaultStyles } from "@hikaru/ass-core";
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
});
