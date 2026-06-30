import type { LibassController } from "../../services/libassPreview";

interface RenderSize {
  width: number;
  height: number;
}

type RenderFrame = (
  controller: LibassController,
  timeMs: number,
  width: number,
  height: number,
) => void;

function mediaTimeToMs(mediaTimeSeconds: number): number {
  return Math.max(0, Math.round(mediaTimeSeconds * 1000));
}

export function startLibassVideoFrameSync(
  videoElement: HTMLVideoElement,
  controller: LibassController,
  getSize: () => RenderSize,
  renderFrame: RenderFrame,
): () => void {
  let stopped = false;
  let videoFrameCallbackId: number | null = null;
  let animationFrameId: number | null = null;

  const renderAt = (mediaTimeSeconds: number) => {
    const { width, height } = getSize();
    if (width <= 0 || height <= 0) return;
    renderFrame(controller, mediaTimeToMs(mediaTimeSeconds), width, height);
  };

  if (typeof videoElement.requestVideoFrameCallback === "function") {
    const schedule = () => {
      videoFrameCallbackId = videoElement.requestVideoFrameCallback(
        (_now, metadata) => {
          if (stopped) return;
          renderAt(metadata.mediaTime);
          schedule();
        },
      );
    };

    schedule();
    return () => {
      stopped = true;
      if (
        videoFrameCallbackId !== null &&
        typeof videoElement.cancelVideoFrameCallback === "function"
      ) {
        videoElement.cancelVideoFrameCallback(videoFrameCallbackId);
      }
    };
  }

  const view = videoElement.ownerDocument.defaultView;
  if (!view?.requestAnimationFrame) return () => {};

  const tick = () => {
    if (stopped) return;
    renderAt(videoElement.currentTime);
    animationFrameId = view.requestAnimationFrame(tick);
  };

  animationFrameId = view.requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (animationFrameId !== null && view.cancelAnimationFrame) {
      view.cancelAnimationFrame(animationFrameId);
    }
  };
}
