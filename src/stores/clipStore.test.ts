import { beforeEach, describe, expect, it } from "vitest";
import { useClipStore } from "./clipStore";

describe("clipStore", () => {
  beforeEach(() => {
    useClipStore.getState().clearAfterCancel();
  });

  it("keeps the discarded recovery target until clip finalization", () => {
    useClipStore.getState().startJob("clip-1", {
      useAsWorkingVideo: true,
      discardRecoveryVideoPath: "C:/videos/source.mp4",
    });

    expect(useClipStore.getState().discardRecoveryVideoPath).toBe(
      "C:/videos/source.mp4",
    );

    useClipStore.getState().finishJob();
    expect(useClipStore.getState().discardRecoveryVideoPath).toBeNull();
  });
});
