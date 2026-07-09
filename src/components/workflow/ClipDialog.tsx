import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { CircleHelp } from "lucide-react";
import type { ClipMode } from "../../types";
import {
  extractVideoFrame,
  getVideoInfo,
  pickDirectory,
} from "../../services/tauri";
import { formatPlaybackTime } from "../../utils/formatTime";
import {
  applyTimeInputKey,
  formatTimeInput,
  normalizeTimeInputValue,
  parseTimeInput,
  snapTimeInputCaret,
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
import { Checkbox } from "../ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

type TimeField = "start" | "end";

type ClipDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoPath: string;
  onStart: (args: {
    startMs: number;
    endMs: number;
    mode: ClipMode;
    saveDir: string | null;
    fileName: string | null;
    useAsWorkingVideo: boolean;
  }) => void;
};

type FramePreviewState = {
  url: string | null;
  error: boolean;
  loading: boolean;
};

const EMPTY_FRAME: FramePreviewState = {
  url: null,
  error: false,
  loading: false,
};

function pathDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(0, idx) : "";
}

function pathStem(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  return name.replace(/\.[^.]+$/, "") || "video";
}

/** 与后端 default_clip_file_name 对齐：HHMMSS（秒级） */
function formatClipTimeToken(ms: number): string {
  const bounded = Math.max(0, Math.floor(ms));
  const totalSecs = Math.floor(bounded / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${h.toString().padStart(2, "0")}${m.toString().padStart(2, "0")}${s.toString().padStart(2, "0")}`;
}

function defaultClipFileName(
  videoPath: string,
  startMs: number,
  endMs: number,
): string {
  return `${pathStem(videoPath)}-${formatClipTimeToken(startMs)}-${formatClipTimeToken(endMs)}.mp4`;
}

/** 片尾精确时刻常抽不到帧，预览时略微前移 */
function previewSeekMs(timeMs: number, durationMs: number): number {
  if (durationMs > 0 && timeMs >= durationMs) {
    return Math.max(0, durationMs - 40);
  }
  return Math.max(0, timeMs);
}

function validateRange(startMs: number, endMs: number): string | null {
  if (!(startMs < endMs)) {
    return "开始时间必须早于结束时间";
  }
  return null;
}

function clampToDuration(ms: number, durationMs: number): number {
  if (durationMs <= 0) return Math.max(0, ms);
  return Math.max(0, Math.min(ms, durationMs));
}

export function ClipDialog({
  open,
  onOpenChange,
  videoPath,
  onStart,
}: ClipDialogProps) {
  const [durationMs, setDurationMs] = useState(0);
  const [durationError, setDurationError] = useState<string | null>(null);
  const [startText, setStartText] = useState(formatTimeInput(0));
  const [endText, setEndText] = useState(formatTimeInput(0));
  const [mode, setMode] = useState<ClipMode>("hard");
  const [saveDir, setSaveDir] = useState("");
  const [fileName, setFileName] = useState("");
  const [useAsWorkingVideo, setUseAsWorkingVideo] = useState(true);
  const [startFrame, setStartFrame] = useState<FramePreviewState>(EMPTY_FRAME);
  const [endFrame, setEndFrame] = useState<FramePreviewState>(EMPTY_FRAME);

  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const startDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startFrameRequestIdRef = useRef(0);
  const endFrameRequestIdRef = useRef(0);
  const lastAutoFileNameRef = useRef("");
  const fileNameTouchedRef = useRef(false);

  const clearDebounceTimers = () => {
    if (startDebounceRef.current) {
      clearTimeout(startDebounceRef.current);
      startDebounceRef.current = null;
    }
    if (endDebounceRef.current) {
      clearTimeout(endDebounceRef.current);
      endDebounceRef.current = null;
    }
  };

  const startParsed = parseTimeInput(startText);
  const endParsed = parseTimeInput(endText);
  const rangeError =
    startParsed.ok && endParsed.ok
      ? validateRange(startParsed.valueMs, endParsed.valueMs)
      : startParsed.ok
        ? endParsed.ok
          ? null
          : endParsed.message
        : startParsed.message;
  const canStart = startParsed.ok && endParsed.ok && !rangeError;

  useEffect(() => {
    if (!open) {
      clearDebounceTimers();
      startFrameRequestIdRef.current += 1;
      endFrameRequestIdRef.current += 1;
      return;
    }

    setMode("hard");
    setUseAsWorkingVideo(true);
    setSaveDir(pathDir(videoPath));
    setStartText(formatTimeInput(0));
    setEndText(formatTimeInput(0));
    const initialName = defaultClipFileName(videoPath, 0, 0);
    lastAutoFileNameRef.current = initialName;
    fileNameTouchedRef.current = false;
    setFileName(initialName);
    setStartFrame(EMPTY_FRAME);
    setEndFrame(EMPTY_FRAME);
    setDurationMs(0);
    setDurationError(null);

    let cancelled = false;
    getVideoInfo(videoPath)
      .then((info) => {
        if (cancelled) return;
        const nextDuration = Math.max(0, Math.floor(info.durationMs));
        setDurationMs(nextDuration);
        const endMs = nextDuration > 0 ? nextDuration : 0;
        setEndText(formatTimeInput(endMs));
        const nextName = defaultClipFileName(videoPath, 0, endMs);
        lastAutoFileNameRef.current = nextName;
        if (!fileNameTouchedRef.current) {
          setFileName(nextName);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDurationError("无法读取视频时长");
      });

    return () => {
      cancelled = true;
    };
  }, [open, videoPath]);

  // 起止时间变化时，若用户未手改文件名，则同步默认名
  useEffect(() => {
    if (!open) return;
    if (!startParsed.ok || !endParsed.ok) return;
    if (fileNameTouchedRef.current) return;
    const nextName = defaultClipFileName(
      videoPath,
      startParsed.valueMs,
      endParsed.valueMs,
    );
    lastAutoFileNameRef.current = nextName;
    setFileName(nextName);
  }, [
    open,
    videoPath,
    startText,
    endText,
    startParsed.ok,
    endParsed.ok,
  ]);

  useEffect(() => {
    if (!open) return;

    const scheduleFrame = (
      text: string,
      timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
      requestIdRef: MutableRefObject<number>,
      setFrame: (state: FramePreviewState) => void,
    ) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const parsed = parseTimeInput(text);
      if (!parsed.ok) {
        setFrame(EMPTY_FRAME);
        return;
      }

      const seekMs = previewSeekMs(
        clampToDuration(parsed.valueMs, durationMs),
        durationMs,
      );

      setFrame({ url: null, error: false, loading: true });
      const requestId = ++requestIdRef.current;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        extractVideoFrame({ videoPath, timeMs: seekMs })
          .then((result) => {
            if (requestIdRef.current !== requestId) return;
            setFrame({
              url: result.imageUrl,
              error: false,
              loading: false,
            });
          })
          .catch(() => {
            if (requestIdRef.current !== requestId) return;
            setFrame({ url: null, error: true, loading: false });
          });
      }, 300);
    };

    scheduleFrame(
      startText,
      startDebounceRef,
      startFrameRequestIdRef,
      setStartFrame,
    );
    scheduleFrame(endText, endDebounceRef, endFrameRequestIdRef, setEndFrame);

    return () => {
      clearDebounceTimers();
    };
  }, [open, videoPath, startText, endText, durationMs]);

  const setTimeValue = (field: TimeField, value: string) => {
    if (field === "start") setStartText(value);
    else setEndText(value);
  };

  const timeInputFor = (field: TimeField) =>
    field === "start" ? startInputRef.current : endInputRef.current;

  const scheduleTimeCaret = (field: TimeField, position: number) => {
    window.requestAnimationFrame(() => {
      const input = timeInputFor(field);
      if (!input) return;
      input.setSelectionRange(position, position);
    });
  };

  const handleTimeChange =
    (field: TimeField) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const caret = snapTimeInputCaret(event.currentTarget.selectionStart ?? 0);
      setTimeValue(field, normalizeTimeInputValue(event.currentTarget.value));
      scheduleTimeCaret(field, caret);
    };

  const handleTimeKeyDown =
    (field: TimeField) => (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }

      const result = applyTimeInputKey(
        event.currentTarget.value,
        event.currentTarget.selectionStart ?? 0,
        event.currentTarget.selectionEnd ?? 0,
        event.key,
      );
      if (!result.handled) return;

      event.preventDefault();
      setTimeValue(field, result.value);
      scheduleTimeCaret(field, result.selectionStart);
    };

  const handleTimeBlur = (field: TimeField) => {
    const raw = field === "start" ? startText : endText;
    const normalized = normalizeTimeInputValue(raw);
    const parsed = parseTimeInput(normalized);
    if (!parsed.ok) {
      setTimeValue(field, normalized);
      return;
    }
    const clamped = clampToDuration(parsed.valueMs, durationMs);
    setTimeValue(field, formatTimeInput(clamped));
  };

  const handlePickSaveDir = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setSaveDir(dir);
    } catch {
      // 选择目录失败不阻断切片
    }
  };

  const handleStart = () => {
    if (!startParsed.ok || !endParsed.ok) return;
    const startMs = clampToDuration(startParsed.valueMs, durationMs);
    const endMs = clampToDuration(endParsed.valueMs, durationMs);
    if (validateRange(startMs, endMs)) return;
    onStart({
      startMs,
      endMs,
      mode,
      saveDir: saveDir.trim() ? saveDir.trim() : null,
      fileName: fileName.trim() ? fileName.trim() : null,
      useAsWorkingVideo,
    });
  };

  const renderFrame = (label: string, frame: FramePreviewState) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
        {frame.url ? (
          <img
            src={frame.url}
            alt={label}
            className="size-full object-contain"
          />
        ) : (
          <span className="px-2 text-center text-xs text-muted-foreground">
            {frame.loading
              ? "预览加载中…"
              : frame.error
                ? "无法预览该时刻"
                : "—"}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>切片</DialogTitle>
          <DialogDescription>
            {durationError
              ? durationError
              : durationMs > 0
                ? `视频总时长 ${formatPlaybackTime(durationMs, false)}`
                : "正在读取视频时长…"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="clip-start">开始时间</Label>
              <Input
                id="clip-start"
                ref={startInputRef}
                value={startText}
                onChange={handleTimeChange("start")}
                onKeyDown={handleTimeKeyDown("start")}
                onBlur={() => handleTimeBlur("start")}
                placeholder="00:00:00.00"
                inputMode="numeric"
                className="font-mono"
                aria-invalid={Boolean(rangeError)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="clip-end">结束时间</Label>
              <Input
                id="clip-end"
                ref={endInputRef}
                value={endText}
                onChange={handleTimeChange("end")}
                onKeyDown={handleTimeKeyDown("end")}
                onBlur={() => handleTimeBlur("end")}
                placeholder="00:00:00.00"
                inputMode="numeric"
                className="font-mono"
                aria-invalid={Boolean(rangeError)}
              />
            </div>
          </div>

          {rangeError && (
            <p className="text-sm text-destructive">{rangeError}</p>
          )}

          <div className="flex gap-3">
            {renderFrame("开始帧", startFrame)}
            {renderFrame("结束帧", endFrame)}
          </div>

          <div className="grid gap-2">
            <Label>切片模式</Label>
            <TooltipProvider>
              <RadioGroup
                value={mode}
                onValueChange={(value) => setMode(value as ClipMode)}
                className="flex flex-row flex-wrap items-center gap-x-6 gap-y-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="soft" id="clip-mode-soft" />
                  <Label htmlFor="clip-mode-soft" className="font-normal">
                    软切
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex text-muted-foreground hover:text-foreground"
                        aria-label="软切说明"
                      >
                        <CircleHelp className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      用附近关键帧截取，通常无损且快，起止可能与输入不完全一致
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="hard" id="clip-mode-hard" />
                  <Label htmlFor="clip-mode-hard" className="font-normal">
                    硬切
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex text-muted-foreground hover:text-foreground"
                        aria-label="硬切说明"
                      >
                        <CircleHelp className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      起止严格按输入，需重编码，较慢
                    </TooltipContent>
                  </Tooltip>
                </div>
              </RadioGroup>
            </TooltipProvider>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="clip-save-dir">保存目录</Label>
            <div className="flex gap-2">
              <Input
                id="clip-save-dir"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                placeholder="源视频同目录"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handlePickSaveDir}
                className="shrink-0"
              >
                选择
              </Button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="clip-file-name">文件名</Label>
            <Input
              id="clip-file-name"
              value={fileName}
              onChange={(e) => {
                fileNameTouchedRef.current = true;
                setFileName(e.target.value);
              }}
              placeholder="原名-开始-结束.mp4"
            />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="clip-use-as-working"
              checked={useAsWorkingVideo}
              onCheckedChange={(checked) =>
                setUseAsWorkingVideo(checked === true)
              }
              className="mt-0.5"
            />
            <Label
              htmlFor="clip-use-as-working"
              className="font-normal leading-snug"
            >
              完成后设为当前工作视频
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" disabled={!canStart} onClick={handleStart}>
            开始切片
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
