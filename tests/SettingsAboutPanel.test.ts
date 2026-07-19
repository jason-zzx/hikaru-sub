import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const aboutSource = readFileSync(
  fileURLToPath(
    new URL("../src/components/workflow/SettingsAboutPanel.tsx", import.meta.url),
  ),
  "utf8",
);
const aboutConstants = readFileSync(
  fileURLToPath(new URL("../src/constants/about.ts", import.meta.url)),
  "utf8",
);

describe("SettingsAboutPanel", () => {
  it("shows brand, version check, github, and license links", () => {
    expect(aboutSource).toContain("BrandMark");
    expect(aboutSource).toContain("APP_DISPLAY_NAME");
    expect(aboutSource).toContain("APP_SHORT_DESCRIPTION");
    expect(aboutSource).toContain("检查更新");
    expect(aboutSource).toContain("fetchLatestGithubRelease");
    expect(aboutSource).toContain("compareSemver");
    expect(aboutSource).toContain("APP_GITHUB_URL");
    expect(aboutSource).toContain("APP_GITHUB_LICENSE_URL");
    expect(aboutSource).toContain("APP_LICENSE_LABEL");
    expect(aboutSource).toContain("openUrl");
    expect(aboutSource).not.toContain("打开发布页");
  });

  it("points license and repo links at the public GitHub repository", () => {
    expect(aboutConstants).toContain("jason-zzx");
    expect(aboutConstants).toContain("hikaru-sub");
    expect(aboutConstants).toContain("/blob/main/LICENSE");
    expect(aboutConstants).not.toContain("api.github.com");
    expect(aboutConstants).not.toContain("APP_GITHUB_LATEST_RELEASE_URL");
    expect(aboutConstants).toContain("Apache License 2.0");
  });
});
