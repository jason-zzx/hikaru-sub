import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EDITOR_PANE_LAYOUT,
  EDITOR_PANE_LAYOUT_STORAGE_KEY,
  constrainPanePercent,
  readEditorPaneLayout,
  writeEditorPaneLayout,
} from "./editorPaneLayout";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: (key: string) =>
      key === EDITOR_PANE_LAYOUT_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => {
      if (key === EDITOR_PANE_LAYOUT_STORAGE_KEY) value = next;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("editorPaneLayout", () => {
  it("keeps the previous fixed-grid ratios as defaults", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(DEFAULT_EDITOR_PANE_LAYOUT.leftPercent).toBeCloseTo(58.3333, 4);
    expect(DEFAULT_EDITOR_PANE_LAYOUT.listPercent).toBe(55);
    expect(readEditorPaneLayout()).toEqual(DEFAULT_EDITOR_PANE_LAYOUT);
  });

  it("reads valid persisted ratios and rejects invalid data", () => {
    const valid = { leftPercent: 62, listPercent: 48 };
    vi.stubGlobal("localStorage", memoryStorage(JSON.stringify(valid)));
    expect(readEditorPaneLayout()).toEqual(valid);

    for (const invalid of [
      "not-json",
      "null",
      "{}",
      JSON.stringify({ leftPercent: 0, listPercent: 50 }),
      JSON.stringify({ leftPercent: 50, listPercent: 100 }),
      JSON.stringify({ leftPercent: "50", listPercent: 50 }),
      '{"leftPercent":1e309,"listPercent":50}',
    ]) {
      vi.stubGlobal("localStorage", memoryStorage(invalid));
      expect(readEditorPaneLayout()).toEqual(DEFAULT_EDITOR_PANE_LAYOUT);
    }
  });

  it("falls back when storage access is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readEditorPaneLayout()).toEqual(DEFAULT_EDITOR_PANE_LAYOUT);
  });

  it("clamps pointer ratios to both adjacent pixel minimums", () => {
    expect(constrainPanePercent(10, 1006, 320, 360)).toBe(32);
    expect(constrainPanePercent(50, 1006, 320, 360)).toBe(50);
    expect(constrainPanePercent(90, 1006, 320, 360)).toBe(64);

    const minimumProportion = (320 / (320 + 360)) * 100;
    expect(constrainPanePercent(80, 506, 320, 360)).toBeCloseTo(
      minimumProportion,
    );
    expect(constrainPanePercent(63, Number.NaN, 320, 360)).toBe(63);
  });

  it("persists and restores a layout round trip without throwing", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const layout = { leftPercent: 61.5, listPercent: 44 };
    writeEditorPaneLayout(layout);
    expect(readEditorPaneLayout()).toEqual(layout);

    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => writeEditorPaneLayout(layout)).not.toThrow();
  });
});
