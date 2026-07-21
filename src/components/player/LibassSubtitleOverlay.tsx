import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultLibassController,
  type LibassController,
} from "../../services/libassPreview";
import { createFreshLibassCanvas } from "./libassCanvas";
import { getLibassFontKey } from "./subtitlePreviewModel";
import { startLibassVideoFrameSync } from "./libassVideoSync";

interface LibassSubtitleOverlayProps {
  assText: string;
  fontUrls: string[];
  availableFonts?: Record<string, string>;
  defaultFont?: string;
  width: number;
  height: number;
  renderTimeMs: number;
  videoElement?: HTMLVideoElement | null;
  followVideoFrames?: boolean;
  onUnavailable: (reason: string) => void;
}

interface ActiveController {
  controller: LibassController;
  /** 已推送到 worker 的 ASS 文本，用于跳过重复 setTrack */
  appliedAssText: string;
  /** setTrack/render 串行队列：在途时只记 pending，收尾取最新文本，避免击键积压 */
  queue: { running: boolean; pending: boolean };
}

export function LibassSubtitleOverlay({
  assText,
  fontUrls,
  availableFonts,
  defaultFont,
  width,
  height,
  renderTimeMs,
  videoElement,
  followVideoFrames = false,
  onUnavailable,
}: LibassSubtitleOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // controller 与其队列绑定在同一对象上，随 controller 重建一起替换，
  // 避免旧 controller 的滞留队列阻塞新 controller 的文本推送
  const activeRef = useRef<ActiveController | null>(null);
  const [controllerReadyVersion, setControllerReadyVersion] = useState(0);
  const latestFontUrlsRef = useRef(fontUrls);
  const latestPreviewRef = useRef({ assText, width, height, renderTimeMs });
  const fontKey = useMemo(
    () =>
      getLibassFontKey({
        defaultFont,
        fontUrls,
        availableFonts,
      }),
    [availableFonts, defaultFont, fontUrls],
  );

  latestFontUrlsRef.current = fontUrls;
  latestPreviewRef.current = { assText, width, height, renderTimeMs };

  const renderLatest = async (controller: LibassController) => {
    const latest = latestPreviewRef.current;
    if (latest.width <= 0 || latest.height <= 0) return;
    await controller.render(latest.renderTimeMs, latest.width, latest.height);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    const canvas = createFreshLibassCanvas(host);
    const initialAssText = latestPreviewRef.current.assText;
    createDefaultLibassController({
      canvas,
      assText: initialAssText,
      fontUrls: latestFontUrlsRef.current,
      availableFonts,
      defaultFont,
    })
      .then(async (controller) => {
        if (cancelled) {
          await controller.destroy();
          return;
        }

        const active: ActiveController = {
          controller,
          appliedAssText: initialAssText,
          queue: { running: false, pending: false },
        };
        activeRef.current = active;
        setControllerReadyVersion((version) => version + 1);
        const latest = latestPreviewRef.current;
        if (latest.assText !== initialAssText) {
          await controller.setAssText(latest.assText);
          active.appliedAssText = latest.assText;
        }
        await renderLatest(controller);
      })
      .catch((err) => {
        if (!cancelled) onUnavailable(String(err));
      });

    return () => {
      cancelled = true;
      const active = activeRef.current;
      activeRef.current = null;
      setControllerReadyVersion((version) => version + 1);
      if (canvas.parentNode === host) {
        canvas.remove();
      }
      if (active) {
        void active.controller.destroy().catch((err) => {
          console.warn("销毁 libass 预览失败:", err);
        });
      }
    };
  // fontKey 已按内容哈希 availableFonts/defaultFont/fontUrls，避免父级因 cues 变化
  // 重建同内容对象而导致每次击键都销毁并重建 JASSUB 实例（表现为字幕短暂消失）。
  }, [fontKey, onUnavailable]);

  useEffect(() => {
    const active = activeRef.current;
    if (!active) return;

    if (active.queue.running) {
      active.queue.pending = true;
      return;
    }

    // 错误上报只看 active 身份（卸载/重建后 activeRef 已换），不看 effect cleanup：
    // 后续击键会触发上一次 effect 的 cleanup，若用 cancelled 守门，在途循环的
    // 真实 setTrack 失败会被静默吞掉，导致 CSS fallback 失效
    active.queue.running = true;
    (async () => {
      try {
        do {
          active.queue.pending = false;
          const latest = latestPreviewRef.current;
          if (latest.assText !== active.appliedAssText) {
            await active.controller.setAssText(latest.assText);
            active.appliedAssText = latest.assText;
          }
          await renderLatest(active.controller);
        } while (active.queue.pending);
      } catch (err) {
        if (activeRef.current === active) {
          onUnavailable(String(err));
        }
      } finally {
        active.queue.running = false;
      }
    })();
  }, [assText, onUnavailable]);

  useEffect(() => {
    activeRef.current?.controller.render(renderTimeMs, width, height).catch((err) => {
      onUnavailable(String(err));
    });
  }, [height, onUnavailable, renderTimeMs, width]);

  useEffect(() => {
    const controller = activeRef.current?.controller;
    if (!controller || !videoElement || !followVideoFrames) return;

    return startLibassVideoFrameSync(
      videoElement,
      controller,
      () => {
        const latest = latestPreviewRef.current;
        return { width: latest.width, height: latest.height };
      },
      (targetController, timeMs, renderWidth, renderHeight) => {
        targetController.render(timeMs, renderWidth, renderHeight).catch((err) => {
          onUnavailable(String(err));
        });
      },
    );
  }, [controllerReadyVersion, followVideoFrames, onUnavailable, videoElement]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full pointer-events-none"
    />
  );
}
