import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";

export function findMatchingFontIndex(options: string[], query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return -1;

  const startsWithIndex = options.findIndex((option) =>
    option.toLowerCase().startsWith(normalized),
  );
  if (startsWithIndex >= 0) return startsWithIndex;

  return options.findIndex((option) => option.toLowerCase().includes(normalized));
}

export function fontOptionsWithCurrent(value: string, options: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const option of options) {
    if (!option || seen.has(option)) continue;
    seen.add(option);
    result.push(option);
  }

  if (value && !seen.has(value)) {
    result.push(value);
  }

  return result;
}

export function FontComboBox({
  id,
  value,
  options,
  onCommit,
  placeholder = "字体",
  disabled = false,
}: {
  id?: string;
  value: string;
  options: string[];
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const fontOptions = useMemo(
    () => fontOptionsWithCurrent(value, options),
    [options, value],
  );

  useEffect(() => {
    if (!open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const cancel = useCallback(() => {
    setDraft(value);
    setOpen(false);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const index = findMatchingFontIndex(fontOptions, draft);
    setHighlightedIndex(index);
    if (index >= 0) {
      window.setTimeout(() => {
        optionRefs.current[index]?.scrollIntoView({ block: "nearest" });
      }, 0);
    }
  }, [draft, fontOptions, open]);

  const commit = (next: string) => {
    setDraft(next);
    onCommit(next);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (highlightedIndex >= 0) {
        commit(fontOptions[highlightedIndex]);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) =>
        Math.min(fontOptions.length - 1, Math.max(0, current + 1)),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        Math.max(0, current < 0 ? fontOptions.length - 1 : current - 1),
      );
    }
  };

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) cancel();
      }}
    >
      <PopoverAnchor asChild>
        <Input
          id={id}
          ref={inputRef}
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onBlur={(event) => {
            if (!contentRef.current?.contains(event.relatedTarget as Node | null)) {
              cancel();
            }
          }}
          onChange={(event) => {
            if (disabled) return;
            setDraft(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (inputRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
        className="max-h-56 w-(--radix-popover-trigger-width) min-w-52 gap-0 overflow-y-auto p-1"
      >
        {fontOptions.map((fontName, index) => {
          const active = fontName === value;
          const highlighted = index === highlightedIndex;
          return (
            <Button
              key={fontName}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(fontName)}
              className={`h-8 w-full justify-start px-2.5 text-sm font-normal ${
                highlighted
                  ? "bg-muted text-foreground"
                  : active
                    ? "font-medium text-primary"
                    : "text-foreground"
              }`}
              style={{ fontFamily: `"${fontName}", sans-serif` }}
            >
              {fontName}
            </Button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
