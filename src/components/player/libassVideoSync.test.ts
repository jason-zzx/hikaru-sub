import { describe, expect, it, vi } from "vitest";
import type { LibassController } from "../../services/libassPreview";
import { startLibassVideoFrameSync } from "./libassVideoSync";

function controller(): LibassController {
  return {
    setAssText: vi.fn(),
    render: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("startLibassVideoFrameSync", () => {
  it("renders libass at the media time from requestVideoFrameCallback", () => {
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      frameCallbacks.push(callback);
      return 42;
    });
    const cancelVideoFrameCallback = vi.fn();
    const video = {
      currentTime: 0,
      requestVideoFrameCallback,
      cancelVideoFrameCallback,
      ownerDocument: { defaultView: null },
    } as unknown as HTMLVideoElement;
    const target = controller();

    const stop = startLibassVideoFrameSync(
      video,
      target,
      () => ({ width: 640, height: 360 }),
      (item, timeMs, width, height) => {
        void item.render(timeMs, width, height);
      },
    );

    expect(frameCallbacks[0]).toBeDefined();
    frameCallbacks[0](0, { mediaTime: 1.234 } as VideoFrameCallbackMetadata);

    expect(target.render).toHaveBeenCalledWith(1234, 640, 360);
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(2);

    stop();

    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(42);
  });
});
