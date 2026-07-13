import type {
  RuntimeDependencyKind,
  RuntimeDependencyProbe,
  RuntimeDependencySnapshot,
  RuntimeDependencySourceMode,
  RuntimeDependencyStorage,
} from "../../types";
import { Button } from "../ui/button";
import { Select } from "../ui/select-adapter";
import {
  RUNTIME_DEPENDENCY_LABEL,
  RUNTIME_SOURCE_MODE_LABEL,
  formatDependencyBytes,
} from "../../constants/runtimeDependencies";

const STATUS_LABEL: Record<string, string> = {
  available: "就绪",
  missing: "未安装",
  needsSetup: "需配置",
};

interface RuntimeDependenciesPanelProps {
  probe: RuntimeDependencyProbe | null;
  storage: RuntimeDependencyStorage | null;
  storageLoading?: boolean;
  onChangeSourceMode: (mode: RuntimeDependencySourceMode) => void;
  onMeasureStorage: () => void;
  onCleanup: (kind: RuntimeDependencyKind) => void;
  onPrepareDependency?: (kind: RuntimeDependencyKind) => void;
  onConfigureAsr?: () => void;
  preparations?: Partial<Record<RuntimeDependencyKind, RuntimeDependencySnapshot>>;
  cleanupDisabled?: boolean;
}

export function RuntimeDependenciesPanel({
  probe,
  storage,
  storageLoading = false,
  onChangeSourceMode,
  onMeasureStorage,
  onCleanup,
  onPrepareDependency,
  onConfigureAsr,
  preparations = {},
  cleanupDisabled = false,
}: RuntimeDependenciesPanelProps) {
  const sourceMode = probe?.sourceMode ?? "official";

  const preparationProgress = (snapshot?: RuntimeDependencySnapshot) => {
    if (!snapshot || snapshot.progress === null || snapshot.progress === undefined) {
      return null;
    }
    return Math.round(snapshot.progress * 100);
  };

  const isActivePreparation = (snapshot?: RuntimeDependencySnapshot) =>
    snapshot?.status === "pending" || snapshot?.status === "running";

  const downloadButtonText = (snapshot?: RuntimeDependencySnapshot) => {
    if (!isActivePreparation(snapshot)) return "下载";
    const progress = preparationProgress(snapshot);
    return progress === null ? "下载中…" : `下载中 ${progress}%`;
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-text">运行时依赖</h3>
        <p className="mt-0.5 text-xs text-text-muted">
          下载源与受管依赖状态；磁盘占用需手动计算
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface px-4 py-4">
        <div className="flex h-8 flex-nowrap items-center justify-between gap-3">
          <p className="text-sm font-medium leading-none text-text">下载源</p>
          <Select
            className="h-8 w-40 shrink-0"
            value={sourceMode}
            onChange={(value) =>
              onChangeSourceMode(value as RuntimeDependencySourceMode)
            }
            options={Object.entries(RUNTIME_SOURCE_MODE_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </div>
        {sourceMode === "china" && (
          <p className="mt-1 text-xs leading-relaxed text-warning">
            ASR 模型使用 hf-mirror；它会按出口 IP 分流。模型下载失败时，请切换官方源或确保模型下载流量全程使用中国大陆出口。
          </p>
        )}

        <div className="mt-4 divide-y divide-border">
          {(probe?.items ?? []).map((item) => {
            const needsAction = item.status !== "available";
            const canDownload =
              needsAction && (item.kind === "ffmpeg" || item.kind === "python311");
            const canConfigure =
              needsAction && (item.kind === "asrVenv" || item.kind === "asrModels");
            const preparation = preparations[item.kind];
            const progress = preparationProgress(preparation);
            const isPreparing = isActivePreparation(preparation);

            return (
              <div
                key={item.kind}
                className="grid gap-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">
                      {RUNTIME_DEPENDENCY_LABEL[item.kind]}
                    </span>
                    <span className="text-xs text-text-muted">
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </div>
                  {item.path && (
                    <p
                      className="mt-1 truncate font-mono text-xs text-text-muted"
                      title={item.path}
                    >
                      {item.path}
                    </p>
                  )}
                  {item.version && (
                    <p className="mt-1 truncate text-xs text-text-muted" title={item.version}>
                      {item.version}
                    </p>
                  )}
                  {preparation && (
                    <div className="mt-2 rounded-md border border-border bg-surface-raised px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <span>{preparation.stage}</span>
                        {progress !== null && <span>{progress}%</span>}
                        {preparation.status === "completed" && (
                          <span className="text-success">已完成</span>
                        )}
                        {preparation.status === "failed" && (
                          <span className="text-danger">失败</span>
                        )}
                        {preparation.status === "cancelled" && (
                          <span className="text-warning">已取消</span>
                        )}
                      </div>
                      {isPreparing && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-overlay">
                          <div
                            className={`h-full rounded-full bg-accent transition-[width] duration-300 ${
                              progress === null ? "w-1/3 animate-pulse" : ""
                            }`}
                            style={progress === null ? undefined : { width: `${progress}%` }}
                          />
                        </div>
                      )}
                      {preparation.error && (
                        <p className="mt-2 text-xs text-danger">{preparation.error}</p>
                      )}
                      {preparation.logTail.length > 0 && (
                        <details open className="mt-2">
                          <summary className="cursor-pointer select-none text-xs font-medium text-text">
                            下载日志
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-text-muted">
                            {preparation.logTail.join("\n")}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-2 md:justify-end">
                  {canDownload && onPrepareDependency && (
                    <Button
                      type="button"
                      onClick={() => onPrepareDependency(item.kind)}
                      disabled={isPreparing}
                      className="px-3 py-2 text-sm"
                    >
                      {downloadButtonText(preparation)}
                    </Button>
                  )}
                  {canConfigure && onConfigureAsr && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onConfigureAsr}
                      className="px-3 py-2 text-sm"
                    >
                      去配置
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!probe && <p className="py-3 text-sm text-text-muted">检测运行时依赖中…</p>}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface px-4 py-4">
        <div className="flex h-8 flex-nowrap items-center justify-between gap-3">
          <p className="text-sm font-medium leading-none text-text">存储空间</p>
          <Button
            type="button"
            variant="outline"
            onClick={onMeasureStorage}
            disabled={storageLoading}
            className="h-8 px-3 text-sm"
          >
            {storageLoading ? "计算中…" : "计算占用空间"}
          </Button>
        </div>

        {storage && (
          <div className="mt-4 divide-y divide-border">
            {storage.items.map((item) => (
              <div
                key={item.kind}
                className="grid gap-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">
                      {RUNTIME_DEPENDENCY_LABEL[item.kind]}
                    </span>
                    <span className="text-xs text-text-muted">
                      {formatDependencyBytes(item.sizeBytes)}
                    </span>
                  </div>
                  {item.path && (
                    <p
                      className="mt-1 truncate font-mono text-xs text-text-muted"
                      title={item.path}
                    >
                      {item.path}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-2 md:justify-end">
                  {item.managed && item.sizeBytes > 0 && (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={cleanupDisabled}
                      onClick={() => onCleanup(item.kind)}
                    >
                      清理
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
