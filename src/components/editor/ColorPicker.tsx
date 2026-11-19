import { useCallback, useEffect, useId, useRef, useState } from "react";
import { RgbaColorPicker } from "react-colorful";
import {
  clampByte,
  parseAssColor,
  rgbaToAssColor,
  toHexByte,
  type Rgba,
} from "@/lib/ass";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface ColorPickerProps {
  value: string;
  onChange: (ass: string) => void;
  label?: string;
  deferChange?: boolean;
  disabled?: boolean;
}

const CHECKERBOARD_STYLE = {
  backgroundColor: "#d6d9df",
  backgroundImage:
    "linear-gradient(45deg, #ffffff 25%, transparent 25%), linear-gradient(-45deg, #ffffff 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ffffff 75%), linear-gradient(-45deg, transparent 75%, #ffffff 75%)",
  backgroundSize: "10px 10px",
  backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rgbaCss(color: Rgba) {
  return `rgba(${clampByte(color.r)}, ${clampByte(color.g)}, ${clampByte(color.b)}, ${clamp(color.a, 0, 1)})`;
}

function rgbaToHex(color: Rgba): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}

function parseHex(value: string): Pick<Rgba, "r" | "g" | "b"> | null {
  let hex = value.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function colorToChannelDrafts(color: Rgba) {
  return {
    r: String(clampByte(color.r)),
    g: String(clampByte(color.g)),
    b: String(clampByte(color.b)),
    transparency: String(Math.round((1 - clamp(color.a, 0, 1)) * 100)),
  };
}

function parseBoundedNumber(
  value: string,
  min: number,
  max: number,
): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp(parsed, min, max);
}

export function ColorPicker({
  value,
  onChange,
  label,
  deferChange = false,
  disabled = false,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [rgba, setRgba] = useState<Rgba>(() => parseAssColor(value));
  const [hexDraft, setHexDraft] = useState(() => rgbaToHex(parseAssColor(value)));
  const [channelDrafts, setChannelDrafts] = useState(() =>
    colorToChannelDrafts(parseAssColor(value)),
  );
  const [pendingAss, setPendingAss] = useState<string | null>(null);
  const baseId = useId();
  const observedValueRef = useRef(value);
  const pendingAssRef = useRef<string | null>(null);
  const deferChangeRef = useRef(deferChange);
  const onChangeRef = useRef(onChange);

  deferChangeRef.current = deferChange;
  onChangeRef.current = onChange;

  const syncDrafts = useCallback((color: Rgba) => {
    setHexDraft(rgbaToHex(color));
    setChannelDrafts(colorToChannelDrafts(color));
  }, []);

  const flushPending = useCallback(() => {
    if (deferChangeRef.current && pendingAssRef.current !== null) {
      const pending = pendingAssRef.current;
      pendingAssRef.current = null;
      setPendingAss(null);
      onChangeRef.current(pending);
    }
  }, []);

  useEffect(() => {
    if (value === observedValueRef.current) return;
    observedValueRef.current = value;
    if (open) return;
    const next = parseAssColor(value);
    setRgba(next);
    syncDrafts(next);
    pendingAssRef.current = null;
    setPendingAss(null);
  }, [open, syncDrafts, value]);

  useEffect(() => {
    if (disabled) {
      pendingAssRef.current = null;
      setPendingAss(null);
      setOpen(false);
    }
  }, [disabled]);

  const closePicker = useCallback(() => {
    flushPending();
    setOpen(false);
  }, [flushPending]);

  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  const emitColor = useCallback(
    (next: Rgba) => {
      const normalized = {
        r: clampByte(next.r),
        g: clampByte(next.g),
        b: clampByte(next.b),
        a: clamp(next.a, 0, 1),
      };
      const nextAss = rgbaToAssColor(normalized);

      setRgba(normalized);
      syncDrafts(normalized);
      if (deferChange) {
        pendingAssRef.current = nextAss;
        setPendingAss(nextAss);
        return;
      }
      onChange(nextAss);
    },
    [deferChange, onChange, syncDrafts],
  );

  const handleChange = (next: Rgba) => {
    emitColor(next);
  };

  const handleHexChange = (nextDraft: string) => {
    setHexDraft(nextDraft.toUpperCase());
    const parsed = parseHex(nextDraft);
    if (parsed) {
      emitColor({ ...rgba, ...parsed });
    }
  };

  const handleChannelChange = (
    channel: "r" | "g" | "b" | "transparency",
    nextDraft: string,
  ) => {
    setChannelDrafts((current) => ({ ...current, [channel]: nextDraft }));
    if (channel === "transparency") {
      const parsed = parseBoundedNumber(nextDraft, 0, 100);
      if (parsed !== null) {
        emitColor({ ...rgba, a: 1 - parsed / 100 });
      }
      return;
    }
    const parsed = parseBoundedNumber(nextDraft, 0, 255);
    if (parsed !== null) {
      emitColor({ ...rgba, [channel]: parsed });
    }
  };

  const resetDrafts = () => {
    syncDrafts(rgba);
  };

  const currentAss = pendingAss ?? rgbaToAssColor(rgba);

  return (
    <div className="inline-flex flex-col gap-1">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <Popover
        open={open && !disabled}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          if (!nextOpen) {
            closePicker();
            return;
          }
          setOpen(true);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="relative h-8 w-14 overflow-hidden rounded border border-border shadow-inner transition-colors hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            style={CHECKERBOARD_STYLE}
            title={currentAss}
            aria-label={label ? `选择${label}` : "选择颜色"}
          >
            <span
              aria-hidden
              className="absolute inset-0"
              style={{ backgroundColor: rgbaCss(rgba) }}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 gap-0 p-3">
          <div className="subtitle-color-picker">
            <RgbaColorPicker color={rgba} onChange={handleChange} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["r", "g", "b"] as const).map((channel) => {
              const inputId = `${baseId}-${channel}`;
              return (
                <div key={channel} className="flex flex-col gap-1">
                  <Label
                    htmlFor={inputId}
                    className="text-xs font-normal uppercase text-muted-foreground"
                  >
                    {channel}
                  </Label>
                  <Input
                    id={inputId}
                    type="number"
                    min="0"
                    max="255"
                    value={channelDrafts[channel]}
                    onChange={(event) =>
                      handleChannelChange(channel, event.target.value)
                    }
                    onBlur={resetDrafts}
                    className="h-7 px-2 text-xs"
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-[1fr_92px] gap-2">
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`${baseId}-hex`}
                className="text-xs font-normal text-muted-foreground"
              >
                HEX
              </Label>
              <Input
                id={`${baseId}-hex`}
                value={hexDraft}
                onChange={(event) => handleHexChange(event.target.value)}
                onBlur={resetDrafts}
                className="h-7 px-2 font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`${baseId}-transparency`}
                className="text-xs font-normal text-muted-foreground"
              >
                透明度 %
              </Label>
              <Input
                id={`${baseId}-transparency`}
                type="number"
                min="0"
                max="100"
                value={channelDrafts.transparency}
                onChange={(event) =>
                  handleChannelChange("transparency", event.target.value)
                }
                onBlur={resetDrafts}
                className="h-7 px-2 text-xs"
              />
            </div>
          </div>
          <div className="mt-2 rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
            {currentAss}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
