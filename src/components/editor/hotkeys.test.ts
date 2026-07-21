import { describe, expect, it } from "vitest";
import {
  EDITOR_HOTKEYS,
  applyEditorHotkeyOverrides,
  findHotkey,
  findHotkeyConflicts,
  formatHotkeyLabel,
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

  it("Ctrl+Z 在框外与标记的持久控件内匹配 project undo；未标记框内放行原生撤销", () => {
    const marked = {
      tagName: "TEXTAREA",
      getAttribute: (name: string) =>
        name === "data-history-command" ? "true" : null,
    };
    expect(findHotkey(ev({ key: "z", ctrlKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "z", ctrlKey: true, target: marked }))?.action).toBe("undo");
    expect(findHotkey(ev({ key: "z", ctrlKey: true, target: BODY }))?.action).toBe("undo");
    expect(findHotkey(ev({ key: "z", ctrlKey: true, shiftKey: true, target: BODY }))?.action).toBe("redo");
    expect(findHotkey(ev({ key: "y", ctrlKey: true, target: BODY }))?.action).toBe("redo");
    expect(findHotkey(ev({ key: "y", ctrlKey: true, target: marked }))?.action).toBe("redo");
  });

  it("Ctrl/Cmd+C/X/V match whole-row clipboard actions only outside text inputs", () => {
    expect(findHotkey(ev({ key: "c", ctrlKey: true, target: BODY }))?.action).toBe("copy-cues");
    expect(findHotkey(ev({ key: "x", ctrlKey: true, target: BODY }))?.action).toBe("cut-cues");
    expect(findHotkey(ev({ key: "v", metaKey: true, target: BODY }))?.action).toBe("paste-cues");

    expect(findHotkey(ev({ key: "c", ctrlKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "x", ctrlKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "v", ctrlKey: true, target: INPUT }))).toBeNull();
  });

  it("Ctrl/Cmd+A 框外全选字幕行，框内放行原生全选文字", () => {
    expect(findHotkey(ev({ key: "a", ctrlKey: true, target: BODY }))?.action).toBe(
      "select-all-cues",
    );
    expect(findHotkey(ev({ key: "a", metaKey: true, target: BODY }))?.action).toBe(
      "select-all-cues",
    );
    expect(findHotkey(ev({ key: "a", ctrlKey: true, target: TEXTAREA }))).toBeNull();
    expect(findHotkey(ev({ key: "a", ctrlKey: true, target: INPUT }))).toBeNull();
  });

  it("Ctrl/Cmd+P 全局播放/暂停；空格仍仅框外生效", () => {
    expect(findHotkey(ev({ key: "p", ctrlKey: true, target: BODY }))?.action).toBe(
      "toggle-play",
    );
    expect(findHotkey(ev({ key: "p", ctrlKey: true, target: TEXTAREA }))?.action).toBe(
      "toggle-play",
    );
    expect(findHotkey(ev({ key: "p", metaKey: true, target: INPUT }))?.action).toBe(
      "toggle-play",
    );
    expect(findHotkey(ev({ key: " ", target: BODY }))?.action).toBe("toggle-play");
    expect(findHotkey(ev({ key: " ", target: TEXTAREA }))).toBeNull();
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
    expect(findHotkey(ev({ key: "f", ctrlKey: true, target: BODY }))?.action).toBe("open-find");
    expect(findHotkey(ev({ key: "f", ctrlKey: true, target: TEXTAREA }))?.action).toBe("open-find");
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

  it("uses customized global and local bindings", () => {
    const defs = applyEditorHotkeyOverrides([
      { id: "save", key: "k", ctrl: true, alt: false, shift: false },
      { id: "commit-and-next", key: "Tab", ctrl: false, alt: false, shift: false },
    ]);

    expect(findHotkey(ev({ key: "k", ctrlKey: true, target: BODY }), defs)?.action).toBe(
      "save",
    );
    expect(findHotkey(ev({ key: "s", ctrlKey: true, target: BODY }), defs)).toBeNull();
    expect(
      findHotkey(ev({ key: "Tab", target: TEXTAREA }), defs, { local: true })?.action,
    ).toBe("commit-and-next");
  });
});

describe("shortcut configuration", () => {
  it("ignores unknown overrides and reports effective conflicts", () => {
    const defs = applyEditorHotkeyOverrides([
      { id: "unknown", key: "q", ctrl: false, alt: false, shift: false },
      { id: "save", key: "z", ctrl: true, alt: false, shift: false },
    ]);

    expect(defs.find((def) => def.id === "unknown")).toBeUndefined();
    expect(defs.find((def) => def.id === "save")?.key).toBe("z");
    expect(findHotkeyConflicts([
      { id: "save", key: "z", ctrl: true, alt: false, shift: false },
    ])).toEqual([
      { label: "Ctrl+Z", ids: ["save", "undo"] },
    ]);
  });

  it("formats modifier labels from the effective binding", () => {
    expect(formatHotkeyLabel({ key: "k", ctrl: true, alt: false, shift: true })).toBe(
      "Ctrl+Shift+K",
    );
  });
});
