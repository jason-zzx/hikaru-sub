import { useEffect, useState } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { X } from "lucide-react";
import { BrandMark } from "../brand/BrandMark";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { Button } from "../ui/button";
import { pathExists } from "../../services/tauri";
import { openVideoSession } from "../../services/openVideo";
import {
  listRecentVideos,
  removeRecentVideo,
  type RecentVideoEntry,
} from "../../services/recentVideos";

const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

function parentPath(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0) return "";
  return separator === 0 ? path[0] : path.slice(0, separator);
}

function formatRelativeTime(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString();
}

interface EntryExistence {
  video: boolean;
  transcribed: boolean;
  translated: boolean;
}

export function WelcomeView() {
  const setStep = useUiStore((s) => s.setStep);
  const session = useProjectStore((s) => s.session);
  const activeSubtitleKind = useProjectStore((s) => s.activeSubtitleKind);
  const isDirty = useProjectStore((s) => s.isDirty);

  const [entries, setEntries] = useState<RecentVideoEntry[]>([]);
  const [existence, setExistence] = useState<Record<string, EntryExistence>>({});
  const [sessionPaths, setSessionPaths] = useState({
    transcribed: false,
    translated: false,
  });
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const list = listRecentVideos();
    setEntries(list);
    let cancelled = false;
    void (async () => {
      const map: Record<string, EntryExistence> = {};
      for (const entry of list) {
        const [video, transcribed, translated] = await Promise.all([
          pathExists(entry.videoPath),
          pathExists(entry.transcribedAssPath),
          pathExists(entry.translatedAssPath),
        ]);
        map[entry.videoPath] = { video, transcribed, translated };
      }
      if (!cancelled) setExistence(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setSessionPaths({ transcribed: false, translated: false });
      return;
    }
    setSessionPaths({ transcribed: false, translated: false });
    let cancelled = false;
    void Promise.all([
      pathExists(session.transcribedAssPath),
      pathExists(session.translatedAssPath),
    ]).then(([transcribed, translated]) => {
      if (!cancelled) setSessionPaths({ transcribed, translated });
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const openAndNavigate = async (videoPath: string) => {
    if (opening) return;
    setOpening(true);
    try {
      const result = await openVideoSession(videoPath);
      if (!result.ok) {
        if ("error" in result) {
          await message(result.error, { title: "Hikaru Sub", kind: "error" });
        } else if ("changed" in result) {
          await message("当前字幕已发生变化，已取消打开视频", {
            title: "Hikaru Sub",
            kind: "info",
          });
        }
        return;
      }
      setStep(result.hasSubtitleDocument ? "editor" : "transcribe");
    } finally {
      setOpening(false);
    }
  };

  const handleRemove = (videoPath: string) => {
    removeRecentVideo(videoPath);
    setEntries((prev) => prev.filter((e) => e.videoPath !== videoPath));
  };

  const hasLoadedSubtitleDocument = activeSubtitleKind !== null || isDirty;
  const canEditCurrentSession =
    hasLoadedSubtitleDocument ||
    sessionPaths.transcribed ||
    sessionPaths.translated;
  const recentEntries = entries.filter(
    (e) => e.videoPath !== session?.videoPath,
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-8">
      <div className="flex flex-col items-center text-center">
        <BrandMark className="mb-4 size-16" />
        <h2 className="text-3xl font-bold text-text">Hikaru Sub</h2>
        <p className="mt-2 max-w-md text-text-muted">
          AI 转录 · AI 翻译 · 字幕编辑 · 一键压制
        </p>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          { step: "import" as const, title: "导入视频", desc: "选择视频并准备会话" },
          { step: "transcribe" as const, title: "ASR 转录", desc: "本地模型生成字幕" },
          { step: "translate" as const, title: "AI 翻译", desc: "批量生成双语字幕" },
          { step: "editor" as const, title: "校对编辑", desc: "时间轴与样式调整" },
        ].map((card) => (
          <Button
            key={card.step}
            type="button"
            variant="outline"
            onClick={() => setStep(card.step)}
            className="h-auto flex-col items-start gap-2 whitespace-normal rounded-xl p-5 text-left hover:border-accent/50"
          >
            <h3 className="text-base font-medium text-text">{card.title}</h3>
            <p className="text-sm text-text-muted">{card.desc}</p>
          </Button>
        ))}
      </div>

      {session && (
        <div className="w-full max-w-2xl rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="text-sm font-medium text-text">继续当前工作</h3>
          <p
            className="mt-1 truncate text-sm text-text-muted"
            title={session.videoPath}
          >
            {fileName(session.videoPath)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canEditCurrentSession && (
              <Button
                size="sm"
                variant="outline"
                disabled={opening}
                onClick={() => {
                  if (hasLoadedSubtitleDocument) {
                    setStep("editor");
                  } else if (session) {
                    void openAndNavigate(session.videoPath);
                  }
                }}
              >
                继续编辑
              </Button>
            )}
            {!canEditCurrentSession && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStep("transcribe")}
              >
                开始转录
              </Button>
            )}
            {sessionPaths.transcribed && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStep("translate")}
              >
                继续翻译
              </Button>
            )}
            {sessionPaths.translated && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStep("burn")}
              >
                开始压制
              </Button>
            )}
          </div>
        </div>
      )}

      {recentEntries.length > 0 && (
        <div className="w-full max-w-2xl">
          <h3 className="mb-2 text-sm font-medium text-text">最近打开</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-raised">
            {recentEntries.map((entry) => {
              const state = existence[entry.videoPath];
              return (
                <li
                  key={entry.videoPath}
                  className="group flex items-center hover:bg-surface-overlay"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={opening}
                    onClick={() => void openAndNavigate(entry.videoPath)}
                    className="h-auto min-w-0 flex-1 justify-start rounded-none px-4 py-3 text-left whitespace-normal hover:bg-transparent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">
                        {fileName(entry.videoPath)}
                      </span>
                      <span
                        className="block truncate text-xs text-text-muted"
                        title={entry.videoPath}
                      >
                        {parentPath(entry.videoPath)}
                      </span>
                    </span>
                    {state && !state.video && (
                      <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                        文件不存在
                      </span>
                    )}
                    {state?.transcribed && (
                      <span className="shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-text">
                        已转录
                      </span>
                    )}
                    {state?.translated && (
                      <span className="shrink-0 rounded-md border border-primary bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                        已翻译
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-text-muted">
                      {formatRelativeTime(entry.lastOpenedAt)}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="从最近列表移除"
                    onClick={() => handleRemove(entry.videoPath)}
                    className="mr-2 shrink-0 self-center text-text-muted group-hover:text-text"
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
