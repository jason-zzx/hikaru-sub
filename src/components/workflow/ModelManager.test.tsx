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

  it.each([
    ["qwen3-asr", "Qwen/Qwen3-ASR-1.7B"],
    ["parakeet", "nvidia/parakeet-tdt_ctc-0.6b-ja"],
    ["reazonspeech-nemo", "reazon-research/reazonspeech-nemo-v2"],
  ])("uses the existing compound download/readiness UI for %s", (engine, model) => {
    const props = {
      engine, model,
      checking: false, checkError: null, refreshStatus,
    };
    const missing: AsrModelStatus = {
      ...makeStatus("supportedMissing"), engine: props.engine, model: props.model,
      backend: "crispasr", revision: "pair-two-frozen-sources",
    };
    const { rerender } = render(<ModelManager {...props} status={missing} />);
    expect(screen.getByRole("button", { name: "下载模型" })).toBeTruthy();
    rerender(<ModelManager {...props} status={{ ...missing, disposition: "ready", downloaded: true }} />);
    expect(screen.queryByRole("button", { name: "下载模型" })).toBeNull();
    expect(screen.getByText("模型已就绪")).toBeTruthy();
    expect(screen.queryByText(/VAD|量化|Python/)).toBeNull();
  });

  it("renders deferred, unsupported, and failed checks without Python setup copy", () => {
    const deferred = {
      ...makeStatus("postMvpUnavailable", "后续版本支持"),
      engine: "future-native-engine",
      model: "future/model",
    };
    const { rerender } = render(<ModelManager engine={deferred.engine} model={deferred.model} status={deferred} checking={false} checkError={null} refreshStatus={refreshStatus} />);
    expect(screen.getByText(/后续版本支持/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "下载模型" })).toBeNull();
    rerender(<ModelManager engine="unknown" model="unknown" status={makeStatus("unsupported", "不支持该模型") } checking={false} checkError={null} refreshStatus={refreshStatus} />);
    expect(screen.getByText(/当前版本不支持/)).toBeTruthy();
    rerender(<ModelManager engine="faster-whisper" model="large-v3" status={null} checking={false} checkError="synthetic failure" refreshStatus={refreshStatus} />);
    expect(screen.getByText("检测失败")).toBeTruthy();
    expect(screen.queryByText(/Python|sidecar|配置当前引擎依赖/)).toBeNull();
  });
});
