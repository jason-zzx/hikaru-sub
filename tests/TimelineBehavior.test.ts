import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/editor/Timeline.tsx", import.meta.url),
  ),
  "utf8",
);

describe("Timeline fixed waveform lane behavior", () => {
  it("uses separate fixed waveform and scrollable lane canvases", () => {
    expect(source).toContain("fixedCanvasRef");
    expect(source).toContain("laneCanvasRef");
    expect(source).toContain("laneViewportRef");
    expect(source).toContain("assignCueLanes");
  });

  it("keeps lane wheel scrolling vertical unless the user is zooming", () => {
    expect(source).toContain("handleFixedWheel");
    expect(source).toContain("handleLaneWheel");
    expect(source).toContain("e.ctrlKey || e.metaKey");
    expect(source).toContain("laneViewport.scrollTop += e.deltaY");
    expect(source).toContain("e.stopPropagation()");
    expect(source).toContain("overscroll-contain");
    expect(source).toContain("波形区滚轮平移");
    expect(source).toContain("Shift+滚轮波形增益");
  });

  it("prevents native page zoom and touch gestures while editing the timeline", () => {
    expect(source).toContain("handleContainerWheel");
    expect(source).toContain("container.addEventListener(\"wheel\"");
    expect(source).toContain("passive: false");
    expect(source).toContain("touch-none");
    expect(source).toContain("e.preventDefault()");
  });
});
