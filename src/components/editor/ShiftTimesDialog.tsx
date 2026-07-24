import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { framesToMilliseconds, type CueTimeShiftTarget } from "../../services/editorActions";
import {
  applyTimeInputKey,
  normalizeTimeInputValue,
  parseTimeInput,
  snapTimeInputCaret,
  TIME_INPUT_TEMPLATE,
} from "../../utils/timeInput";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";

type ShiftUnit = "time" | "frames";
type ShiftDirection = "later" | "earlier";

interface ShiftTimesDialogProps {
  open: boolean;
  selectedCount: number;
  fps: number | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (deltaMs: number, target: CueTimeShiftTarget) => void;
}

export function ShiftTimesDialog({
  open,
  selectedCount,
  fps,
  onOpenChange,
  onConfirm,
}: ShiftTimesDialogProps) {
  const timeInputRef = useRef<HTMLInputElement>(null);
  const [unit, setUnit] = useState<ShiftUnit>("time");
  const [direction, setDirection] = useState<ShiftDirection>("later");
  const [target, setTarget] = useState<CueTimeShiftTarget>("both");
  const [timeText, setTimeText] = useState(TIME_INPUT_TEMPLATE);
  const [frameText, setFrameText] = useState("0");

  useEffect(() => {
    if (!open) return;
    setUnit("time");
    setDirection("later");
    setTarget("both");
    setTimeText(TIME_INPUT_TEMPLATE);
    setFrameText("0");
  }, [open]);

  const parsedTime = parseTimeInput(timeText);
  const frames = /^\d+$/.test(frameText) ? Number(frameText) : Number.NaN;
  const amountMs =
    unit === "time"
      ? parsedTime.ok
        ? parsedTime.valueMs
        : 0
      : Number.isSafeInteger(frames)
        ? framesToMilliseconds(frames, fps)
        : 0;
  const canConfirm =
    selectedCount > 0 && Number.isSafeInteger(amountMs) && amountMs > 0;

  const scheduleTimeCaret = (position: number) => {
    window.requestAnimationFrame(() => {
      timeInputRef.current?.setSelectionRange(position, position);
    });
  };

  const handleTimeChange = (value: string, selectionStart: number | null) => {
    const normalized = normalizeTimeInputValue(value);
    setTimeText(normalized);
    scheduleTimeCaret(snapTimeInputCaret(selectionStart ?? 0, normalized));
  };

  const handleTimeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const result = applyTimeInputKey(
      event.currentTarget.value,
      event.currentTarget.selectionStart ?? 0,
      event.currentTarget.selectionEnd ?? 0,
      event.key,
    );
    if (!result.handled) return;
    event.preventDefault();
    setTimeText(result.value);
    scheduleTimeCaret(result.selectionStart);
  };

  const confirm = () => {
    if (!canConfirm) return;
    onConfirm(direction === "earlier" ? -amountMs : amountMs, target);
  };

  const option = (group: string, value: string, label: string) => (
    <div className="flex items-center gap-2">
      <RadioGroupItem value={value} id={`shift-${group}-${value}`} />
      <Label htmlFor={`shift-${group}-${value}`} className="font-normal">
        {label}
      </Label>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>平移时间轴</DialogTitle>
          <DialogDescription>将调整所选的 {selectedCount} 行字幕</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>单位</Label>
            <RadioGroup
              aria-label="平移单位"
              value={unit}
              onValueChange={(value) => setUnit(value as ShiftUnit)}
              className="flex flex-wrap gap-5"
            >
              {option("unit", "time", "时间")}
              {option("unit", "frames", "帧数")}
            </RadioGroup>
          </div>

          {unit === "time" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="shift-time-value">平移量</Label>
              <Input
                id="shift-time-value"
                ref={timeInputRef}
                value={timeText}
                onChange={(event) =>
                  handleTimeChange(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  )
                }
                onKeyDown={handleTimeKeyDown}
                onBlur={() => setTimeText(normalizeTimeInputValue(timeText))}
                inputMode="numeric"
                className="font-mono"
              />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="shift-frame-value">帧数</Label>
              <Input
                id="shift-frame-value"
                type="number"
                min={0}
                step={1}
                value={frameText}
                onChange={(event) => setFrameText(event.currentTarget.value)}
                inputMode="numeric"
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label>方向</Label>
            <RadioGroup
              aria-label="平移方向"
              value={direction}
              onValueChange={(value) => setDirection(value as ShiftDirection)}
              className="flex flex-wrap gap-5"
            >
              {option("direction", "later", "延后")}
              {option("direction", "earlier", "提前")}
            </RadioGroup>
          </div>

          <div className="grid gap-2">
            <Label>调整范围</Label>
            <RadioGroup
              aria-label="调整范围"
              value={target}
              onValueChange={(value) => setTarget(value as CueTimeShiftTarget)}
              className="grid gap-2 sm:grid-cols-3"
            >
              {option("target", "both", "开始和结束")}
              {option("target", "start", "仅开始")}
              {option("target", "end", "仅结束")}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={!canConfirm} onClick={confirm}>
            确认平移
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
