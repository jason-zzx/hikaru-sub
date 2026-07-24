// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShiftTimesDialog } from "./ShiftTimesDialog";

afterEach(cleanup);

describe("ShiftTimesDialog", () => {
  it("disables zero values and confirms a time shift with the default options", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ShiftTimesDialog
        open
        selectedCount={2}
        fps={25}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole("button", { name: "确认平移" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText("平移量");
    fireEvent.change(input, {
      target: { value: "0:00:01.25", selectionStart: 10 },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith(1250, "both");
  });

  it("converts frames using FPS and sends direction and target", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ShiftTimesDialog
        open
        selectedCount={1}
        fps={25}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "帧数" }));
    const frameInput = screen.getByRole("spinbutton", { name: "帧数" });
    await user.clear(frameInput);
    await user.type(frameInput, "3");
    await user.click(screen.getByRole("radio", { name: "提前" }));
    await user.click(screen.getByRole("radio", { name: "仅结束" }));
    await user.click(screen.getByRole("button", { name: "确认平移" }));

    expect(onConfirm).toHaveBeenCalledWith(-120, "end");
  });

  it("uses the 30 FPS fallback for frame input", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ShiftTimesDialog
        open
        selectedCount={1}
        fps={null}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "帧数" }));
    const frameInput = screen.getByRole("spinbutton", { name: "帧数" });
    await user.clear(frameInput);
    await user.type(frameInput, "3");
    await user.click(screen.getByRole("button", { name: "确认平移" }));

    expect(onConfirm).toHaveBeenCalledWith(100, "both");
  });

  it("disables frame counts that exceed the safe millisecond range", async () => {
    const user = userEvent.setup();
    render(
      <ShiftTimesDialog
        open
        selectedCount={1}
        fps={25}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "帧数" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "帧数" }), {
      target: { value: String(Number.MAX_SAFE_INTEGER) },
    });

    expect(
      (screen.getByRole("button", { name: "确认平移" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
