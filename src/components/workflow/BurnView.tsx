import { useMemo } from "react";
import { useSubtitleMergeMode } from "../../hooks/useSubtitleMergeMode";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import { AssSubtitleOverlay } from "../player/AssSubtitleOverlay";

export function BurnView() {
  const project = useProjectStore((s) => s.project);
  const cues = useProjectStore((s) => s.cues);
  const assStyles = useProjectStore((s) => s.assStyles);
  const assScriptInfo = useProjectStore((s) => s.assScriptInfo);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const mergeMode = useSubtitleMergeMode();

  const previewCue = useMemo(() => {
    return (
      cues.find((cue) => cue.id === selectedCueId) ??
      cues.find((cue) => currentTimeMs >= cue.startMs && currentTimeMs <= cue.endMs) ??
      cues[0] ??
      null
    );
  }, [cues, currentTimeMs, selectedCueId]);

  const previewAspectRatio =
    assScriptInfo && assScriptInfo.playResX > 0 && assScriptInfo.playResY > 0
      ? `${assScriptInfo.playResX} / ${assScriptInfo.playResY}`
      : "16 / 9";

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h2 className="text-xl font-semibold">字幕压制</h2>
        <p className="mt-1 text-sm text-text-muted">
          使用 FFmpeg 将字幕硬压或软封到视频
        </p>
      </header>

      {!project ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface-raised">
          <p className="text-text-muted">请先导入或打开项目</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-xl border border-border bg-surface-raised p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">字幕样式预览</h3>
              <span className="text-xs text-text-muted">
                {mergeMode === "inline" ? "行内拼接" : "分离双行"}
              </span>
            </div>

            <div
              className="relative w-full overflow-hidden rounded-lg bg-black"
              style={{ aspectRatio: previewAspectRatio }}
            >
              {previewCue ? (
                <AssSubtitleOverlay
                  cue={previewCue}
                  styles={assStyles}
                  scriptInfo={assScriptInfo}
                  mergeMode={mergeMode}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  暂无字幕可预览
                </div>
              )}
            </div>

            <p className="mt-3 text-xs text-text-muted">
              预览为 CSS 近似效果；最终硬字幕由 FFmpeg/libass 渲染，细节可能略有差异。
            </p>
          </section>

          <aside className="rounded-xl border border-border bg-surface-raised p-4">
            <h3 className="text-sm font-medium">导出设置</h3>
            <p className="mt-3 text-sm text-text-muted">
              压制参数与输出向导将在下一步实现。当前先展示与编辑页共用的 ASS 样式预览。
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
