import { describe, expect, it } from "vitest";
import { createDefaultStyles, findAssStyleByName } from "./defaults";

describe("findAssStyleByName", () => {
  it("matches style names case-insensitively and falls back to first style", () => {
    const styles = createDefaultStyles();
    expect(findAssStyleByName(styles, "secondary")?.name).toBe("Secondary");
    expect(findAssStyleByName(styles, "missing")?.name).toBe("Primary");
    expect(findAssStyleByName(styles)?.name).toBe("Primary");
    expect(findAssStyleByName([], "Primary")).toBeNull();
  });
});
