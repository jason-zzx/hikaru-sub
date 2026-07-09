import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  checkAsrModel,
  downloadAsrModel,
  getModelDownloadProgress,
} from "../../services/tauri";
import type { AsrModelStatus, ModelDownloadSnapshot } from "../../types";
import {
  ASR_ENGINE_NOT_INSTALLED_HINT,
  ASR_ENGINE_NOT_INSTALLED_LABEL,
  isAsrEngineNotInstalledError,
} from "../../utils/asrSidecarError";
import { Button } from "../ui/button";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function downloadSourceLabel(snapshot: ModelDownloadSnapshot | null): string {
  return snapshot?.hfEndpoint?.trim() || "官方 HuggingFace";
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
  const [downloadDiagnostics, setDownloadDiagnostics] =
    useState<ModelDownloadSnapshot | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const checkRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = checkRequestRef.current + 1;
    checkRequestRef.current = requestId;
    setChecking(true);
    setCheckError(null);
    try {
      const s = await checkAsrModel(engine, model);
      if (checkRequestRef.current === requestId) {
        setStatus(s);
      }
    } catch (e) {
      if (checkRequestRef.current === requestId) {
        setStatus(null);
        setCheckError(String(e));
      }
    } finally {
      if (checkRequestRef.current === requestId) {
        setChecking(false);
      }
    }
  }, [engine, model]);

  // engine/model 变更：清除旧结果，避免显示过期状态
  useEffect(() => {
    checkRequestRef.current += 1;
    setStatus(null);
    setChecking(false);
    setCheckError(null);
    setProgress(null);
    setDownloadDiagnostics(null);
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
    setDownloadDiagnostics(null);
    try {
      const jobId = await downloadAsrModel(engine, model);
      for (;;) {
        await sleep(800);
        const snap = await getModelDownloadProgress(jobId);
        setProgress({ done: snap.downloadedBytes, total: snap.totalBytes });
        setDownloadDiagnostics(snap);
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

  const engineNotInstalled =
    (!!checkError && isAsrEngineNotInstalledError(checkError)) ||
    (!!status && !status.available);

  let statusText: ReactNode;
  if (checking) {
    statusText = <span className="text-text-muted">检测中…</span>;
  } else if (engineNotInstalled) {
    statusText = (
      <span className="text-danger">{ASR_ENGINE_NOT_INSTALLED_LABEL}</span>
    );
  } else if (checkError) {
    statusText = <span className="text-danger">检测失败</span>;
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
            <Button
              type="button"
              variant="ghost"
              onClick={refresh}
              className="text-text-muted hover:text-text"
            >
              重新检测
            </Button>
          )}
          {showDownloadBtn && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDownload}
              className="px-2.5 py-1 text-sm"
            >
              下载模型
            </Button>
          )}
          {downloading && <span className="text-text-muted">下载中…</span>}
        </div>
      </div>

      {engineNotInstalled && (
        <span className="text-xs text-warning">
          {ASR_ENGINE_NOT_INSTALLED_HINT}
        </span>
      )}

      {checkError && !engineNotInstalled && (
        <span className="break-all text-xs text-danger">{checkError}</span>
      )}

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
          {downloadDiagnostics && (
            <div className="flex flex-col gap-0.5 text-text-muted">
              <span className="break-all">
                下载源：{downloadSourceLabel(downloadDiagnostics)}
              </span>
              {downloadDiagnostics.debugLogPath && (
                <span className="break-all">
                  诊断日志：{downloadDiagnostics.debugLogPath}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {downloadError && (
        <span className="text-danger">
          下载失败：{downloadError}
          {downloadDiagnostics?.debugLogPath
            ? `；诊断日志：${downloadDiagnostics.debugLogPath}`
            : ""}
        </span>
      )}
    </div>
  );
}
