import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const modelManagerSource = readFileSync(
  fileURLToPath(
    new URL("../src/components/workflow/ModelManager.tsx", import.meta.url),
  ),
  "utf8",
);
const asrSource = readFileSync(
  fileURLToPath(new URL("../src-tauri/src/asr.rs", import.meta.url)),
  "utf8",
);

describe("ModelManager diagnostics", () => {
  it("keeps model download source and bounded diagnostic path rendering", () => {
    expect(modelManagerSource).toContain("hfEndpoint");
    expect(modelManagerSource).toContain("debugLogPath");
    expect(modelManagerSource).toContain("下载源：");
    expect(modelManagerSource).toContain("诊断日志：");
  });

  it("routes model download and polling through the native model manager", () => {
    expect(asrSource).toMatch(/\bstate\s*\.native_models\s*\.start_download\(/);
    expect(asrSource).toMatch(/\bstate\s*\.native_models\s*\.job_snapshot\(&job_id\)/);
    expect(asrSource).toContain("get_model_download_progress");
  });
});
