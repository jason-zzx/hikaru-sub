import { useEffect, useMemo, useRef, useState } from "react";
import type { AssStyle } from "@hikaru/ass-core";
import { ColorPicker } from "./ColorPicker";
import { Button } from "../ui/button";

type ColorTarget = "primaryColor" | "outlineColor" | "backColor";

interface InlineOverridePanelProps {
  currentStyle: AssStyle | undefined;
  effectiveAlignment?: number;
  onApplyColor: (kind: ColorTarget, color: string) => void;
  onApplyNumber: (kind: "outline" | "shadow", value: number) => void;
  onApplyAlignment: (alignment: number) => void;
}

const SECTIONS: Array<{ kind: ColorTarget; label: string }> = [
  { kind: "primaryColor", label: "文字" },
  { kind: "outlineColor", label: "描边" },
  { kind: "backColor", label: "阴影" },
];

export const ALIGNMENT_VALUES = [7, 8, 9, 4, 5, 6, 1, 2, 3] as const;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePanelNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(clampNumber(parsed, 0, 100) * 10) / 10;
}

function styleColor(style: AssStyle | undefined, target: ColorTarget): string {
  if (!style) {
    if (target === "backColor") return "&H80000000";
    return target === "outlineColor" ? "&H00000000" : "&H00FFFFFF";
  }
  return style[target];
}

function draftForNumber(value: number | undefined, fallback: number): string {
  return String(value ?? fallback);
}

export function InlineOverridePanel({
  currentStyle,
  effectiveAlignment,
  onApplyColor,
  onApplyNumber,
  onApplyAlignment,
}: InlineOverridePanelProps) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<ColorTarget>("primaryColor");
  const [outlineDraft, setOutlineDraft] = useState(() =>
    draftForNumber(currentStyle?.outline, 2),
  );
  const [shadowDraft, setShadowDraft] = useState(() =>
    draftForNumber(currentStyle?.shadow, 1),
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) return;
    setOutlineDraft(draftForNumber(currentStyle?.outline, 2));
    setShadowDraft(draftForNumber(currentStyle?.shadow, 1));
  }, [currentStyle?.outline, currentStyle?.shadow, open]);

  useEffect(() => {
    if (!open) return;

    let closeTimer: number | null = null;
    const closeAfterNestedHandlers = () => {
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        setOpen(false);
      }, 0);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        // Let nested ColorPicker deferChange handlers flush pending color before unmount.
        closeAfterNestedHandlers();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAfterNestedHandlers();
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const currentColor = useMemo(
    () => styleColor(currentStyle, section),
    [section, currentStyle],
  );

  const commitNumber = (kind: "outline" | "shadow", draft: string) => {
    const normalized = normalizePanelNumber(draft);
    if (normalized === null) {
      if (kind === "outline") setOutlineDraft(draftForNumber(currentStyle?.outline, 2));
      else setShadowDraft(draftForNumber(currentStyle?.shadow, 1));
      return;
    }
    if (kind === "outline") setOutlineDraft(String(normalized));
    else setShadowDraft(String(normalized));
    onApplyNumber(kind, normalized);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        className="h-9 px-3"
        title="更多 ASS 行内标签"
      >
        更多标签
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded border border-border bg-surface-raised p-3 shadow-xl">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-1">
              {SECTIONS.map((s) => (
                <button
                  key={s.kind}
                  type="button"
                  onClick={() => setSection(s.kind)}
                  className={`rounded border px-2 py-1 text-xs ${
                    section === s.kind
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text hover:bg-surface-overlay"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <ColorPicker
              value={currentColor}
              onChange={(color) => onApplyColor(section, color)}
              deferChange
            />

            {section === "primaryColor" && (
              <div>
                <div className="mb-2 text-xs text-text-muted">对齐</div>
                <div className="grid w-28 grid-cols-3 gap-1">
                  {ALIGNMENT_VALUES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onApplyAlignment(value)}
                      className={`h-8 rounded border text-xs ${
                        effectiveAlignment === value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-text hover:bg-surface-overlay"
                      }`}
                      title={`插入 an${value}`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {section === "outlineColor" && (
              <label className="flex items-center gap-2">
                <span className="text-xs text-text-muted">描边粗细</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={outlineDraft}
                  onChange={(event) => setOutlineDraft(event.target.value)}
                  onBlur={() => commitNumber("outline", outlineDraft)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-8 w-20 rounded border border-input bg-card px-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </label>
            )}

            {section === "backColor" && (
              <label className="flex items-center gap-2">
                <span className="text-xs text-text-muted">阴影距离</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={shadowDraft}
                  onChange={(event) => setShadowDraft(event.target.value)}
                  onBlur={() => commitNumber("shadow", shadowDraft)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-8 w-20 rounded border border-input bg-card px-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
