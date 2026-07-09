import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewFontFile } from "../types";
import {
  __resetPreviewFontDiscoveryForTests,
  __setPreviewFontDiscoverImplForTests,
  getPreviewFonts,
} from "./previewFontDiscovery";

function font(fileName: string): PreviewFontFile {
  return {
    path: `C:/Fonts/${fileName}`,
    url: `http://127.0.0.1/media/${fileName}`,
    fileName,
    displayName: null,
    familyNames: [],
    fontNames: [],
  };
}

describe("getPreviewFonts", () => {
  afterEach(() => {
    __setPreviewFontDiscoverImplForTests(null);
    __resetPreviewFontDiscoveryForTests();
  });

  it("coalesces concurrent calls into a single discover invoke", async () => {
    let resolveDiscover!: (fonts: PreviewFontFile[]) => void;
    const discover = vi.fn(
      () =>
        new Promise<PreviewFontFile[]>((resolve) => {
          resolveDiscover = resolve;
        }),
    );
    __setPreviewFontDiscoverImplForTests(discover);

    const a = getPreviewFonts();
    const b = getPreviewFonts();
    expect(discover).toHaveBeenCalledTimes(1);

    resolveDiscover([font("Arial.ttf")]);
    await expect(Promise.all([a, b])).resolves.toEqual([
      [font("Arial.ttf")],
      [font("Arial.ttf")],
    ]);
  });

  it("reuses the cached result for later callers", async () => {
    const discover = vi.fn(async () => [font("Arial.ttf")]);
    __setPreviewFontDiscoverImplForTests(discover);

    await expect(getPreviewFonts()).resolves.toEqual([font("Arial.ttf")]);
    await expect(getPreviewFonts()).resolves.toEqual([font("Arial.ttf")]);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when extraDirs are provided", async () => {
    const discover = vi.fn(async (dirs: string[] = []) => [
      font(dirs[0] ? "Extra.ttf" : "Arial.ttf"),
    ]);
    __setPreviewFontDiscoverImplForTests(discover);

    await getPreviewFonts();
    await expect(getPreviewFonts(["D:/extra"])).resolves.toEqual([
      font("Extra.ttf"),
    ]);
    expect(discover).toHaveBeenCalledTimes(2);
  });
});
