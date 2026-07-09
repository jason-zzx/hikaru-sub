import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const typesSource = readFileSync(
  fileURLToPath(new URL("../src/types/index.ts", import.meta.url)),
  "utf8",
);
const servicesSource = readFileSync(
  fileURLToPath(new URL("../src/services/tauri.ts", import.meta.url)),
  "utf8",
);
const importSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/ImportView.tsx", import.meta.url)),
  "utf8",
);
const downloadSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/DownloadView.tsx", import.meta.url)),
  "utf8",
);

describe("video clip API surface", () => {
  it("declares clip types and tauri wrappers", () => {
    expect(typesSource).toContain("export type ClipMode");
    expect(typesSource).toContain("interface ClipSnapshot");
    expect(typesSource).toContain("fellBackToHard");
    expect(servicesSource).toContain("startVideoClip");
    expect(servicesSource).toContain('"start_video_clip"');
    expect(servicesSource).toContain("extractVideoFrame");
    expect(servicesSource).toContain('"extract_video_frame"');
  });
});

describe("download/import stay on import page", () => {
  it("import select video stays on import page", () => {
    const fnStart = importSource.indexOf("const handleSelectVideo");
    const fnBody = importSource.slice(fnStart, importSource.indexOf("const ffmpegMissing"));
    expect(fnBody).toContain("setSession(session)");
    expect(fnBody).not.toContain('setStep("transcribe")');
  });

  it("download next step goes to import", () => {
    expect(downloadSource).toContain('setStep("import")');
    expect(downloadSource).toContain("下一步");
    expect(downloadSource).not.toContain("打开并转录");
  });
});

describe("clip in-progress gate", () => {
  it("gates locked steps while clipping", () => {
    const layout = readFileSync(
      fileURLToPath(new URL("../src/components/layout/AppLayout.tsx", import.meta.url)),
      "utf8",
    );
    const gate = readFileSync(
      fileURLToPath(new URL("../src/components/workflow/ClipInProgressGate.tsx", import.meta.url)),
      "utf8",
    );
    expect(layout).toContain("useClipJobPoller");
    expect(layout).toContain("ClipInProgressGate");
    expect(gate).toContain("切片进行中，请等待完成，或返回导入页停止切片");
    expect(gate).toContain("返回导入");
    expect(gate).toContain("items-center justify-center");
    // 文案可提及停止，但 Gate 本身不提供「停止切片」按钮
    expect(gate).not.toMatch(/>\s*停止切片\s*</);
  });
});

describe("clip dialog", () => {
it("clip dialog defaults to hard cut with hover help", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../src/components/workflow/ClipDialog.tsx", import.meta.url)),
    "utf8",
  );
  expect(src).toContain('"hard"');
  expect(src).toContain("extractVideoFrame");
  expect(src).toContain("软切");
  expect(src).toContain("硬切");
  expect(src).toContain("flex flex-row");
  expect(src).toContain("defaultClipFileName");
  expect(src).toContain("完成后设为当前工作视频");
  expect(src).toContain("useAsWorkingVideo");
});
});

describe("import view clip wiring", () => {
  it("import view wires clip actions and progress", () => {
    expect(importSource).toContain("ClipDialog");
    expect(importSource).toContain("切片");
    expect(importSource).toContain("停止切片");
    expect(importSource).toContain("startVideoClip");
    expect(importSource).toContain("cancelVideoClip");
    expect(importSource).toContain("useAsWorkingVideo");
    expect(importSource).toContain("successMessage");
  });

  it("clip completion is finalized in app-level poller", () => {
    const poller = readFileSync(
      fileURLToPath(new URL("../src/hooks/useClipJobPoller.ts", import.meta.url)),
      "utf8",
    );
    const store = readFileSync(
      fileURLToPath(new URL("../src/stores/clipStore.ts", import.meta.url)),
      "utf8",
    );
    expect(poller).toContain("setSuccessMessage");
    expect(poller).toContain("prepareVideoSession");
    expect(poller).toContain("finishJob");
    expect(poller).toContain("stillCurrent");
    expect(poller).toContain("已保存到输出位置");
    expect(poller).toContain("已设为当前工作视频");
    expect(store).toContain("successMessage");
    expect(store).toContain("completedPath: null");
    // ImportView 只展示，不在卸载后丢失收尾
    expect(importSource).not.toContain("releaseBusy");
    expect(importSource).toContain("clipSuccessMessage");
    expect(importSource).toContain("useAsWorkingVideo");
    expect(importSource).toContain("正在切换工作视频");
  });
});
