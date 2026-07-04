import { useCallback, useEffect, useRef, useState } from "react";
import { RgbaColorPicker } from "react-colorful";
import { assToRgba, rgbaToAss, type RGBA } from "../../utils/assColor";

interface ColorPickerProps {
  value: string;
  onChange: (ass: string) => void;
  label?: string;
  deferChange?: boolean;
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

function toByte(value: number): number {
  return clamp(Math.round(value), 0, 255);
}

function toHexByte(value: number): string {
  return toByte(value).toString(16).toUpperCase().padStart(2, "0");
}

function rgbaCss(color: RGBA) {
  return `rgba(${toByte(color.r)}, ${toByte(color.g)}, ${toByte(color.b)}, ${clamp(color.a, 0, 1)})`;
}

function rgbaToHex(color: RGBA): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}

function parseHex(value: string): Pick<RGBA, "r" | "g" | "b"> | null {
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

function colorToChannelDrafts(color: RGBA) {
  return {
    r: String(toByte(color.r)),
    g: String(toByte(color.g)),
    b: String(toByte(color.b)),
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
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [rgba, setRgba] = useState<RGBA>(() => assToRgba(value));
  const [hexDraft, setHexDraft] = useState(() => rgbaToHex(assToRgba(value)));
  const [channelDrafts, setChannelDrafts] = useState(() =>
    colorToChannelDrafts(assToRgba(value)),
  );
  const [pendingAss, setPendingAss] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const observedValueRef = useRef(value);

  const syncDrafts = useCallback((color: RGBA) => {
    setHexDraft(rgbaToHex(color));
    setChannelDrafts(colorToChannelDrafts(color));
  }, []);

  useEffect(() => {
    if (value === observedValueRef.current) return;
    observedValueRef.current = value;
    if (open) return;
    const next = assToRgba(value);
    setRgba(next);
    syncDrafts(next);
    setPendingAss(null);
  }, [open, syncDrafts, value]);

  const closePicker = useCallback(() => {
    if (deferChange && pendingAss !== null) {
      onChange(pendingAss);
      setPendingAss(null);
    }
    setOpen(false);
  }, [deferChange, onChange, pendingAss]);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closePicker();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePicker();
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closePicker]);

  const emitColor = useCallback(
    (next: RGBA) => {
      const normalized = {
        r: toByte(next.r),
        g: toByte(next.g),
        b: toByte(next.b),
        a: clamp(next.a, 0, 1),
      };
      const nextAss = rgbaToAss(normalized);

      setRgba(normalized);
      syncDrafts(normalized);
      if (deferChange) {
        setPendingAss(nextAss);
        return;
      }
      onChange(nextAss);
    },
    [deferChange, onChange, syncDrafts],
  );

  const handleChange = (next: RGBA) => {
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

  const currentAss = pendingAss ?? rgbaToAss(rgba);

  return (
    <div ref={containerRef} className="relative inline-flex flex-col gap-1">
      {label && <span className="text-xs text-text-muted">{label}</span>}
      <button
        type="button"
        onClick={() => {
          if (open) {
            closePicker();
            return;
          }
          setOpen(true);
        }}
        className="relative h-8 w-14 overflow-hidden rounded border border-border shadow-inner hover:border-accent/60 focus:border-accent/60 focus:outline-none"
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
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-surface-raised p-3 shadow-xl">
          <div className="hikaru-color-picker">
            <RgbaColorPicker color={rgba} onChange={handleChange} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["r", "g", "b"] as const).map((channel) => (
              <label key={channel} className="flex flex-col gap-1">
                <span className="text-xs uppercase text-text-muted">
                  {channel}
                </span>
                <input
                  type="number"
                  min="0"
                  max="255"
                  value={channelDrafts[channel]}
                  onChange={(event) =>
                    handleChannelChange(channel, event.target.value)
                  }
                  onBlur={resetDrafts}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent/60"
                />
              </label>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[1fr_92px] gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">HEX</span>
              <input
                value={hexDraft}
                onChange={(event) => handleHexChange(event.target.value)}
                onBlur={resetDrafts}
                className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-text outline-none focus:border-accent/60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">透明度 %</span>
              <input
                type="number"
                min="0"
                max="100"
                value={channelDrafts.transparency}
                onChange={(event) =>
                  handleChannelChange("transparency", event.target.value)
                }
                onBlur={resetDrafts}
                className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent/60"
              />
            </label>
          </div>
          <div className="mt-2 rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-text-muted">
            {currentAss}
          </div>
        </div>
      )}
    </div>
  );
}
