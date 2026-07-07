import { describe, expect, it } from "vitest";
import {
  EDITOR_HOTKEYS,
  findHotkey,
  isEditableTarget,
  type HotkeyEventLike,
} from "./hotkeys";

function ev(overrides: Partial<HotkeyEventLike>): HotkeyEventLike {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    target: null,
    ...overrides,
  };
}

const TEXTAREA = { tagName: "TEXTAREA" };
const INPUT = { tagName: "INPUT" };
const BODY = { tagName: "BODY" };

describe("isEditableTarget", () => {
  it("textarea/input/contentEditable 视为框内", () => {
    expect(isEditableTarget(TEXTAREA)).toBe(true);
    expect(isEditableTarget(INPUT)).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("body/null 视为框外", () => {
    expect(isEditableTarget(BODY)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("findHotkey", () => {
  it("框外方向键匹配帧步进与导航", () => {
    expect(findHotkey(ev({ key: "ArrowRight", target: BODY }))?.action).toBe("frame-next");
    expect(findHotkey(ev({ key: "ArrowDown", target: BODY }))?.action).toBe("select-next");
  });

  it("修饰键区分边界跳转与快速跳帧", () => {
    expect(findHotkey(ev({ key: "ArrowLeft", ctrlKey: true, target: BODY }))?.action).toBe("boundary-prev");
    expect(findHotkey(ev({ key: "ArrowLeft", altKey: true, target: BODY }))?.action).toBe("frame-fast-prev");
  });

  it("框内屏蔽 outside-input 键", () => {
    expect(findHotkey(ev({ key: " ", target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "ArrowDown", target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "Delete", target: INPUT }))).toBeNull();
  });

  it("global 键在框内外都生效", () => {
    expect(findHotkey(ev({ key: "3", ctrlKey: true, target: TEXTAREA }))?.action).toBe("stamp-start");
    expect(findHotkey(ev({ key: "4", ctrlKey: true, target: BODY }))?.action).toBe("stamp-end");
    expect(findHotkey(ev({ key: "ArrowDown", altKey: true, target: TEXTAREA }))?.action).toBe("select-next");
    expect(findHotkey(ev({ key: "s", ctrlKey: true, target: TEXTAREA }))?.action).toBe("save");
  });

  it("metaKey 等价 ctrl（macOS）", () => {
    expect(findHotkey(ev({ key: "s", metaKey: true, target: BODY }))?.action).toBe("save");
  });

  it("Ctrl+Z 框内不匹配（放行原生文本撤销），框外匹配 undo", () => {
    expect(findHotkey(ev({ key: "z", ctrlKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "z", ctrlKey: true, target: BODY }))?.action).toBe("undo");
    expect(findHotkey(ev({ key: "z", ctrlKey: true, shiftKey: true, target: BODY }))?.action).toBe("redo");
    expect(findHotkey(ev({ key: "y", ctrlKey: true, target: BODY }))?.action).toBe("redo");
  });

  it("Ctrl/Cmd+C/X/V match whole-row clipboard actions only outside text inputs", () => {
    expect(findHotkey(ev({ key: "c", ctrlKey: true, target: BODY }))?.action).toBe("copy-cues");
    expect(findHotkey(ev({ key: "x", ctrlKey: true, target: BODY }))?.action).toBe("cut-cues");
    expect(findHotkey(ev({ key: "v", metaKey: true, target: BODY }))?.action).toBe("paste-cues");

    expect(findHotkey(ev({ key: "c", ctrlKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "x", ctrlKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "v", ctrlKey: true, target: INPUT }))).toBeNull();
  });

  it("outside-input 作用域（Alt+←/→）框内也不匹配", () => {
    expect(findHotkey(ev({ key: "ArrowLeft", altKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "ArrowRight", altKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "ArrowLeft", altKey: true, target: BODY }))?.action).toBe("frame-fast-prev");
  });

  it("IME 组词中一律不匹配", () => {
    expect(findHotkey(ev({ key: "3", ctrlKey: true, isComposing: true, target: BODY }))).toBeNull();
  });

  it("? 呼出速查（Shift+/ 产生的 key）", () => {
    expect(findHotkey(ev({ key: "?", shiftKey: true, target: BODY }))?.action).toBe("toggle-help");
  });

  it("handledLocally 的键分发器跳过（Enter 由 SubtitleEditor 处理）", () => {
    expect(findHotkey(ev({ key: "Enter", target: TEXTAREA }))).toBeNull();
    const enterDef = EDITOR_HOTKEYS.find((d) => d.key === "Enter" && !d.shift);
    expect(enterDef?.handledLocally).toBe(true);
  });

  it("未定义组合不匹配", () => {
    expect(findHotkey(ev({ key: "q", target: BODY }))).toBeNull();
    expect(findHotkey(ev({ key: "r", ctrlKey: true, target: BODY }))).toBeNull();
  });
});
