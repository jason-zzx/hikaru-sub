// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "../src/components/layout/StatusBar";
import { useTaskStore } from "../src/stores/taskStore";

afterEach(() => {
  cleanup();
  useTaskStore.setState(useTaskStore.getInitialState());
  vi.clearAllMocks();
});

describe("StatusBar", () => {
  it("shows idle copy when no task is running", () => {
    render(<StatusBar />);
    expect(screen.getByText("暂无进行中的任务")).toBeTruthy();
  });

  it("does not keep unrelated terminal translation messages visible", () => {
    act(() => {
      useTaskStore.getState().upsertTask({
        id: "translate",
        label: "AI 翻译",
        status: "success",
        progress: 100,
        message: "翻译完成：成功 2 条，失败 0 条",
      });
    });

    render(<StatusBar />);
    expect(screen.getByText("暂无进行中的任务")).toBeTruthy();
    expect(screen.queryByText("翻译完成：成功 2 条，失败 0 条")).toBeNull();
  });

  it("does not treat other idle translation messages as cancellation", () => {
    act(() => {
      useTaskStore.getState().upsertTask({
        id: "translate",
        label: "AI 翻译",
        status: "idle",
        progress: 100,
        message: "已保存当前结果：成功 1 条，失败 1 条",
      });
    });

    render(<StatusBar />);
    expect(screen.getByText("暂无进行中的任务")).toBeTruthy();
  });

  it("keeps page-switch cancellation visible", () => {
    act(() => {
      useTaskStore.getState().upsertTask({
        id: "translate",
        label: "AI 翻译",
        status: "idle",
        progress: 25,
        message: "翻译已取消，不会在后台继续运行",
      });
    });

    render(<StatusBar />);
    expect(screen.getByText("翻译已取消，不会在后台继续运行")).toBeTruthy();
  });
});
