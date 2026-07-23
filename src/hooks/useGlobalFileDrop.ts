import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../stores/projectStore";
import { useUiStore } from "../stores/uiStore";
import { SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from "../services/tauri";
import { selectCueAndSeek } from "../services/editorActions";
import { importExternalSubtitle, openVideoSession } from "../services/openVideo";

export type DroppedFileKind = "video" | "subtitle" | null;

export function classifyDroppedPath(path: string): DroppedFileKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  if ((SUBTITLE_EXTENSIONS as readonly string[]).includes(ext))
    return "subtitle";
  return null;
}

/**
 * 全局文件拖放：视频 → 打开会话流程；ASS/SRT → 载入当前会话编辑器。
 * 挂在 AppLayout，整个窗口生效。
 */
export function useGlobalFileDrop(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let handling = false;

    const register = async () => {
      const stopListening = await getCurrentWindow().onDragDropEvent(async (event) => {
        if (disposed || event.payload.type !== "drop" || handling) return;
        const target = event.payload.paths.find((path) =>
          classifyDroppedPath(path),
        );
        if (!target) return;

        handling = true;
        try {
          if (classifyDroppedPath(target) === "video") {
            const result = await openVideoSession(target);
            if (!result.ok) {
              if ("error" in result) {
                await message(result.error, {
                  title: "Hikaru Sub",
                  kind: "error",
                });
              } else if ("changed" in result) {
                await message("当前字幕已发生变化，已取消打开视频", {
                  title: "Hikaru Sub",
                  kind: "info",
                });
              }
              return;
            }
            useUiStore
              .getState()
              .setStep(result.hasSubtitleDocument ? "editor" : "transcribe");
            return;
          }

          const session = useProjectStore.getState().session;
          if (!session) {
            await message("请先导入视频，再拖入字幕文件", {
              title: "Hikaru Sub",
              kind: "info",
            });
            return;
          }
          const result = await importExternalSubtitle(
            session.videoPath,
            target,
          );
          if (!result.ok) {
            if ("changed" in result) {
              await message("当前字幕已发生变化，已取消载入字幕文件", {
                title: "Hikaru Sub",
                kind: "info",
              });
            } else if ("error" in result) {
              await message(`载入字幕文件失败：${result.error}`, {
                title: "Hikaru Sub",
                kind: "error",
              });
            }
            return;
          }
          const firstCue = useProjectStore.getState().cues[0];
          if (firstCue) selectCueAndSeek(firstCue);
          useUiStore.getState().setStep("editor");
        } finally {
          handling = false;
        }
      });

      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    };

    void register().catch((error) => {
      console.warn("注册全局文件拖放失败:", error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
