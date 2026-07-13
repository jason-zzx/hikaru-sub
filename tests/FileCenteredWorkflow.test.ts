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
const storeSource = readFileSync(
  fileURLToPath(new URL("../src/stores/projectStore.ts", import.meta.url)),
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
const transcribeSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/TranscribeView.tsx", import.meta.url)),
  "utf8",
);
const translateSource = readFileSync(
  fileURLToPath(new URL("../src/components/workflow/TranslateView.tsx", import.meta.url)),
  "utf8",
);
const capabilitySource = readFileSync(
  fileURLToPath(new URL("../src-tauri/capabilities/default.json", import.meta.url)),
  "utf8",
);

describe("file-centered session model", () => {
  it("uses VideoSession instead of persisted project metadata", () => {
    expect(typesSource).toContain("interface VideoSession");
    expect(typesSource).toContain("transcribedAssPath: string");
    expect(typesSource).toContain("translatedAssPath: string");
    expect(typesSource).not.toContain("interface " + "Project" + "Meta");
    expect(servicesSource).toContain("prepareVideoSession");
    expect(servicesSource).toContain('"prepare_video_session"');
    expect(servicesSource).not.toContain("create" + "Project");
    expect(servicesSource).not.toContain("open" + "Project");
    expect(storeSource).toContain("activeSubtitlePath");
    expect(storeSource).toContain("activeSubtitleKind");
  });
});

describe("file-centered transcription and translation", () => {
  it("uses strict session subtitle paths", () => {
    expect(transcribeSource).toContain("session.transcribedAssPath");
    expect(transcribeSource).not.toContain("deleteCachedAudio");
    expect(transcribeSource).toContain("markSaved();");
    expect(translateSource).toContain("session.translatedAssPath");
    expect(translateSource).not.toContain("replace(/\\.ass$/i");
  });
});

describe("file-centered editor shell integration", () => {
  it("allows opening visible subtitle files with the opener plugin", () => {
    expect(capabilitySource).toContain('"opener:allow-open-path"');
  });
});

describe("file-centered import and download flow", () => {
  it("prepares video sessions without project directory flows", () => {
    const oldHiddenDir = ".hi" + "karu";
    expect(importSource).toContain("prepareVideoSession");
    expect(importSource).toContain("setSession");
    expect(importSource).toContain("translatedAssPath(session)");
    expect(importSource).toContain("transcribedAssPath(session)");
    expect(importSource).not.toContain("pickDirectory");
    expect(importSource).not.toContain(oldHiddenDir);
    expect(downloadSource).toContain("prepareVideoSession");
    expect(downloadSource).toContain("setSession");
  });

  it("download prepares an empty session without auto-loading subtitles", () => {
    expect(downloadSource).not.toContain("loadAssDocument");
    expect(downloadSource).toContain("完成后可进入导入页继续转录或切片");
  });
});
