import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/layout/AppLayout.tsx", import.meta.url),
  ),
  "utf8",
);

describe("AppLayout sizing guards", () => {
  it("prevents the main content pane from growing past the app viewport", () => {
    expect(source).toContain("flex min-h-0 flex-1");
    expect(source).toContain("min-h-0 min-w-0 flex-1 overflow-hidden");
  });
});
