import { parseAss } from "@/lib/ass";
import {
  captureProjectDocumentGuard,
  useProjectStore,
} from "../stores/projectStore";
import { parseExternalSubtitleDocument } from "../utils/subtitleImport";
import { recordRecentVideo } from "./recentVideos";
import {
  getVideoInfo,
  loadAssText,
  pathExists,
  prepareVideoSession,
  transcribedAssPath,
  translatedAssPath,
} from "./tauri";
import { confirmDiscardUnsavedChanges } from "./unsavedChanges";
import {
  restoreSubtitleRecovery,
  withDiscardedSubtitleRecovery,
  type RecoveryRestoreResult,
} from "./subtitleRecovery";

export type OpenVideoResult =
  | {
      ok: true;
      hasSubtitleDocument: boolean;
      recovery: RecoveryRestoreResult;
    }
  | { ok: false; cancelled: true }
  | { ok: false; changed: true }
  | { ok: false; error: string };

/**
 * 打开视频会话：未保存确认 → prepareVideoSession → 同目录字幕自动加载
 * （翻译优先，其次转录）→ 字幕恢复快照处理 → 记录最近列表。
 * ImportView、WelcomeView 最近列表与全局拖放共用。
 */
export async function openVideoSession(
  videoPath: string,
): Promise<OpenVideoResult> {
  const documentGuard = captureProjectDocumentGuard();
  const discardDecision = await confirmDiscardUnsavedChanges();
  if (!discardDecision.proceed) return { ok: false, cancelled: true };
  if (!documentGuard.unchanged()) return { ok: false, changed: true };

  try {
    const session = await prepareVideoSession(videoPath);
    if (!documentGuard.unchanged()) return { ok: false, changed: true };

    const { loadAssDocument, setSession } = useProjectStore.getState();
    const replaced = await withDiscardedSubtitleRecovery(
      discardDecision.recoveryVideoPath,
      () => {
        if (!documentGuard.unchanged()) return false;
        setSession(session);
        return true;
      },
    );
    if (!replaced) return { ok: false, changed: true };

    let loadedSubtitle = false;
    let sessionGuard = captureProjectDocumentGuard(session.videoPath);
    const translatedPath = translatedAssPath(session);
    const transcribedPath = transcribedAssPath(session);

    if (await pathExists(translatedPath)) {
      try {
        const doc = parseAss(
          await loadAssText(translatedPath),
          { mergeBilingual: false },
        );
        if (!sessionGuard.unchanged()) return { ok: false, changed: true };
        loadAssDocument(doc, { kind: "translated", path: translatedPath });
        loadedSubtitle = true;
        sessionGuard = captureProjectDocumentGuard(session.videoPath);
      } catch {
        // Fall through to the transcribed subtitle.
      }
    }
    if (!loadedSubtitle) {
      if (!sessionGuard.unchanged()) return { ok: false, changed: true };
      if (await pathExists(transcribedPath)) {
        try {
          const doc = parseAss(
            await loadAssText(transcribedPath),
            { mergeBilingual: false },
          );
          if (!sessionGuard.unchanged()) return { ok: false, changed: true };
          loadAssDocument(doc, { kind: "transcribed", path: transcribedPath });
          loadedSubtitle = true;
          sessionGuard = captureProjectDocumentGuard(session.videoPath);
        } catch {
          // Treat unreadable subtitle files as an incomplete stage.
        }
      }
    }

    if (!sessionGuard.unchanged()) return { ok: false, changed: true };
    const recovery = await restoreSubtitleRecovery(session);
    const state = useProjectStore.getState();
    if (
      state.session?.videoPath !== session.videoPath ||
      (recovery !== "restored" && !sessionGuard.unchanged())
    ) {
      return { ok: false, changed: true };
    }
    const activeSubtitleKind = state.activeSubtitleKind;
    recordRecentVideo(session);
    return {
      ok: true,
      hasSubtitleDocument:
        activeSubtitleKind !== null || loadedSubtitle || recovery === "restored",
      recovery,
    };
  } catch (e) {
    return { ok: false, error: `打开视频失败：${String(e)}` };
  }
}

export type ImportExternalSubtitleResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; changed: true }
  | { ok: false; error: string };

/**
 * 将外部 ASS/SRT 字幕载入当前会话（编辑器「载入字幕文件」与拖放共用）。
 * 成功后文档为脏状态、保存目标为空（首次保存时需选位置）。
 */
export async function importExternalSubtitle(
  videoPath: string,
  subtitlePath: string,
): Promise<ImportExternalSubtitleResult> {
  const discardDecision = await confirmDiscardUnsavedChanges();
  if (!discardDecision.proceed) return { ok: false, cancelled: true };

  try {
    const documentGuard = captureProjectDocumentGuard(videoPath);
    const [subtitleText, videoInfo] = await Promise.all([
      loadAssText(subtitlePath),
      getVideoInfo(videoPath),
    ]);
    if (!documentGuard.unchanged()) return { ok: false, changed: true };

    const doc = parseExternalSubtitleDocument({
      path: subtitlePath,
      text: subtitleText,
      playRes: { width: videoInfo.width, height: videoInfo.height },
    });

    const { loadAssDocument, markDirty } = useProjectStore.getState();
    const applied = await withDiscardedSubtitleRecovery(
      discardDecision.recoveryVideoPath,
      () => {
        if (!documentGuard.unchanged()) return false;
        loadAssDocument(doc, { kind: "translated", path: null });
        markDirty();
        return true;
      },
    );
    if (!applied) return { ok: false, changed: true };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
