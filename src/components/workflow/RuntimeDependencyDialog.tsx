import type { RuntimeDependencyKind } from "../../types";
import {
  RUNTIME_DEPENDENCY_LABEL,
  formatDependencyBytes,
} from "../../constants/runtimeDependencies";

interface RuntimeDependencyDialogProps {
  open: boolean;
  kind: RuntimeDependencyKind;
  reason: string;
  sizeBytes: number;
  targetPath: string;
  sourceLabel: string;
  status: "idle" | "running" | "completed" | "failed";
  progressPercent?: number | null;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onChangeSource: () => void;
}

export function RuntimeDependencyDialog({
  open,
  kind,
  reason,
  sizeBytes,
  targetPath,
  sourceLabel,
  status,
  progressPercent,
  error,
  onConfirm,
  onCancel,
  onChangeSource,
}: RuntimeDependencyDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <section className="w-full max-w-lg rounded-lg border border-border bg-surface-raised p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-text">
              {RUNTIME_DEPENDENCY_LABEL[kind]}
            </h3>
            <p className="mt-1 text-sm text-text-muted">{reason}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-text-muted hover:text-text"
          >
            关闭
          </button>
        </div>

        <dl className="mt-4 grid gap-2 text-sm">
          <div>
            <dt className="text-text-muted">预计下载</dt>
            <dd className="text-text">{formatDependencyBytes(sizeBytes)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">保存位置</dt>
            <dd className="break-all font-mono text-xs text-text">{targetPath}</dd>
          </div>
          <div>
            <dt className="text-text-muted">下载源</dt>
            <dd className="text-text">{sourceLabel}</dd>
          </div>
        </dl>

        {status === "running" && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-overlay">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progressPercent ?? 35}%` }}
            />
          </div>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onChangeSource}
            className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:border-accent/50 hover:text-text"
          >
            更改下载源
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:border-accent/50 hover:text-text"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={status === "running"}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            下载并继续
          </button>
        </div>
      </section>
    </div>
  );
}
