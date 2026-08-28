// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AsrModelStatus } from "../../types";
import { ModelManager } from "./ModelManager";

vi.mock("../../services/tauri", () => ({ checkAsrModel: vi.fn(), downloadAsrModel: vi.fn(), getModelDownloadProgress: vi.fn() }));
const makeStatus = (disposition: AsrModelStatus["disposition"], reason: string | null = null): AsrModelStatus => ({
  engine: "faster-whisper",
  model: "large-v3",
  disposition,
  reason,
  available: disposition === "ready" || disposition === "supportedMissing",
  downloaded: disposition === "ready",
});
const refreshStatus = vi.fn(async () => ({ kind: "ok" as const, status: makeStatus("ready") }));
afterEach(cleanup);

describe("ModelManager Native dispositions", () => {
  it("offers download only for supported-missing", () => {
    const { rerender } = render(<ModelManager engine="faster-whisper" model="large-v3" status={makeStatus("ready")} checking={false} checkError={null} refreshStatus={refreshStatus} />);
    expect(screen.getByText("模型已就绪")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "下载模型" })).toBeNull();
    rerender(<ModelManager engine="faster-whisper" model="large-v3" status={makeStatus("supportedMissing")} checking={false} checkError={null} refreshStatus={refreshStatus} />);
    expect(screen.getByText("模型未下载")).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载模型" })).toBeTruthy();
  });

  it("renders deferred, unsupported, and failed checks without Python setup copy", () => {
    const { rerender } = render(<ModelManager engine="faster-whisper" model="large-v3-turbo" status={makeStatus("postMvpUnavailable", "后续版本支持") } checking={false} checkError={null} refreshStatus={refreshStatus} />);
    expect(screen.getByText(/后续版本支持/)).toBeTruthy();
    rerender(<ModelManager engine="unknown" model="unknown" status={makeStatus("unsupported", "不支持该模型") } checking={false} checkError={null} refreshStatus={refreshStatus} />);
    expect(screen.getByText(/当前版本不支持/)).toBeTruthy();
    rerender(<ModelManager engine="faster-whisper" model="large-v3" status={null} checking={false} checkError="synthetic failure" refreshStatus={refreshStatus} />);
    expect(screen.getByText("检测失败")).toBeTruthy();
    expect(screen.queryByText(/Python|sidecar|配置当前引擎依赖/)).toBeNull();
  });
});
