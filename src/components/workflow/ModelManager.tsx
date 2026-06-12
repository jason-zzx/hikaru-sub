import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  checkAsrModel,
  downloadAsrModel,
  getModelDownloadProgress,
} from "../../services/tauri";
import type { AsrModelStatus } from "../../types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface ModelManagerProps {
  engine: string;
  model: string;
  /** true：挂载即自动检测（设置页）。false：仅由 trigger 驱动（转录页）。 */
  auto?: boolean;
  /** auto=false 时，每次自增触发一次检测。 */
  trigger?: number;
}

/** ASR 模型本地缓存检测 + 一键下载（含进度），设置页/转录页共用。 */
export function ModelManager({
  engine,
  model,
  auto = true,
  trigger = 0,
}: ModelManagerProps) {
  const [status, setStatus] = useState<AsrModelStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const s = await checkAsrModel(engine, model);
      setStatus(s);
    } catch (e) {
      setStatus(null);
      setCheckError(String(e));
    } finally {
      setChecking(false);
    }
  }, [engine, model]);

  // engine/model 变更：清除旧结果，避免显示过期状态
  useEffect(() => {
    setStatus(null);
    setProgress(null);
    setDownloadError(null);
  }, [engine, model]);

  // 自动模式：挂载及 engine/model 变更时自动检测
  useEffect(() => {
    if (auto) void refresh();
  }, [auto, refresh]);

  // 手动模式：由外部 trigger 驱动检测
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!auto && trigger) void refreshRef.current();
  }, [auto, trigger]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    setProgress(null);
    try {
      const jobId = await downloadAsrModel(engine, model);
      for (;;) {
        await sleep(800);
        const snap = await getModelDownloadProgress(jobId);
        setProgress({ done: snap.downloadedBytes, total: snap.totalBytes });
        if (snap.status === "completed") break;
        if (snap.status === "failed") {
          setDownloadError(snap.error ?? "下载失败");
          break;
        }
      }
      await refresh();
    } catch (e) {
      setDownloadError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(progress.done / progress.total, 1)
      : null;

  let statusText: ReactNode;
  if (checking) {
    statusText = <span className="text-text-muted">检测中…</span>;
  } else if (checkError) {
    statusText = <span className="text-danger">检测失败</span>;
  } else if (status && !status.available) {
    statusText = (
      <span className="text-danger">
        引擎不可用（未安装 {engine === "parakeet" ? "NeMo/Parakeet 可选依赖" : engine}）
      </span>
    );
  } else if (status?.downloaded) {
    statusText = <span className="text-success">已下载</span>;
  } else if (status) {
    statusText = <span className="text-text-muted">未下载</span>;
  } else {
    statusText = <span className="text-text-muted">未检测</span>;
  }

  const showDownloadBtn =
    !!status && status.available && !status.downloaded && !downloading;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span>模型状态：{statusText}</span>
        <div className="flex items-center gap-2">
          {!downloading && (
            <button
              type="button"
              onClick={refresh}
              className="text-text-muted hover:text-text"
            >
              重新检测
            </button>
          )}
          {showDownloadBtn && (
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md border border-border px-2.5 py-1 text-text-muted hover:border-accent/50 hover:text-text"
            >
              下载模型
            </button>
          )}
          {downloading && <span className="text-text-muted">下载中…</span>}
        </div>
      </div>

      {downloading && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: percent !== null ? `${percent * 100}%` : "33%" }}
            />
          </div>
          <span className="text-text-muted">
            {progress && progress.total > 0
              ? `${formatMB(progress.done)} / ${formatMB(progress.total)}（${Math.round(
                  (percent ?? 0) * 100,
                )}%）`
              : "准备下载…"}
          </span>
        </div>
      )}

      {downloadError && (
        <span className="text-danger">下载失败：{downloadError}</span>
      )}
    </div>
  );
}
