import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStyles, type AssStyle } from "@/lib/ass";

vi.mock("./tauri", () => ({
  loadStyleLibraryText: vi.fn(),
  saveStyleLibraryText: vi.fn(),
}));

const { loadStyleLibraryText, saveStyleLibraryText } = await import("./tauri");
const {
  STYLE_LIBRARY_VERSION,
  parseStyleLibrary,
  serializeStyleLibrary,
  loadStyleLibrary,
  saveStyleLibrary,
} = await import("./styleLibrary");

function sampleStyle(overrides: Partial<AssStyle> = {}): AssStyle {
  return { ...createDefaultStyles()[0], ...overrides };
}

describe("styleLibrary schema", () => {
  beforeEach(() => {
    vi.mocked(loadStyleLibraryText).mockReset();
    vi.mocked(saveStyleLibraryText).mockReset();
  });

  it("serializes every AssStyle field and round-trips", () => {
    const styles = [
      sampleStyle({ name: "Primary", fontSize: 54, bold: true }),
      sampleStyle({ name: "Secondary", fontSize: 44, marginV: 95 }),
    ];
    const json = serializeStyleLibrary(styles);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(STYLE_LIBRARY_VERSION);
    expect(parsed.styles).toHaveLength(2);
    expect(parseStyleLibrary(json)).toEqual(styles);
  });

  it("seeds defaults on first run only after write succeeds", async () => {
    vi.mocked(loadStyleLibraryText).mockResolvedValueOnce(null);
    vi.mocked(saveStyleLibraryText).mockResolvedValueOnce(undefined);

    const styles = await loadStyleLibrary();
    expect(styles.map((s) => s.name)).toEqual(["Primary", "Secondary"]);
    expect(saveStyleLibraryText).toHaveBeenCalledTimes(1);
    const written = vi.mocked(saveStyleLibraryText).mock.calls[0][0];
    expect(parseStyleLibrary(written)).toEqual(createDefaultStyles());
  });

  it("keeps an existing empty library empty", async () => {
    vi.mocked(loadStyleLibraryText).mockResolvedValueOnce(
      serializeStyleLibrary([]),
    );
    const styles = await loadStyleLibrary();
    expect(styles).toEqual([]);
    expect(saveStyleLibraryText).not.toHaveBeenCalled();
  });

  it("does not restore edited or deleted defaults", async () => {
    const edited = [sampleStyle({ name: "Primary", fontSize: 12 })];
    vi.mocked(loadStyleLibraryText).mockResolvedValueOnce(
      serializeStyleLibrary(edited),
    );
    await expect(loadStyleLibrary()).resolves.toEqual(edited);
    expect(saveStyleLibraryText).not.toHaveBeenCalled();
  });

  it("rejects seed write failure without claiming ready styles", async () => {
    vi.mocked(loadStyleLibraryText).mockResolvedValueOnce(null);
    vi.mocked(saveStyleLibraryText).mockRejectedValueOnce(new Error("disk full"));
    await expect(loadStyleLibrary()).rejects.toThrow("disk full");
  });

  it("rejects malformed JSON without writing", () => {
    expect(() => parseStyleLibrary("{")).toThrow(/JSON/);
    expect(saveStyleLibraryText).not.toHaveBeenCalled();
  });

  it("rejects unsupported versions without writing", () => {
    expect(() =>
      parseStyleLibrary(JSON.stringify({ version: 2, styles: [] })),
    ).toThrow(/版本/);
  });

  it("rejects missing or wrong field types", () => {
    const base = sampleStyle();
    const { name: _n, ...missingName } = base;
    expect(() =>
      parseStyleLibrary(
        JSON.stringify({ version: 1, styles: [missingName] }),
      ),
    ).toThrow(/缺少字段/);

    expect(() =>
      parseStyleLibrary(
        JSON.stringify({
          version: 1,
          styles: [{ ...base, fontSize: "big" }],
        }),
      ),
    ).toThrow(/有限数字|类型错误/);
  });

  it("rejects non-finite numbers, empty names, and duplicates", () => {
    expect(() =>
      parseStyleLibrary(
        JSON.stringify({
          version: 1,
          styles: [sampleStyle({ fontSize: Number.NaN })],
        }),
      ),
    ).toThrow(/有限数字/);

    expect(() =>
      parseStyleLibrary(
        JSON.stringify({
          version: 1,
          styles: [sampleStyle({ name: "  " })],
        }),
      ),
    ).toThrow(/为空/);

    expect(() =>
      parseStyleLibrary(
        JSON.stringify({
          version: 1,
          styles: [sampleStyle({ name: "A" }), sampleStyle({ name: "A" })],
        }),
      ),
    ).toThrow(/重复/);
  });

  it("saveStyleLibrary validates then writes", async () => {
    vi.mocked(saveStyleLibraryText).mockResolvedValueOnce(undefined);
    const styles = [sampleStyle({ name: "X" })];
    await saveStyleLibrary(styles);
    expect(saveStyleLibraryText).toHaveBeenCalledTimes(1);
    expect(parseStyleLibrary(vi.mocked(saveStyleLibraryText).mock.calls[0][0])).toEqual(
      styles,
    );
  });

  it("saveStyleLibrary rejects duplicate names before writing", async () => {
    await expect(
      saveStyleLibrary([
        sampleStyle({ name: "A" }),
        sampleStyle({ name: "A" }),
      ]),
    ).rejects.toThrow(/重复/);
    expect(saveStyleLibraryText).not.toHaveBeenCalled();
  });
});
