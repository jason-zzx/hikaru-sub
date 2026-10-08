import { describe, expect, it } from "vitest";
import configFactory, { testExclude } from "./vite.config";

describe("vite config", () => {
  it("builds jASSUB workers as ES modules", async () => {
    const config = await configFactory({
      command: "build",
      mode: "production",
      isSsrBuild: false,
      isPreview: false,
    });

    expect(config.worker?.format).toBe("es");
    expect(config.test?.exclude).toEqual(testExclude);
    expect(config.test?.exclude).toContain("**/node_modules/**");
    expect(config.test?.exclude).toContain("native-asr/build/**");
  });
});
