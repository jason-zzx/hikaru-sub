import type {
  RuntimeDependencyKind,
  RuntimeDependencyProbe,
  RuntimeDependencySnapshot,
  RuntimeDependencySourceMode,
} from "../../types";
import { Button } from "../ui/button";
import { Select } from "../ui/select-adapter";
import {
  RUNTIME_DEPENDENCY_LABEL,
  RUNTIME_SOURCE_MODE_LABEL,
  formatDependencyBytes,
} from "../../constants/runtimeDependencies";

const SOURCE_LABEL: Record<"official" | "china" | "custom", string> = {
  official: "官方源",
  china: "中国大陆镜像",
  custom: "自定义",
};

const STATUS_LABEL: Record<string, string> = {
  available: "就绪",
  missing: "未安装",
  needsSetup: "需配置",
};

interface RuntimeDependenciesPanelProps {
  probe: RuntimeDependencyProbe | null;
  onChangeSourceMode: (mode: RuntimeDependencySourceMode) => void;
  onProbeSources: () => void;
  onCleanup: (kind: RuntimeDependencyKind) => void;
  onPrepareDependency?: (kind: RuntimeDependencyKind) => void;
  onConfigureAsr?: () => void;
  preparations?: Partial<Record<RuntimeDependencyKind, RuntimeDependencySnapshot>>;
}

export function RuntimeDependenciesPanel({
  probe,
  onChangeSourceMode,
  onProbeSources,
  onCleanup,
  onPrepareDependency,
  onConfigureAsr,
  preparations = {},
}: RuntimeDependenciesPanelProps) {
  const sourceMode = probe?.sourceMode ?? "auto";
  const effectiveSource = probe?.effectiveSource ?? "official";

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
          下载源、受管依赖状态与安装目录 deps 存储
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text">
              {RUNTIME_SOURCE_MODE_LABEL[sourceMode]}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              当前使用：{SOURCE_LABEL[effectiveSource]}
              {probe?.recommendedSource
                ? ` · 自动推荐：${SOURCE_LABEL[probe.recommendedSource]}`
                : ""}
            </p>
            {effectiveSource === "china" && (
              <p className="mt-1 text-xs leading-relaxed text-warning">
                ASR 模型使用 hf-mirror；它会按出口 IP 分流。模型下载失败时，请切换官方源或确保模型下载流量全程使用中国大陆出口。
              </p>
            )}
          </div>
          <div className="flex flex-nowrap items-center gap-2">
            <Select
              className="w-40 shrink-0"
              value={sourceMode}
              onChange={(value) =>
                onChangeSourceMode(value as RuntimeDependencySourceMode)
              }
              options={(["auto", "official", "china", "custom"] as const).map(
                (mode) => ({
                  value: mode,
                  label: RUNTIME_SOURCE_MODE_LABEL[mode],
                }),
              )}
            />
            <Button
              type="button"
              variant="outline"
              onClick={onProbeSources}
              className="shrink-0 px-3 py-2 text-sm"
            >
              重新测速
            </Button>
          </div>
        </div>

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
                  {item.managed && item.sizeBytes > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onCleanup(item.kind)}
                      className="px-3 py-2 text-sm hover:border-danger/50 hover:text-danger"
                    >
                      清理
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!probe && <p className="py-3 text-sm text-text-muted">检测运行时依赖中…</p>}
        </div>
      </div>
    </section>
  );
}
