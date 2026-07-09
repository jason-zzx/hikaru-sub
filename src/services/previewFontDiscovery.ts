import type { PreviewFontFile } from "../types";
import { discoverPreviewFonts } from "./tauri";

type DiscoverFn = (extraDirs?: string[]) => Promise<PreviewFontFile[]>;

let discoverImpl: DiscoverFn = discoverPreviewFonts;
let cachedFonts: PreviewFontFile[] | null = null;
let inFlight: Promise<PreviewFontFile[]> | null = null;

/** 测试用：注入发现实现并清空缓存。 */
export function __setPreviewFontDiscoverImplForTests(impl: DiscoverFn | null) {
  discoverImpl = impl ?? discoverPreviewFonts;
  cachedFonts = null;
  inFlight = null;
}

/** 测试用：清空进程内缓存。 */
export function __resetPreviewFontDiscoveryForTests() {
  cachedFonts = null;
  inFlight = null;
}

/**
 * 进程内单例：并发调用合并为一次 invoke，成功后复用结果。
 * 默认 extraDirs 为空；带额外目录时不走缓存（当前产品路径均不传）。
 */
export async function getPreviewFonts(
  extraDirs: string[] = [],
): Promise<PreviewFontFile[]> {
  if (extraDirs.length > 0) {
    return discoverImpl(extraDirs);
  }

  if (cachedFonts) return cachedFonts;
  if (inFlight) return inFlight;

  inFlight = discoverImpl([])
    .then((fonts) => {
      cachedFonts = fonts;
      return fonts;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
