// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeDependenciesPanel } from "../src/components/workflow/RuntimeDependenciesPanel";

afterEach(() => cleanup());

describe("RuntimeDependenciesPanel", () => {
  it("shows source mode and managed storage", () => {
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "auto",
          effectiveSource: "china",
          recommendedSource: "china",
          items: [
            {
              kind: "ffmpeg",
              status: "available",
              path: "C:/deps/ffmpeg/current",
              source: "managed",
              version: "ffmpeg 7",
              managed: true,
              sizeBytes: 30 * 1024 * 1024,
            },
            {
              kind: "python311",
              status: "missing",
              path: null,
              source: null,
              version: null,
              managed: false,
              sizeBytes: 0,
            },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onProbeSources={vi.fn()}
        onCleanup={vi.fn()}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={vi.fn()}
      />,
    );

    expect(screen.getByText("运行时依赖")).toBeTruthy();
    expect(screen.getAllByText(/自动推荐/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/中国大陆镜像/).length).toBeGreaterThan(0);
    expect(screen.getByText(/hf-mirror/)).toBeTruthy();
    expect(screen.getByText(/中国大陆出口/)).toBeTruthy();
    expect(screen.getByText(/30.0 MB/)).toBeTruthy();
  });

  it("asks the caller to clean managed dependency storage", async () => {
    const onCleanup = vi.fn();
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "official",
          effectiveSource: "official",
          items: [
            {
              kind: "downloads",
              status: "available",
              managed: true,
              sizeBytes: 1024,
            },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onProbeSources={vi.fn()}
        onCleanup={onCleanup}
        onPrepareDependency={vi.fn()}
        onConfigureAsr={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /清理/ }));

    expect(onCleanup).toHaveBeenCalledWith("downloads");
  });

  it("offers direct downloads for missing FFmpeg and Python", async () => {
    const onPrepareDependency = vi.fn();
    render(
      <RuntimeDependenciesPanel
        probe={{
          sourceMode: "china",
          effectiveSource: "china",
          items: [
            {
              kind: "ffmpeg",
              status: "missing",
              managed: false,
              sizeBytes: 0,
            },
            {
              kind: "python311",
              status: "missing",
              managed: false,
              sizeBytes: 0,
            },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onProbeSources={vi.fn()}
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
          effectiveSource: "china",
          items: [
            {
              kind: "ffmpeg",
              status: "missing",
              managed: false,
              sizeBytes: 0,
            },
            {
              kind: "python311",
              status: "missing",
              managed: false,
              sizeBytes: 0,
            },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onProbeSources={vi.fn()}
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
          effectiveSource: "china",
          items: [
            {
              kind: "ffmpeg",
              status: "missing",
              managed: false,
              sizeBytes: 0,
            },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onProbeSources={vi.fn()}
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
          effectiveSource: "china",
          items: [
            {
              kind: "asrVenv",
              status: "needsSetup",
              managed: false,
              sizeBytes: 0,
            },
            {
              kind: "asrModels",
              status: "missing",
              managed: false,
              sizeBytes: 0,
            },
          ],
        }}
        onChangeSourceMode={vi.fn()}
        onProbeSources={vi.fn()}
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
});
