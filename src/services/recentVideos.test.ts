import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoSession } from "../types";
import {
  listRecentVideos,
  recordRecentVideo,
  removeRecentVideo,
} from "./recentVideos";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function session(videoPath: string): VideoSession {
  return {
    videoPath,
    workspacePath: "/cache/workspace/x",
    audioPath: "/cache/workspace/x/audio.wav",
    transcribedAssPath: `${videoPath}.transcribed.ass`,
    translatedAssPath: `${videoPath}.translated.ass`,
    burnAssPath: "/cache/workspace/x/burn.input.ass",
    sourceLang: "ja",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("recentVideos", () => {
  it("returns empty list when storage is missing or corrupt", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(listRecentVideos()).toEqual([]);

    localStorage.setItem("hikaru-sub:recent-videos", "not-json");
    expect(listRecentVideos()).toEqual([]);

    localStorage.setItem("hikaru-sub:recent-videos", JSON.stringify({ a: 1 }));
    expect(listRecentVideos()).toEqual([]);

    localStorage.setItem(
      "hikaru-sub:recent-videos",
      JSON.stringify([{ videoPath: "/v.mp4" }, null, 42]),
    );
    expect(listRecentVideos()).toEqual([]);
  });

  it("records MRU-first and dedupes by videoPath", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    recordRecentVideo(session("/a.mp4"), 1000);
    recordRecentVideo(session("/b.mp4"), 2000);
    recordRecentVideo(session("/a.mp4"), 3000);

    const list = listRecentVideos();
    expect(list.map((e) => e.videoPath)).toEqual(["/a.mp4", "/b.mp4"]);
    expect(list[0].lastOpenedAt).toBe(3000);
    expect(list[0].transcribedAssPath).toBe("/a.mp4.transcribed.ass");
  });

  it("caps the list at 10 entries", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    for (let i = 0; i < 12; i += 1) {
      recordRecentVideo(session(`/v${i}.mp4`), i);
    }
    const list = listRecentVideos();
    expect(list).toHaveLength(10);
    expect(list[0].videoPath).toBe("/v11.mp4");
    expect(list[list.length - 1].videoPath).toBe("/v2.mp4");
  });

  it("removes a single entry", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    recordRecentVideo(session("/a.mp4"));
    recordRecentVideo(session("/b.mp4"));
    removeRecentVideo("/a.mp4");
    expect(listRecentVideos().map((e) => e.videoPath)).toEqual(["/b.mp4"]);
    removeRecentVideo("/missing.mp4");
    expect(listRecentVideos()).toHaveLength(1);
  });
});
