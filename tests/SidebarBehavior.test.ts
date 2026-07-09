import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../src/components/layout/Sidebar.tsx", import.meta.url)),
  "utf8",
);

describe("Sidebar 导航焦点", () => {
  it("点击导航项后失焦，避免随后按 Shift 触发 focus-visible 高亮", () => {
    expect(source).toContain("event.currentTarget.blur()");
    expect(source).toMatch(
      /onClick=\{\(event\) => \{[\s\S]*?setStep\(item\.step\);[\s\S]*?event\.currentTarget\.blur\(\);/,
    );
  });
});
