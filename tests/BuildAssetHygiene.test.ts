import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootFile = (path: string) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

const readRootFile = (path: string) => readFileSync(rootFile(path), "utf8");

describe("build asset hygiene", () => {
  it("does not bundle the Fontsource Noto Sans SC package", () => {
    const packageJson = JSON.parse(readRootFile("package.json"));
    const mainText = readRootFile("src/main.tsx");

    expect(packageJson.dependencies["@fontsource/noto-sans-sc"]).toBeUndefined();
    expect(mainText).not.toContain("@fontsource/noto-sans-sc");
  });

  it("does not dynamically import the shared Tauri service module", () => {
    const workflowFiles = [
      "src/components/workflow/ImportView.tsx",
      "src/components/workflow/TranscribeView.tsx",
      "src/components/workflow/TranslateView.tsx",
    ];

    for (const file of workflowFiles) {
      expect(readRootFile(file)).not.toMatch(
        /import\(["']\.\.\/\.\.\/services\/tauri["']\)/,
      );
    }
  });

  it("marks the missing jASSUB default font fallback as a runtime-only URL", () => {
    const viteConfigText = readRootFile("vite.config.ts");

    expect(viteConfigText).toContain("viteIgnoreMissingJassubDefaultFont");
    expect(viteConfigText).toContain("default.woff2");
    expect(viteConfigText).toContain("/* @vite-ignore */");
  });
});
