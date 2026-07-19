// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./ColorPicker";

describe("ColorPicker", () => {
  it("closes the picker and disables its trigger while disabled", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ColorPicker
        label="主颜色"
        value="&H00FFFFFF"
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "选择主颜色" }));
    expect(screen.getByText("HEX")).toBeTruthy();

    rerender(
      <ColorPicker
        label="主颜色"
        value="&H00FFFFFF"
        onChange={vi.fn()}
        disabled
      />,
    );

    expect(
      (screen.getByRole("button", { name: "选择主颜色" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText("HEX")).toBeNull();
  });
});
