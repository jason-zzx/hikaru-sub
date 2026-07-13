// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBar } from "../src/components/layout/StatusBar";

vi.mock("../src/stores/taskStore", () => ({
  useTaskStore: (selector: (state: { tasks: Record<string, never> }) => unknown) =>
    selector({ tasks: {} }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StatusBar", () => {
  it("shows idle copy when no task is running", () => {
    render(<StatusBar />);
    expect(screen.getByText("暂无进行中的任务")).toBeTruthy();
  });
});
