// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FontComboBox,
  findMatchingFontIndex,
  fontOptionsWithCurrent,
} from "./FontComboBox";

afterEach(() => cleanup());

describe("findMatchingFontIndex", () => {
  const fonts = ["Arial", "Noto Sans SC", "Microsoft YaHei", "Yu Gothic"];

  it("prefers the first font that starts with the typed value", () => {
    expect(findMatchingFontIndex(fonts, "mi")).toBe(2);
  });

  it("falls back to containing matches", () => {
    expect(findMatchingFontIndex(fonts, "sans")).toBe(1);
  });

  it("returns -1 when there is no usable query or match", () => {
    expect(findMatchingFontIndex(fonts, "")).toBe(-1);
    expect(findMatchingFontIndex(fonts, "missing")).toBe(-1);
  });
});

describe("FontComboBox", () => {
  it("commits a clicked option once", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    render(<FontComboBox value="" options={["Arial"]} onCommit={onCommit} />);

    await user.click(screen.getByPlaceholderText("字体"));
    await user.click(screen.getByRole("button", { name: "Arial" }));

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith("Arial");
  });

  it("closes the options and disables input while disabled", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FontComboBox value="" options={["Arial"]} onCommit={onCommit} />,
    );

    await user.click(screen.getByPlaceholderText("字体"));
    expect(screen.getByRole("button", { name: "Arial" })).toBeTruthy();

    rerender(
      <FontComboBox
        value=""
        options={["Arial"]}
        onCommit={onCommit}
        disabled
      />,
    );

    expect((screen.getByPlaceholderText("字体") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Arial" })).toBeNull();
  });
});

describe("fontOptionsWithCurrent", () => {
  it("does not move the selected font to the first option", () => {
    expect(
      fontOptionsWithCurrent("Microsoft YaHei", [
        "Arial",
        "Noto Sans SC",
        "Microsoft YaHei",
      ]),
    ).toEqual(["Arial", "Noto Sans SC", "Microsoft YaHei"]);
  });

  it("keeps a missing selected font available without changing known order", () => {
    expect(fontOptionsWithCurrent("Custom Font", ["Arial", "Noto Sans SC"])).toEqual([
      "Arial",
      "Noto Sans SC",
      "Custom Font",
    ]);
  });
});
