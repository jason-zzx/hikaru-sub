import type { ReactNode } from "react";
import type {
  RuntimeDependencyItem,
  RuntimeDependencyKind,
  RuntimeDependencyProbe,
  RuntimeDependencySnapshot,
  RuntimeDependencySourceMode,
  RuntimeDependencyStorage,
  RuntimeDependencyStorageItem,
} from "../../types";
import { Button } from "../ui/button";
import { Select } from "../ui/select-adapter";
import {
  RUNTIME_DEPENDENCY_LABEL,
  RUNTIME_SOURCE_MODE_LABEL,
  formatDependencyBytes,
  formatDependencyPath,
} from "../../constants/runtimeDependencies";

const STATUS_LABEL: Record<string, string> = {
  available: "就绪",
  missing: "未安装",
  needsSetup: "需配置",
};

// 行布局：标题/状态与操作按钮同一行，路径、提示、进度等详细信息整行下移。
function RowShell({
  title,
  status,
  actions,
  children,
}: {
  title: string;
  status: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-text">{title}</span>
          <span className="text-xs text-text-muted">{status}</span>
        </div>
        {actions != null && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// CPU/CUDA 运行依赖在 UI 上按设备合并展示，不再暴露具体后端路线。
const GROUP_KINDS = {
  cpu: ["nativeAsrCpu", "crispasrCpu"],
  cuda: ["nativeAsrCuda", "crispasrCuda"],
} as const satisfies Record<string, RuntimeDependencyKind[]>;

type RuntimeGroup = keyof typeof GROUP_KINDS;

type Row<T> = { key: string; group?: RuntimeGroup; items: T[] };

function groupRows<T extends { kind: RuntimeDependencyKind }>(items: T[]): Row<T>[] {
  const rows: Row<T>[] = [];
  for (const item of items) {
    const group = (Object.keys(GROUP_KINDS) as RuntimeGroup[]).find((key) =>
      (GROUP_KINDS[key] as readonly RuntimeDependencyKind[]).includes(item.kind),
    );
    if (!group) {
      rows.push({ key: item.kind, items: [item] });
      continue;
    }
    const existing = rows.find((row) => row.group === group);
    if (existing) existing.items.push(item);
    else rows.push({ key: `${group}Runtime`, group, items: [item] });
  }
  return rows;
}

function combinedStatus(items: { status: string }[]): string {
  if (items.every((item) => item.status === "available")) return "available";
  if (items.some((item) => item.status === "needsSetup")) return "needsSetup";
  return "missing";
}

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

  const downloadButtonText = (
    snapshot: RuntimeDependencySnapshot | undefined,
  ) => {
    if (isActivePreparation(snapshot)) {
      const progress = preparationProgress(snapshot);
      return progress === null ? "下载中…" : `下载中 ${progress}%`;
    }
    return "下载";
  };

  // 每个条目一组 path/version 行；单行条目直接传 [item]。
  const metaLines = (
    items: { kind: string; path?: string | null; version?: string | null }[],
  ) =>
    (["path", "version"] as const).map((field) =>
      items.map((item) => {
        const value = item[field];
        if (!value) return null;
        const display = field === "path" ? formatDependencyPath(value) : value;
        return (
          <p
            key={`${field}-${item.kind}`}
            className={`mt-1 truncate text-xs text-text-muted${
              field === "path" ? " font-mono" : ""
            }`}
            title={display}
          >
            {display}
          </p>
        );
      }),
    );

  const renderPreparation = (kind: RuntimeDependencyKind) => {
    const preparation = preparations[kind];
    if (!preparation) return null;
    const progress = preparationProgress(preparation);
    const isPreparing = isActivePreparation(preparation);
    return (
      <div key={kind} className="mt-2 rounded-md border border-border bg-surface-raised px-3 py-2">
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
    );
  };

  const renderSingleItem = (item: RuntimeDependencyItem) => {
    const needsAction = item.status !== "available";
    const canDownload = needsAction && item.kind === "ffmpeg";
    const canConfigure = needsAction && item.kind === "asrModels";
    const preparation = preparations[item.kind];
    const isPreparing = isActivePreparation(preparation);

    return (
      <RowShell
        key={item.kind}
        title={RUNTIME_DEPENDENCY_LABEL[item.kind]}
        status={STATUS_LABEL[item.status] ?? item.status}
        actions={
          <>
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
          </>
        }
      >
        {metaLines([item])}
        {item.reason && (
          <p className="mt-1 text-xs text-warning">{item.reason}</p>
        )}
        {renderPreparation(item.kind)}
      </RowShell>
    );
  };

  const renderCpuGroup = (items: RuntimeDependencyItem[]) => {
    const available = items.every((item) => item.status === "available");
    return (
      <RowShell
        key="cpuRuntime"
        title="CPU 运行依赖"
        status={STATUS_LABEL[combinedStatus(items)]}
      >
        {metaLines(items)}
        <p
          className={`mt-1 text-xs ${
            available ? "text-text-muted" : "text-danger"
          }`}
        >
          {available
            ? "随应用内置，无需单独下载"
            : "内置 CPU 运行依赖缺失或损坏，请重新安装应用"}
        </p>
      </RowShell>
    );
  };

  const renderCudaGroup = (items: RuntimeDependencyItem[]) => {
    const downloadable = items.filter(
      (item) => item.status !== "available" && item.expectedDownloadBytes != null,
    );
    // 合并行只保留一个下载按钮，一次触发全部缺失的 CUDA 依赖包。
    const anyPreparing = downloadable.some((item) =>
      isActivePreparation(preparations[item.kind]),
    );
    const cudaButtonText = () => {
      if (anyPreparing) return "下载中…";
      const totalBytes = downloadable.reduce(
        (sum, item) => sum + (item.expectedDownloadBytes ?? 0),
        0,
      );
      return totalBytes > 0 ? `下载（${formatDependencyBytes(totalBytes)}）` : "下载";
    };
    return (
      <RowShell
        key="cudaRuntime"
        title="CUDA 运行依赖"
        status={STATUS_LABEL[combinedStatus(items)]}
        actions={
          onPrepareDependency && downloadable.length > 0 ? (
            <Button
              type="button"
              onClick={() =>
                downloadable.forEach((item) => onPrepareDependency(item.kind))
              }
              disabled={anyPreparing}
              className="px-3 py-2 text-sm"
            >
              {cudaButtonText()}
            </Button>
          ) : null
        }
      >
        {metaLines(items)}
        {items.map(
          (item) =>
            item.reason &&
            (item.kind !== "nativeAsrCuda" || item.status === "available") && (
              <p key={`reason-${item.kind}`} className="mt-1 text-xs text-warning">
                {item.reason}
              </p>
            ),
        )}
        <p className="mt-1 text-xs text-text-muted">
          可选受管运行时，不进入安装包；仅使用 NVIDIA 设备 0，模型是否能载入取决于显存。
        </p>
        {items.map((item) => renderPreparation(item.kind))}
      </RowShell>
    );
  };

  const renderStorageItem = (item: RuntimeDependencyStorageItem) => (
    <RowShell
      key={item.kind}
      title={RUNTIME_DEPENDENCY_LABEL[item.kind]}
      status={formatDependencyBytes(item.sizeBytes)}
      actions={
        item.managed && (item.sizeBytes > 0 || item.kind === "legacyPython") ? (
          <Button
            type="button"
            variant="destructive"
            disabled={cleanupDisabled}
            onClick={() => onCleanup(item.kind)}
          >
            清理
          </Button>
        ) : null
      }
    >
      {metaLines([item])}
      {item.kind === "legacyPython" && (
        <p className="mt-1 text-xs text-text-muted">
          旧版遗留，当前转录已不再需要；清理不影响模型和当前运行依赖。
        </p>
      )}
    </RowShell>
  );

  const renderCudaStorageGroup = (items: RuntimeDependencyStorageItem[]) => {
    const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    const cleanable = items.filter((item) => item.managed && item.sizeBytes > 0);
    return (
      <RowShell
        key="cudaRuntime"
        title="CUDA 运行依赖"
        status={formatDependencyBytes(totalBytes)}
        actions={
          cleanable.length > 0
            ? cleanable.map((item) => (
                <Button
                  key={item.kind}
                  type="button"
                  variant="destructive"
                  title={item.path ? formatDependencyPath(item.path) : undefined}
                  disabled={cleanupDisabled}
                  onClick={() => onCleanup(item.kind)}
                >
                  清理
                </Button>
              ))
            : null
        }
      >
        {metaLines(items)}
      </RowShell>
    );
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
          {groupRows(probe?.items ?? []).map((row) =>
            row.group === "cpu"
              ? renderCpuGroup(row.items)
              : row.group === "cuda"
                ? renderCudaGroup(row.items)
                : renderSingleItem(row.items[0]),
          )}
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
            {groupRows(storage.items).map((row) =>
              row.group === "cuda"
                ? renderCudaStorageGroup(row.items)
                : renderStorageItem(row.items[0]),
            )}
          </div>
        )}
      </div>
    </section>
  );
}
