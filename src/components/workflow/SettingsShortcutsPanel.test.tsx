// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EditorHotkeyOverride } from "../../types";
import { SettingsShortcutsPanel } from "./SettingsShortcutsPanel";

function Harness({ initial = [] }: { initial?: EditorHotkeyOverride[] }) {
  const [overrides, setOverrides] = useState(initial);
  return <SettingsShortcutsPanel overrides={overrides} onChange={setOverrides} />;
}

describe("SettingsShortcutsPanel", () => {
  afterEach(cleanup);

  it("groups every editor shortcut and records a custom binding", () => {
    render(<Harness />);

    expect(screen.getByText("导航")).toBeTruthy();
    expect(screen.getByText("系统")).toBeTruthy();
    const save = screen.getByLabelText("保存 快捷键") as HTMLInputElement;
    expect(save.value).toBe("Ctrl+S");

    fireEvent.keyDown(save, {
      key: "k",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    });
    expect(save.value).toBe("Ctrl+K");
  });

  it("restores only one shortcut and clears only that row's recording error", () => {
    render(
      <Harness
        initial={[
          { id: "save", key: "j", ctrl: true, alt: false, shift: false },
          { id: "save", key: "k", ctrl: true, alt: false, shift: false },
          {
            id: "toggle-play-ctrl-p",
            key: "q",
            ctrl: true,
            alt: false,
            shift: false,
          },
        ]}
      />,
    );

    const save = screen.getByLabelText("保存 快捷键") as HTMLInputElement;
    const play = screen.getByLabelText(
      "播放 / 暂停（编辑框内可用） 快捷键",
    ) as HTMLInputElement;
    fireEvent.keyDown(save, {
      key: "z",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    });
    expect(screen.getByRole("alert").textContent).toContain("Ctrl+Z");

    fireEvent.click(
      screen.getByRole("button", {
        name: "恢复播放 / 暂停（编辑框内可用）默认快捷键",
      }),
    );
    expect(save.value).toBe("Ctrl+K");
    expect(play.value).toBe("Ctrl+P");
    expect(screen.getByRole("alert").textContent).toContain("Ctrl+Z");

    fireEvent.click(screen.getByRole("button", { name: "恢复保存默认快捷键" }));
    expect(save.value).toBe("Ctrl+S");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports persisted conflicts as invalid", () => {
    render(
      <Harness
        initial={[
          { id: "save", key: "z", ctrl: true, alt: false, shift: false },
        ]}
      />,
    );

    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("rejects conflicts and restores defaults", () => {
    render(
      <Harness
        initial={[
          { id: "save", key: "k", ctrl: true, alt: false, shift: false },
        ]}
      />,
    );
    const save = screen.getByLabelText("保存 快捷键") as HTMLInputElement;
    expect(save.value).toBe("Ctrl+K");

    fireEvent.keyDown(save, {
      key: "z",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    });
    expect(save.value).toBe("Ctrl+K");
    expect(screen.getByRole("alert").textContent).toContain("Ctrl+Z");

    fireEvent.click(screen.getByRole("button", { name: "恢复默认值" }));
    expect(save.value).toBe("Ctrl+S");
  });
});
