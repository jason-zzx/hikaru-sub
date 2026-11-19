import type { RuntimeDependencyKind } from "../../types";
import {
  RUNTIME_DEPENDENCY_LABEL,
  formatDependencyBytes,
} from "../../constants/runtimeDependencies";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Progress } from "../ui/progress";

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
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pr-6">
          <DialogTitle>{RUNTIME_DEPENDENCY_LABEL[kind]}</DialogTitle>
          <DialogDescription>{reason}</DialogDescription>
        </DialogHeader>

        {sizeBytes <= 0 && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            正在检测运行时依赖…
          </p>
        )}
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">预计下载</dt>
            <dd className="text-foreground">{formatDependencyBytes(sizeBytes)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">保存位置</dt>
            <dd className="break-all font-mono text-xs text-foreground">
              {targetPath}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">下载源</dt>
            <dd className="text-foreground">{sourceLabel}</dd>
          </div>
        </dl>

        {status === "running" && (
          <Progress
            value={progressPercent ?? undefined}
            aria-label="运行时依赖下载进度"
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onCancel();
              onChangeSource();
            }}
          >
            更改下载源
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
