import { describe, expect, it } from "vitest";
import {
  applyEditorHotkeyOverrides,
  EDITOR_HOTKEYS,
  formatHotkeyLabel,
  groupHotkeysByCategory,
} from "./hotkeys";

describe("groupHotkeysByCategory", () => {
  it("按类别分组且保持键位表顺序", () => {
    const groups = groupHotkeysByCategory(EDITOR_HOTKEYS);
    expect([...groups.keys()]).toEqual(["导航", "播放", "打点", "编辑", "系统"]);
    expect(groups.get("打点")).toHaveLength(2);
  });

  it("handledLocally 条目也展示（Enter/Esc 属于键位表）", () => {
    const groups = groupHotkeysByCategory(EDITOR_HOTKEYS);
    const editLabels = groups.get("编辑")!.map(formatHotkeyLabel);
    expect(editLabels).toContain("Enter");
    expect(editLabels).toContain("Esc");
  });

  it("groups effective customized labels", () => {
    const defs = applyEditorHotkeyOverrides([
      { id: "save", key: "k", ctrl: true, alt: false, shift: false },
    ]);
    const system = groupHotkeysByCategory(defs).get("系统")!;
    expect(system.find((def) => def.id === "save")?.key).toBe("k");
    expect(
      formatHotkeyLabel({ key: "k", ctrl: true, alt: false, shift: false }),
    ).toBe("Ctrl+K");
  });
});
