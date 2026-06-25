import { describe, expect, it } from "vitest";
import { createDefaultStyles } from "./defaults";
import { parseAssTextLines } from "./assTags";

const primary = createDefaultStyles()[0];

describe("parseAssTextLines", () => {
  it("returns plain text as a single run", () => {
    const lines = parseAssTextLines("你好世界", primary);
    expect(lines).toHaveLength(1);
    expect(lines[0].runs).toEqual([{ text: "你好世界", inline: {}, style: primary }]);
  });

  it("applies bold and color overrides", () => {
    const lines = parseAssTextLines(
      "{\\b1\\c&H0000FF&}红色{\\r}普通",
      primary,
    );
    expect(lines[0].runs).toHaveLength(2);
    expect(lines[0].runs[0]).toMatchObject({
      text: "红色",
      inline: { bold: true, primaryColor: "&H000000FF" },
      style: primary,
    });
    expect(lines[0].runs[1]).toMatchObject({
      text: "普通",
      inline: {},
      style: primary,
    });
  });

  it("resets inline state on \\r", () => {
    const lines = parseAssTextLines("{\\b1\\i1}加粗斜体{\\r}普通", primary);
    const runs = lines[0].runs;
    expect(runs[0]).toMatchObject({
      text: "加粗斜体",
      inline: { bold: true, italic: true },
      style: primary,
    });
    expect(runs[runs.length - 1]).toMatchObject({
      text: "普通",
      inline: {},
      style: primary,
    });
  });

  it("splits hard line breaks", () => {
    const lines = parseAssTextLines("第一行\\N第二行", primary);
    expect(lines).toHaveLength(2);
    expect(lines[0].runs[0].text).toBe("第一行");
    expect(lines[1].runs[0].text).toBe("第二行");
  });

  it("handles hard space and soft break", () => {
    const lines = parseAssTextLines("a\\hb\\nc", primary);
    expect(lines[0].runs[0].text).toBe("a\u00A0b\nc");
  });

  it("applies font size and name overrides", () => {
    const lines = parseAssTextLines("{\\fs72\\fnArial}大字", primary);
    expect(lines[0].runs[0].inline).toMatchObject({
      fontSize: 72,
      fontName: "Arial",
    });
  });

  it("resolves \\rStyleName via resolveStyle", () => {
    const secondary = createDefaultStyles()[1];
    const lines = parseAssTextLines("{\\rSecondary}译文样式", primary, {
      resolveStyle: (name) =>
        name === "Secondary" ? secondary : undefined,
    });
    expect(lines[0].runs[0].text).toBe("译文样式");
    expect(lines[0].runs[0].inline).toEqual({});
    expect(lines[0].runs[0].style).toBe(secondary);
  });

  it("ignores unsupported tags without removing text", () => {
    const lines = parseAssTextLines("{\\pos(100,200)}可见", primary);
    expect(lines[0].runs[0].text).toBe("可见");
    expect(lines[0].runs[0].inline).toEqual({});
    expect(lines[0].runs[0].style).toBe(primary);
  });

  it("combines multiple tags in one block", () => {
    const lines = parseAssTextLines("{\\b1\\i1\\u1\\s1}样式", primary);
    expect(lines[0].runs[0].inline).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      strikeOut: true,
    });
  });
});
