// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeDependenciesPanel } from "../src/components/workflow/RuntimeDependenciesPanel";

afterEach(() => cleanup());

describe("RuntimeDependenciesPanel", () => {
  it("shows source mode without scanning storage sizes", () => {
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "china",
          items: [
            {
              kind: "ffmpeg",
              status: "available",
              path: "C:/deps/ffmpeg/current",
              source: "managed",
              version: "ffmpeg 7",
              managed: true,
            },
            {
              kind: "python311",
              status: "missing",
              path: null,
              source: null,
              version: null,
              managed: false,
              expectedDownloadBytes: 30 * 1024 * 1024,
            },
          ],
        }}
        storage={null}
        onChangeSourceMode={vi.fn()}
        onMeasureStorage={vi.fn()}
        onCleanup={vi.fn()}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={vi.fn()}
      />,
    );

    expect(screen.getByText("运行时依赖")).toBeTruthy();
    expect(screen.getByText("下载源")).toBeTruthy();
    expect(screen.getAllByText(/中国大陆镜像/).length).toBeGreaterThan(0);
    expect(screen.getByText(/hf-mirror/)).toBeTruthy();
    expect(screen.getByText(/中国大陆出口/)).toBeTruthy();
    expect(screen.getByText("存储空间")).toBeTruthy();
    expect(screen.getByRole("button", { name: "计算占用空间" })).toBeTruthy();
    expect(screen.queryByText(/30.0 MB/)).toBeNull();
    expect(screen.queryByRole("button", { name: /清理/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /重新测速/ })).toBeNull();
    expect(screen.queryByText(/自动推荐/)).toBeNull();
    expect(screen.queryByText(/当前使用/)).toBeNull();
  });

  it("asks the caller to measure storage before cleanup is available", async () => {
    const onMeasureStorage = vi.fn();
    const onCleanup = vi.fn();
    const { rerender } = render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "official",
          items: [
            {
              kind: "downloads",
              status: "available",
              managed: true,
            },
          ],
        }}
        storage={null}
        onChangeSourceMode={vi.fn()}
        onMeasureStorage={onMeasureStorage}
        onCleanup={onCleanup}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "计算占用空间" }));
    expect(onMeasureStorage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /清理/ })).toBeNull();

    rerender(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "official",
          items: [
            {
              kind: "downloads",
              status: "available",
              managed: true,
            },
          ],
        }}
        storage={{
          items: [
            {
              kind: "downloads",
              path: "C:/deps/downloads",
              managed: true,
              sizeBytes: 1024,
            },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onMeasureStorage={onMeasureStorage}
        onCleanup={onCleanup}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={vi.fn()}
      />,
    );

    expect(screen.getByText(/1.00 KB/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /清理/ }));
    expect(onCleanup).toHaveBeenCalledWith("downloads");
  });

  it("offers direct downloads for missing FFmpeg and Python", async () => {
    const onPrepareDependency = vi.fn();
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "china",
          items: [
            {
              kind: "ffmpeg",
              status: "missing",
              managed: false,
            },
            {
              kind: "python311",
              status: "missing",
              managed: false,
            },
          ],
        }}
        storage={null}
        onChangeSourceMode={vi.fn()}
        onMeasureStorage={vi.fn()}
        onCleanup={vi.fn()}
        onPrepareDependency={onPrepareDependency}
        onConfigureAsr={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "下载" });
    expect(buttons).toHaveLength(2);

    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);

    expect(onPrepareDependency).toHaveBeenNthCalledWith(1, "ffmpeg");
    expect(onPrepareDependency).toHaveBeenNthCalledWith(2, "python311");
  });

  it("shows simultaneous download progress per dependency row", () => {
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "china",
          items: [
            {
              kind: "ffmpeg",
              status: "missing",
              managed: false,
            },
            {
              kind: "python311",
              status: "missing",
              managed: false,
            },
          ],
        }}
        storage={null}
        onChangeSourceMode={vi.fn()}
        onMeasureStorage={vi.fn()}
        onCleanup={vi.fn()}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={vi.fn()}
        preparations={{
          ffmpeg: {
            id: "ffmpeg-job",
            kind: "ffmpeg",
            status: "running",
            stage: "下载安装包",
            progress: 0.24,
            downloadedBytes: 24,
            totalBytes: 100,
            logTail: [],
            error: null,
          },
          python311: {
            id: "python-job",
            kind: "python311",
            status: "running",
            stage: "下载安装包",
            progress: 0.67,
            downloadedBytes: 67,
            totalBytes: 100,
            logTail: [],
            error: null,
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "下载中 24%" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载中 67%" })).toBeTruthy();
  });

  it("shows runtime dependency download logs with source details", () => {
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "china",
          items: [
            {
              kind: "ffmpeg",
              status: "missing",
              managed: false,
            },
          ],
        }}
        storage={null}
        onChangeSourceMode={vi.fn()}
        onMeasureStorage={vi.fn()}
        onCleanup={vi.fn()}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={vi.fn()}
        preparations={{
          ffmpeg: {
            id: "ffmpeg-job",
            kind: "ffmpeg",
            status: "running",
            stage: "下载安装包",
            progress: 0.24,
            downloadedBytes: 24,
            totalBytes: 100,
            logTail: [
              "下载源：中国大陆镜像",
              "下载地址：https://mirror.example/ffmpeg.zip",
            ],
            error: null,
          },
        }}
      />,
    );

    expect(screen.getByText("下载日志")).toBeTruthy();
    expect(screen.getByText(/下载源：中国大陆镜像/)).toBeTruthy();
    expect(screen.getByText(/https:\/\/mirror\.example\/ffmpeg\.zip/)).toBeTruthy();
  });

  it("routes ASR dependency gaps to the ASR setup section", async () => {
    const onConfigureAsr = vi.fn();
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "china",
          items: [
            {
              kind: "asrVenv",
              status: "needsSetup",
              managed: false,
            },
            {
              kind: "asrModels",
              status: "missing",
              managed: false,
            },
          ],
        }}
        storage={null}
        onChangeSourceMode={vi.fn()}
        onMeasureStorage={vi.fn()}
        onCleanup={vi.fn()}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={onConfigureAsr}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: "去配置" });
    expect(buttons).toHaveLength(2);

    await userEvent.click(buttons[0]);

    expect(onConfigureAsr).toHaveBeenCalledTimes(1);
  });

  it("hides cleanup for non-managed storage items", () => {
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "official",
          items: [
            {
              kind: "asrVenv",
              status: "available",
              managed: false,
            },
          ],
        }}
        storage={{
          items: [
            {
              kind: "asrVenv",
              path: "C:/repo/asr-service/.venv",
              managed: false,
              sizeBytes: 50 * 1024 * 1024,
            },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onMeasureStorage={vi.fn()}
        onCleanup={vi.fn()}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={vi.fn()}
      />,
    );

    expect(screen.getByText(/50.0 MB/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /清理/ })).toBeNull();
  });
});
