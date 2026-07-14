import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateReleaseVersion,
  versionFromReleaseTag,
} from "../scripts/release-version.mjs";
import {
  extractReleaseNotes,
  readReleaseNotes,
  writeGitHubOutput,
} from "../scripts/release-notes.mjs";
import {
  checkProjectVersions,
  readProjectVersions,
  setProjectVersion,
} from "../scripts/version.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tempRoots: string[] = [];

function createVersionFixture(version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "hikaru-sub-release-"));
  tempRoots.push(root);
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "hikaru-sub", version }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.toml"),
    `[package]\nname = "hikaru-sub"\nversion = "${version}"\n\n[dependencies]\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "hikaru-sub"\nversion = "${version}"\ndependencies = []\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify({ version: "../package.json" }, null, 2)}\n`,
  );
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release versions", () => {
  it("accepts stable and prerelease SemVer values", () => {
    expect(validateReleaseVersion("0.1.0")).toBe("0.1.0");
    expect(validateReleaseVersion("2.0.0-rc.1")).toBe("2.0.0-rc.1");
    expect(versionFromReleaseTag("v2.0.0-rc.1")).toBe("2.0.0-rc.1");
  });

  it("rejects malformed versions, build metadata, and unprefixed tags", () => {
    expect(() => validateReleaseVersion("01.0.0")).toThrow("invalid version");
    expect(() => validateReleaseVersion("1.0.0+build.1")).toThrow(
      "invalid version",
    );
    expect(() => versionFromReleaseTag("1.0.0")).toThrow(
      "invalid release tag",
    );
  });

  it("sets package and Cargo versions together", () => {
    const root = createVersionFixture();
    const packageJsonPath = join(root, "package.json");
    const originalPackageJson = readFileSync(packageJsonPath, "utf8");

    setProjectVersion("0.2.0-rc.1", root);

    expect(readProjectVersions(root)).toMatchObject({
      packageVersion: "0.2.0-rc.1",
      cargoVersion: "0.2.0-rc.1",
      cargoLockVersion: "0.2.0-rc.1",
      tauriVersionSource: "../package.json",
    });
    expect(
      checkProjectVersions({ root, tag: "v0.2.0-rc.1" }).packageVersion,
    ).toBe("0.2.0-rc.1");
    expect(readFileSync(packageJsonPath, "utf8")).toBe(
      originalPackageJson.replace(
        '"version": "0.1.0"',
        '"version": "0.2.0-rc.1"',
      ),
    );
  });

  it("reports manifest and release-tag drift", () => {
    const root = createVersionFixture();
    const cargoTomlPath = join(root, "src-tauri", "Cargo.toml");
    writeFileSync(
      cargoTomlPath,
      readFileSync(cargoTomlPath, "utf8").replace(
        'version = "0.1.0"',
        'version = "0.1.1"',
      ),
    );

    expect(() => checkProjectVersions({ root, tag: "v0.2.0" })).toThrow(
      /Cargo\.toml=0\.1\.1/,
    );
    expect(() => checkProjectVersions({ root, tag: "v0.2.0" })).toThrow(
      /does not match package\.json version 0\.1\.0/,
    );
  });
});

describe("release notes", () => {
  const changelog = `# 更新日志

## [Unreleased]

- 下一版内容

## [0.2.0] - 2026-07-14

### 新增

- 新功能

### 修复

- 问题修复

## [0.1.0] - 2026-06-01

- 首个版本
`;

  it("extracts only the exact tagged changelog entry", () => {
    expect(extractReleaseNotes(changelog, "v0.2.0")).toBe(
      "### 新增\n\n- 新功能\n\n### 修复\n\n- 问题修复",
    );
  });

  it("rejects missing, duplicate, and empty entries", () => {
    expect(() => extractReleaseNotes(changelog, "v0.3.0")).toThrow(
      "is missing",
    );
    expect(() =>
      extractReleaseNotes(
        `${changelog}\n## [0.2.0] - 2026-07-15\n\n- duplicate\n`,
        "v0.2.0",
      ),
    ).toThrow("duplicate");
    expect(() =>
      extractReleaseNotes(
        "## [0.2.0] - 2026-07-14\n\n## [0.1.0] - 2026-06-01\n\n- old\n",
        "v0.2.0",
      ),
    ).toThrow("has no release notes");
  });

  it("requires the exact heading format and counts malformed duplicates", () => {
    expect(() =>
      extractReleaseNotes(
        "## [0.2.0] - 2026-07-14  \n\n- notes\n",
        "v0.2.0",
      ),
    ).toThrow("must use");
    expect(() =>
      extractReleaseNotes(
        "## [0.2.0] - 2026-07-14\n\n- notes\n\n## [0.2.0] malformed\n",
        "v0.2.0",
      ),
    ).toThrow("duplicate");
  });

  it("writes a multiline GitHub Actions output", () => {
    const root = createVersionFixture();
    const outputPath = join(root, "github-output.txt");

    writeGitHubOutput("body", "line one\nline two", outputPath);

    const output = readFileSync(outputPath, "utf8");
    expect(output).toMatch(/^body<<HIKARU_SUB_[a-f0-9]+\n/);
    expect(output).toContain("\nline one\nline two\nHIKARU_SUB_");
  });
});

describe("project release metadata", () => {
  it("keeps current versions aligned and provides notes for the current tag", () => {
    const versions = checkProjectVersions({ root: projectRoot });
    const tag = `v${versions.packageVersion}`;

    expect(checkProjectVersions({ root: projectRoot, tag })).toEqual(versions);
    expect(readReleaseNotes({ root: projectRoot, tag })).toMatch(/\S/);
  });

  it("wires the extracted notes into the draft release body", () => {
    const workflow = readFileSync(
      join(projectRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );

    expect(workflow).toContain("run: pnpm version:check");
    expect(workflow).toContain(
      "run: node scripts/release-notes.mjs --github-output",
    );
    expect(workflow).toContain(
      "releaseBody: ${{ steps.release_metadata.outputs.body }}",
    );
    expect(workflow).not.toContain("Hikaru Sub desktop client release.");
  });

  it("runs Rust tests in the release profile used by Tauri packaging", () => {
    const workflow = readFileSync(
      join(projectRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "run: cargo test --release --lib --manifest-path src-tauri/Cargo.toml",
    );
  });

  it("typechecks early without bundling the frontend twice", () => {
    const workflow = readFileSync(
      join(projectRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );

    expect(workflow).toContain("run: pnpm exec tsc --noEmit");
    expect(workflow).not.toContain("run: pnpm build");
  });
});
