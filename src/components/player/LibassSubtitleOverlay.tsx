import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultLibassController,
  type LibassController,
} from "../../services/libassPreview";
import { createFreshLibassCanvas } from "./libassCanvas";
import { startLibassVideoFrameSync } from "./libassVideoSync";

interface LibassSubtitleOverlayProps {
  assText: string;
  fontUrls: string[];
  defaultFont?: string;
  width: number;
  height: number;
  renderTimeMs: number;
  videoElement?: HTMLVideoElement | null;
  followVideoFrames?: boolean;
  onUnavailable: (reason: string) => void;
}

export function LibassSubtitleOverlay({
  assText,
  fontUrls,
  defaultFont,
  width,
  height,
  renderTimeMs,
  videoElement,
  followVideoFrames = false,
  onUnavailable,
}: LibassSubtitleOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<LibassController | null>(null);
  const [controllerReadyVersion, setControllerReadyVersion] = useState(0);
  const latestFontUrlsRef = useRef(fontUrls);
  const latestPreviewRef = useRef({ assText, width, height, renderTimeMs });
  const fontKey = useMemo(
    () => `${defaultFont ?? ""}\n${fontUrls.join("\n")}`,
    [defaultFont, fontUrls],
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
      defaultFont,
    })
      .then(async (controller) => {
        if (cancelled) {
          await controller.destroy();
          return;
        }

        controllerRef.current = controller;
        setControllerReadyVersion((version) => version + 1);
        const latest = latestPreviewRef.current;
        if (latest.assText !== initialAssText) {
          await controller.setAssText(latest.assText);
        }
        await renderLatest(controller);
      })
      .catch((err) => {
        if (!cancelled) onUnavailable(String(err));
      });

    return () => {
      cancelled = true;
      const controller = controllerRef.current;
      controllerRef.current = null;
      setControllerReadyVersion((version) => version + 1);
      if (canvas.parentNode === host) {
        canvas.remove();
      }
      if (controller) {
        void controller.destroy().catch((err) => {
          console.warn("销毁 libass 预览失败:", err);
        });
      }
    };
  }, [defaultFont, fontKey, onUnavailable]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    let cancelled = false;
    controller
      .setAssText(assText)
      .then(async () => {
        if (!cancelled) await renderLatest(controller);
      })
      .catch((err) => {
        if (!cancelled) onUnavailable(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [assText, onUnavailable]);

  useEffect(() => {
    controllerRef.current?.render(renderTimeMs, width, height).catch((err) => {
      onUnavailable(String(err));
    });
  }, [height, onUnavailable, renderTimeMs, width]);

  useEffect(() => {
    const controller = controllerRef.current;
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
