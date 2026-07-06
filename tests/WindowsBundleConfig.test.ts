import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
    "utf8",
  ),
);

describe("Windows bundle configuration", () => {
  it("only builds the NSIS installer while MSI remains disabled", () => {
    expect(config.bundle.targets).toEqual(["nsis"]);
  });
});
