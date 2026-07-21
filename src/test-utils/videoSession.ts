import type { VideoSession } from "../types";

export function makeVideoSession(
  stem = "episode",
  overrides: Partial<VideoSession> = {},
): VideoSession {
  const workspacePath = `C:/cache/workspace/${stem}`;
  return {
    videoPath: `C:/videos/${stem}.mp4`,
    workspacePath,
    audioPath: `${workspacePath}/audio.wav`,
    transcribedAssPath: `C:/videos/${stem}.transcribed.ass`,
    translatedAssPath: `C:/videos/${stem}.translated.ass`,
    burnAssPath: `${workspacePath}/burn.input.ass`,
    sourceLang: "ja",
    ...overrides,
  };
}
