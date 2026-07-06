import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../src-tauri/src/${path}`, import.meta.url)),
    "utf8",
  );
}

describe("Windows child process behavior", () => {
  it("uses CREATE_NO_WINDOW for app-managed external processes", () => {
    const processSource = readSource("process.rs");
    expect(processSource).toContain("CREATE_NO_WINDOW");
    expect(processSource).toContain("creation_flags");
  });

  it("starts Python and FFmpeg through the hidden command helper", () => {
    expect(readSource("asr.rs")).toContain("hidden_command(python)");
    expect(readSource("ffmpeg.rs")).toContain("hidden_command");
    expect(readSource("asr_setup.rs")).toContain("hidden_command");
  });
});
