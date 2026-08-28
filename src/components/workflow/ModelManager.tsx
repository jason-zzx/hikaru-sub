import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  downloadAsrModel,
  getModelDownloadProgress,
} from "../../services/tauri";
import type { AsrModelStatus, ModelDownloadSnapshot } from "../../types";
import type { AsrModelRefreshOutcome } from "../../hooks/useAsrAvailability";
import { Button } from "../ui/button";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function downloadSourceLabel(snapshot: ModelDownloadSnapshot | null): string {
  return snapshot?.hfEndpoint?.trim() || "官方 HuggingFace";
}

function isDownloadable(status: AsrModelStatus | null): boolean {
  return status?.disposition === "supportedMissing" ||
    (!status?.disposition && !!status?.available && !status.downloaded);
}

function transcribeGate(status: AsrModelStatus): ModelTranscribeGate {
  switch (status.disposition) {
    case "ready":
      return "ready";
    case "supportedMissing":
      return "needs_download";
    case "postMvpUnavailable":
    case "unsupported":
      return "unavailable";
    default:
      if (!status.available) return "unavailable";
      return status.downloaded ? "ready" : "needs_download";
  }
}

export type ModelTranscribeGate =
  | "ready"
  | "needs_download"
  | "unavailable"
  | "check_failed"
  | "aborted";

export type ModelDownloadResult = "completed" | "failed";

export type ModelManagerHandle = {
  /** 重新检测模型状态，区分就绪 / 需下载 / 路线不可用 / 检测失败 / 已取消。 */
  checkForTranscribe: () => Promise<ModelTranscribeGate>;
  /** 与「下载模型」按钮相同；若已有下载在进行则等待同一任务。 */
  startDownload: () => Promise<ModelDownloadResult>;
};

interface ModelManagerProps {
  engine: string;
  model: string;
  status: AsrModelStatus | null;
  checking: boolean;
  checkError: string | null;
  refreshStatus: () => Promise<AsrModelRefreshOutcome>;
  /** 下载开始/结束时通知父组件（手动下载与 imperative 下载共用）。 */
  onDownloadingChange?: (downloading: boolean) => void;
}

/** ASR 模型本地缓存检测 + 一键下载（含进度），设置页/转录页共用。 */
export const ModelManager = forwardRef<ModelManagerHandle, ModelManagerProps>(
  function ModelManager(
    {
      engine,
      model,
      status,
      checking,
      checkError,
      refreshStatus,
      onDownloadingChange,
    },
    ref,
  ) {
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState<{
      done: number;
      total: number;
    } | null>(null);
    const [downloadDiagnostics, setDownloadDiagnostics] =
      useState<ModelDownloadSnapshot | null>(null);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const downloadPromiseRef = useRef<Promise<ModelDownloadResult> | null>(null);
    const onDownloadingChangeRef = useRef(onDownloadingChange);
    onDownloadingChangeRef.current = onDownloadingChange;

    const setDownloadingState = useCallback((next: boolean) => {
      setDownloading(next);
      onDownloadingChangeRef.current?.(next);
    }, []);

    const runDownload = useCallback((): Promise<ModelDownloadResult> => {
      if (downloadPromiseRef.current) return downloadPromiseRef.current;

      const promise = (async (): Promise<ModelDownloadResult> => {
        setDownloadingState(true);
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
            if (snap.status === "completed") {
              await refreshStatus();
              return "completed";
            }
            if (snap.status === "failed") {
              setDownloadError(snap.error ?? "下载失败");
              return "failed";
            }
          }
        } catch (error) {
          setDownloadError(String(error));
          return "failed";
        } finally {
          setDownloadingState(false);
          downloadPromiseRef.current = null;
        }
      })();

      downloadPromiseRef.current = promise;
      return promise;
    }, [engine, model, refreshStatus, setDownloadingState]);

    useImperativeHandle(
      ref,
      () => ({
        checkForTranscribe: async () => {
          const outcome = await refreshStatus();
          if (outcome.kind === "aborted") return "aborted";
          if (outcome.kind === "error") return "check_failed";
          return transcribeGate(outcome.status);
        },
        startDownload: () => runDownload(),
      }),
      [refreshStatus, runDownload],
    );

    const percent =
      progress && progress.total > 0
        ? Math.min(
            progress.done / progress.total,
            downloadDiagnostics?.status === "completed" ? 1 : 0.99,
          )
        : null;

    let statusText: ReactNode;
    if (checking) {
      statusText = <span className="text-text-muted">检测中…</span>;
    } else if (checkError) {
      statusText = <span className="text-danger">检测失败</span>;
    } else if (status?.disposition === "ready" || (!status?.disposition && status?.downloaded)) {
      statusText = <span className="text-success">模型已就绪</span>;
    } else if (status?.disposition === "supportedMissing" || isDownloadable(status)) {
      statusText = <span className="text-text-muted">模型未下载</span>;
    } else if (status?.disposition === "postMvpUnavailable") {
      statusText = (
        <span className="text-warning">
          {status.reason?.trim() || "后续版本支持"}
        </span>
      );
    } else if (status?.disposition === "unsupported") {
      statusText = (
        <span className="text-warning">
          当前版本不支持{status.reason ? `：${status.reason}` : ""}
        </span>
      );
    } else if (status && !status.available) {
      statusText = (
        <span className="text-warning">
          当前路线不可用{status.reason ? `：${status.reason}` : ""}
        </span>
      );
    } else {
      statusText = <span className="text-text-muted">未检测</span>;
    }

    const showDownloadBtn =
      !checking && !checkError && isDownloadable(status) && !downloading;

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>模型状态：{statusText}</span>
          <div className="flex items-center gap-2">
            {!downloading && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void refreshStatus()}
                disabled={checking}
                className="text-text-muted hover:text-text"
              >
                重新检测
              </Button>
            )}
            {showDownloadBtn && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runDownload()}
                className="px-2.5 py-1 text-sm"
              >
                下载模型
              </Button>
            )}
            {downloading && <span className="text-text-muted">下载中…</span>}
          </div>
        </div>

        {checkError && (
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
  },
);
