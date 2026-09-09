import type { RuntimeDependencyKind } from "../../types";
import {
  RUNTIME_DEPENDENCY_LABEL,
  formatDependencyBytes,
} from "../../constants/runtimeDependencies";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

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
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>{RUNTIME_DEPENDENCY_LABEL[kind]}</DialogTitle>
            <DialogDescription className="mt-1">{reason}</DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="text-sm text-text-muted hover:text-text"
          >
            关闭
          </Button>
        </div>

        {sizeBytes <= 0 && !error && (
          <p role="status" className="text-sm text-text-muted">正在检测运行时依赖…</p>
        )}
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
          <div role="progressbar" aria-label="运行时依赖下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent ?? undefined} className="mt-4 h-2 overflow-hidden rounded-full bg-surface-overlay">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progressPercent ?? 35}%` }}
            />
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => { onCancel(); onChangeSource(); }}
            className="text-text-muted hover:border-accent/50 hover:text-text"
          >
            更改下载源
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="text-text-muted hover:border-accent/50 hover:text-text"
          >
            取消
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onConfirm}
            disabled={status === "running" || sizeBytes <= 0}
          >
            下载并继续
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
