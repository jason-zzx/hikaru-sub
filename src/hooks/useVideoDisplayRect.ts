import { useEffect, useState, type RefObject } from "react";
import {
  computeObjectFitContainRect,
  type DisplayRect,
} from "../utils/videoDisplayRect";

const EMPTY_RECT: DisplayRect = { left: 0, top: 0, width: 0, height: 0 };

interface UseVideoDisplayRectOptions {
  /** 视频元数据未就绪时，用 PlayRes 估算宽高比。 */
  fallbackAspectWidth?: number;
  fallbackAspectHeight?: number;
}

export function useVideoDisplayRect(
  containerRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  options: UseVideoDisplayRectOptions = {},
  /** video src 变化时重新绑定 metadata 监听。 */
  mediaKey = "",
): DisplayRect {
  const [rect, setRect] = useState<DisplayRect>(EMPTY_RECT);

  useEffect(() => {
    if (!enabled) {
      setRect(EMPTY_RECT);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const video = videoRef.current;
      const { width: containerWidth, height: containerHeight } =
        container.getBoundingClientRect();

      const mediaWidth =
        video && video.videoWidth > 0
          ? video.videoWidth
          : (options.fallbackAspectWidth ?? 0);
      const mediaHeight =
        video && video.videoHeight > 0
          ? video.videoHeight
          : (options.fallbackAspectHeight ?? 0);

      setRect(
        computeObjectFitContainRect(
          containerWidth,
          containerHeight,
          mediaWidth,
          mediaHeight,
        ),
      );
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(container);

    const video = videoRef.current;
    video?.addEventListener("loadedmetadata", update);
    video?.addEventListener("loadeddata", update);

    return () => {
      observer.disconnect();
      video?.removeEventListener("loadedmetadata", update);
      video?.removeEventListener("loadeddata", update);
    };
  }, [
    containerRef,
    videoRef,
    enabled,
    mediaKey,
    options.fallbackAspectWidth,
    options.fallbackAspectHeight,
  ]);

  return rect;
}
