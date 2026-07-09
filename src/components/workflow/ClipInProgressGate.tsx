import { useUiStore } from "../../stores/uiStore";
import { useClipStore } from "../../stores/clipStore";
import { Button } from "../ui/button";
import type { ReactNode } from "react";
import type { WorkflowStep } from "../../types";

const LOCKED: WorkflowStep[] = ["transcribe", "translate", "editor", "burn"];

export function ClipInProgressGate({
  step,
  children,
}: {
  step: WorkflowStep;
  children: ReactNode;
}) {
  const busy = useClipStore((s) => s.busy);
  const setStep = useUiStore((s) => s.setStep);
  if (busy && LOCKED.includes(step)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-text-muted">
          切片进行中，请等待完成，或返回导入页停止切片
        </p>
        <Button type="button" onClick={() => setStep("import")}>
          返回导入
        </Button>
      </div>
    );
  }
  return children;
}
