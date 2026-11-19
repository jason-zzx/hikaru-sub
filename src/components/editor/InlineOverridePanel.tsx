import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AssStyle } from "@/lib/ass";
import { ColorPicker } from "./ColorPicker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

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
  const outlineBaselineRef = useRef(outlineDraft);
  const shadowBaselineRef = useRef(shadowDraft);
  const baseId = useId();

  useEffect(() => {
    if (open) return;
    setOutlineDraft(draftForNumber(currentStyle?.outline, 2));
    setShadowDraft(draftForNumber(currentStyle?.shadow, 1));
  }, [currentStyle?.outline, currentStyle?.shadow, open]);

  const currentColor = useMemo(
    () => styleColor(currentStyle, section),
    [section, currentStyle],
  );

  const commitNumber = (kind: "outline" | "shadow", draft: string) => {
    const baseline =
      kind === "outline"
        ? outlineBaselineRef.current
        : shadowBaselineRef.current;
    const normalized = normalizePanelNumber(draft);
    if (normalized === null) {
      if (kind === "outline") setOutlineDraft(draftForNumber(currentStyle?.outline, 2));
      else setShadowDraft(draftForNumber(currentStyle?.shadow, 1));
      return;
    }
    const next = String(normalized);
    if (kind === "outline") setOutlineDraft(next);
    else setShadowDraft(next);
    // Changed-only: focus/blur without edit adds no cue history.
    if (next === baseline || draft === baseline) {
      if (kind === "outline") outlineBaselineRef.current = next;
      else shadowBaselineRef.current = next;
      return;
    }
    if (kind === "outline") outlineBaselineRef.current = next;
    else shadowBaselineRef.current = next;
    onApplyNumber(kind, normalized);
  };

  const keepOpenForNestedPopover = (event: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) => {
    if (
      (event.target as HTMLElement | null)?.closest(
        '[data-slot="popover-content"]',
      )
    ) {
      event.preventDefault();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          title="更多 ASS 行内标签"
        >
          更多标签
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-3"
        onPointerDownOutside={keepOpenForNestedPopover}
        onFocusOutside={keepOpenForNestedPopover}
        onInteractOutside={keepOpenForNestedPopover}
      >
        <div className="space-y-3">
          <Tabs
            value={section}
            onValueChange={(value) => setSection(value as ColorTarget)}
          >
            <TabsList className="grid w-full grid-cols-3">
              {SECTIONS.map((s) => (
                <TabsTrigger key={s.kind} value={s.kind} className="text-xs">
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <ColorPicker
            value={currentColor}
            onChange={(color) => onApplyColor(section, color)}
            deferChange
          />

          {section === "primaryColor" && (
            <div>
              <div className="mb-2 text-xs text-muted-foreground">对齐</div>
              <div className="grid w-28 grid-cols-3 gap-1">
                {ALIGNMENT_VALUES.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={effectiveAlignment === value ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => onApplyAlignment(value)}
                    className={
                      effectiveAlignment === value
                        ? "h-8 border-primary bg-primary/10 px-0 text-xs text-primary hover:bg-primary/15"
                        : "h-8 px-0 text-xs"
                    }
                    title={`插入 an${value}`}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {section === "outlineColor" && (
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`${baseId}-outline`}
                className="text-xs font-normal text-muted-foreground"
              >
                描边粗细
              </Label>
              <Input
                id={`${baseId}-outline`}
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={outlineDraft}
                onFocus={() => {
                  outlineBaselineRef.current = outlineDraft;
                }}
                onChange={(event) => setOutlineDraft(event.target.value)}
                onBlur={() => commitNumber("outline", outlineDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                className="h-8 w-20"
              />
            </div>
          )}

          {section === "backColor" && (
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`${baseId}-shadow`}
                className="text-xs font-normal text-muted-foreground"
              >
                阴影距离
              </Label>
              <Input
                id={`${baseId}-shadow`}
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={shadowDraft}
                onFocus={() => {
                  shadowBaselineRef.current = shadowDraft;
                }}
                onChange={(event) => setShadowDraft(event.target.value)}
                onBlur={() => commitNumber("shadow", shadowDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                className="h-8 w-20"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
