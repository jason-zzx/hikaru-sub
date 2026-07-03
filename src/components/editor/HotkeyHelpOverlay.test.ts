import { describe, expect, it } from "vitest";
import { groupHotkeysByCategory } from "./HotkeyHelpOverlay";
import { EDITOR_HOTKEYS } from "./hotkeys";

describe("groupHotkeysByCategory", () => {
  it("按类别分组且保持键位表顺序", () => {
    const groups = groupHotkeysByCategory(EDITOR_HOTKEYS);
    expect([...groups.keys()]).toEqual(["导航", "播放", "打点", "编辑", "系统"]);
    expect(groups.get("打点")).toHaveLength(2);
  });

  it("handledLocally 条目也展示（Enter/Esc 属于键位表）", () => {
    const groups = groupHotkeysByCategory(EDITOR_HOTKEYS);
    const editLabels = groups.get("编辑")!.map((d) => d.label);
    expect(editLabels).toContain("Enter");
    expect(editLabels).toContain("Esc");
  });
});
