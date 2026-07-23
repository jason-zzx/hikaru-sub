import type { VideoSession } from "../types";

const STORAGE_KEY = "hikaru-sub:recent-videos";
const MAX_ENTRIES = 10;

export interface RecentVideoEntry {
  videoPath: string;
  transcribedAssPath: string;
  translatedAssPath: string;
  lastOpenedAt: number; // epoch ms
}

function isValidEntry(value: unknown): value is RecentVideoEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.videoPath === "string" &&
    typeof entry.transcribedAssPath === "string" &&
    typeof entry.translatedAssPath === "string" &&
    typeof entry.lastOpenedAt === "number"
  );
}

export function listRecentVideos(): RecentVideoEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

function writeEntries(entries: RecentVideoEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级为不持久化
  }
}

export function recordRecentVideo(session: VideoSession, now = Date.now()): void {
  const rest = listRecentVideos().filter((e) => e.videoPath !== session.videoPath);
  writeEntries(
    [
      {
        videoPath: session.videoPath,
        transcribedAssPath: session.transcribedAssPath,
        translatedAssPath: session.translatedAssPath,
        lastOpenedAt: now,
      },
      ...rest,
    ].slice(0, MAX_ENTRIES),
  );
}

export function removeRecentVideo(videoPath: string): void {
  writeEntries(listRecentVideos().filter((e) => e.videoPath !== videoPath));
}
