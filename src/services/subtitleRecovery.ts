import { confirm } from "@tauri-apps/plugin-dialog";
import { parseAss, serializeAss } from "@/lib/ass";
import type { ActiveSubtitleKind, VideoSession } from "../types";
import { useProjectStore } from "../stores/projectStore";
import {
  deleteSubtitleRecovery as deleteSubtitleRecoveryFile,
  loadSubtitleRecovery as loadSubtitleRecoveryFile,
  saveSubtitleRecovery as saveSubtitleRecoveryFile,
} from "./tauri";
import { resolveAssDocumentForSave } from "../utils/assDocument";

const RECOVERY_VERSION = 1;

export interface SubtitleRecoverySnapshot {
  version: typeof RECOVERY_VERSION;
  videoPath: string;
  activeSubtitleKind: ActiveSubtitleKind | null;
  activeSubtitlePath: string | null;
  assText: string;
}

export type RecoveryRestoreResult =
  | "none"
  | "restored"
  | "discarded"
  | "invalid"
  | "error";

let recoveryQueue = Promise.resolve();
const recoveryWriteSuppressed = new Set<string>();

function enqueueRecoveryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = recoveryQueue.then(operation, operation);
  recoveryQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function serializeSubtitleRecovery(
  snapshot: SubtitleRecoverySnapshot,
): string {
  return JSON.stringify(snapshot);
}

export function parseSubtitleRecovery(
  content: string,
  videoPath: string,
): SubtitleRecoverySnapshot | null {
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<SubtitleRecoverySnapshot>;
    if (
      candidate.version !== RECOVERY_VERSION ||
      candidate.videoPath !== videoPath ||
      typeof candidate.assText !== "string"
    ) {
      return null;
    }
    if (
      candidate.activeSubtitleKind !== null &&
      candidate.activeSubtitleKind !== "transcribed" &&
      candidate.activeSubtitleKind !== "translated"
    ) {
      return null;
    }
    if (
      candidate.activeSubtitlePath !== null &&
      typeof candidate.activeSubtitlePath !== "string"
    ) {
      return null;
    }
    return {
      version: RECOVERY_VERSION,
      videoPath,
      activeSubtitleKind: candidate.activeSubtitleKind ?? null,
      activeSubtitlePath: candidate.activeSubtitlePath ?? null,
      assText: candidate.assText,
    };
  } catch {
    return null;
  }
}

export async function clearSubtitleRecovery(videoPath: string): Promise<void> {
  return enqueueRecoveryOperation(async () => {
    await deleteSubtitleRecoveryFile(videoPath);
  });
}

export async function discardSubtitleRecovery(videoPath: string): Promise<void> {
  recoveryWriteSuppressed.add(videoPath);
  try {
    await clearSubtitleRecovery(videoPath);
  } catch (err) {
    recoveryWriteSuppressed.delete(videoPath);
    throw err;
  }
}

export function resumeSubtitleRecovery(videoPath: string): void {
  recoveryWriteSuppressed.delete(videoPath);
}

export async function clearSubtitleRecoveryIfClean(
  videoPath: string,
): Promise<boolean> {
  const cleared = await enqueueRecoveryOperation(async () => {
    const state = useProjectStore.getState();
    if (state.session?.videoPath !== videoPath || state.isDirty) return false;
    await deleteSubtitleRecoveryFile(videoPath);
    const afterDelete = useProjectStore.getState();
    return (
      afterDelete.session?.videoPath === videoPath && !afterDelete.isDirty
    );
  });

  if (!cleared) {
    const state = useProjectStore.getState();
    if (state.session?.videoPath === videoPath && state.isDirty) {
      await saveCurrentSubtitleRecovery();
    }
  }
  return cleared;
}

export async function loadSubtitleRecovery(
  videoPath: string,
): Promise<string | null> {
  return enqueueRecoveryOperation(() => loadSubtitleRecoveryFile(videoPath));
}

export async function saveCurrentSubtitleRecovery(): Promise<boolean> {
  return enqueueRecoveryOperation(async () => {
    const state = useProjectStore.getState();
    const session = state.session;
    if (
      !session ||
      recoveryWriteSuppressed.has(session.videoPath) ||
      !state.isDirty ||
      state.history.compositionPreview
    ) {
      return false;
    }

    const doc = resolveAssDocumentForSave(
      state.cues,
      state.assScriptInfo,
      state.assStyles,
      { title: "Hikaru Sub" },
    );
    const content = serializeSubtitleRecovery({
      version: RECOVERY_VERSION,
      videoPath: session.videoPath,
      activeSubtitleKind: state.activeSubtitleKind,
      activeSubtitlePath: state.activeSubtitlePath,
      assText: serializeAss(doc, { preserveOrder: true }),
    });
    await saveSubtitleRecoveryFile(session.videoPath, content);
    return true;
  });
}

export async function restoreSubtitleRecovery(
  session: VideoSession,
): Promise<RecoveryRestoreResult> {
  let content: string | null;
  try {
    content = await loadSubtitleRecovery(session.videoPath);
  } catch (err) {
    console.warn("读取字幕恢复文件失败:", err);
    return "error";
  }
  if (!content) return "none";

  const snapshot = parseSubtitleRecovery(content, session.videoPath);
  if (!snapshot) return "invalid";

  let restore = false;
  try {
    restore = await confirm(
      "检测到此工作视频的未保存字幕恢复文件，是否恢复？",
      {
        title: "Hikaru Sub",
        kind: "warning",
        okLabel: "恢复",
        cancelLabel: "放弃",
      },
    );
  } catch {
    return "none";
  }

  if (!restore) {
    try {
      await clearSubtitleRecovery(session.videoPath);
      return "discarded";
    } catch (err) {
      console.warn("删除字幕恢复文件失败:", err);
      return "error";
    }
  }

  if (useProjectStore.getState().session?.videoPath !== session.videoPath) {
    return "none";
  }
  const doc = parseAss(snapshot.assText, { mergeBilingual: false });
  const expectedSubtitlePath =
    snapshot.activeSubtitleKind === "translated"
      ? session.translatedAssPath
      : snapshot.activeSubtitleKind === "transcribed"
        ? session.transcribedAssPath
        : null;
  const activeSubtitlePath =
    snapshot.activeSubtitlePath === expectedSubtitlePath
      ? expectedSubtitlePath
      : null;
  useProjectStore.getState().loadAssDocument(
    doc,
    snapshot.activeSubtitleKind
      ? {
          kind: snapshot.activeSubtitleKind,
          path: activeSubtitlePath,
        }
      : undefined,
  );
  useProjectStore.getState().markDirty();
  return "restored";
}
