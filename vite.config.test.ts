import { describe, expect, it } from "vitest";
import configFactory from "./vite.config";

describe("vite config", () => {
  it("builds jASSUB workers as ES modules", async () => {
    const config = await configFactory({
      command: "build",
      mode: "production",
      isSsrBuild: false,
      isPreview: false,
    });

    expect(config.worker?.format).toBe("es");
  });
});
