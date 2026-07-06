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

  it("does not bundle FFmpeg binaries in release packages", () => {
    expect(JSON.stringify(config.bundle.resources)).not.toContain("binaries/*");
    expect(packageJson.scripts["release:local"]).toBe(
      "pnpm asr:prepare-resource && tauri build",
    );
  });
});
