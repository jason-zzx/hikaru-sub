// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeDependencyDialog } from "../src/components/workflow/RuntimeDependencyDialog";

afterEach(() => cleanup());

describe("RuntimeDependencyDialog", () => {
  it("shows dependency size path and source", () => {
    render(
      <RuntimeDependencyDialog
        open
        kind="ffmpeg"
        reason="压制视频需要 FFmpeg。"
        sizeBytes={25 * 1024 * 1024}
        targetPath="C:/Users/me/AppData/Local/Programs/hikaru-sub/deps/ffmpeg/current"
        sourceLabel="中国大陆镜像"
        status="idle"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onChangeSource={vi.fn()}
      />,
    );

    expect(screen.getByText("FFmpeg")).toBeTruthy();
    expect(screen.getByText(/压制视频需要 FFmpeg/)).toBeTruthy();
    expect(screen.getByText(/25.0 MB/)).toBeTruthy();
    expect(screen.getByText(/中国大陆镜像/)).toBeTruthy();
  });

  it("calls confirm and change source handlers", async () => {
    const onConfirm = vi.fn();
    const onChangeSource = vi.fn();
    render(
      <RuntimeDependencyDialog
        open
        kind="python311"
        reason="ASR 配置需要 Python 3.11。"
        sizeBytes={40}
        targetPath="C:/deps/python311/current"
        sourceLabel="官方源"
        status="idle"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onChangeSource={onChangeSource}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "下载并继续" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "更改下载源" }));
    expect(onChangeSource).toHaveBeenCalledTimes(1);
  });
});
