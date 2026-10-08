import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
    "utf8",
  ),
);
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);
const nsisHookText = readFileSync(
  fileURLToPath(new URL("../src-tauri/windows/nsis-hooks.nsh", import.meta.url)),
  "utf8",
);

describe("Windows bundle configuration", () => {
  it("uses Hikaru Sub for the user-facing product name", () => {
    expect(config.productName).toBe("Hikaru Sub");
    expect(config.app.windows[0].title).toBe("Hikaru Sub");
  });

  it("reads the application version from the root package metadata", () => {
    expect(config.version).toBe("../package.json");
  });

  it("only builds the NSIS installer while MSI remains disabled", () => {
    expect(config.bundle.targets).toEqual(["nsis"]);
  });

  it("defaults the current-user installer to a writable hikaru-sub path", () => {
    expect(config.bundle.windows.nsis.installerHooks).toBe(
      "windows/nsis-hooks.nsh",
    );
    expect(nsisHookText).toContain("$LOCALAPPDATA\\Programs\\hikaru-sub");
    expect(nsisHookText).toContain("$INSTDIR\\deps");
  });

  it("runs bounded legacy cleanup only after installing the new binary", () => {
    const hook = nsisHookText.match(/!macro NSIS_HOOK_POSTINSTALL\s([\s\S]*?)!macroend/)?.[1];
    expect(hook).toContain(
      'ExecWait \'"$INSTDIR\\${MAINBINARYNAME}.exe" --cleanup-legacy-python\' $0',
    );
    expect(hook).toContain("${If} ${Errors}");
    expect(hook).toContain("${OrIf} $0 != 0");
    expect(hook).toContain("设置中重试");
    expect(hook).not.toMatch(/RMDir|Delete |Abort|Quit|REBOOTOK/);
    const entry = readFileSync(
      fileURLToPath(new URL("../src-tauri/src/lib.rs", import.meta.url)),
      "utf8",
    );
    expect(entry.indexOf('"--cleanup-legacy-python"')).toBeLessThan(
      entry.indexOf("app_paths::bootstrap_portable_paths()"),
    );
    expect(entry).toContain("dependencies::cleanup_installed_legacy_python(&exe)");
  });

  it("does not bundle FFmpeg binaries in release packages", () => {
    expect(JSON.stringify(config.bundle.resources)).not.toContain("binaries/*");
    expect(packageJson.scripts["release:local"]).toBe(
      "pnpm asr:prepare-resource && tauri build && pnpm release:portable",
    );
  });
});
