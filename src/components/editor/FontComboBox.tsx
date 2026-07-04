import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export function findMatchingFontIndex(options: string[], query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return -1;

  const startsWithIndex = options.findIndex((option) =>
    option.toLowerCase().startsWith(normalized),
  );
  if (startsWithIndex >= 0) return startsWithIndex;

  return options.findIndex((option) => option.toLowerCase().includes(normalized));
}

export function FontComboBox({
  value,
  options,
  onCommit,
  placeholder = "字体",
}: {
  value: string;
  options: string[];
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const fontOptions = useMemo(
    () => Array.from(new Set([value, ...options].filter(Boolean))),
    [options, value],
  );

  useEffect(() => {
    if (!open) setDraft(value);
  }, [open, value]);

  const cancel = () => {
    setDraft(value);
    setOpen(false);
  };

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

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        cancel();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, value]);

  const commit = (next: string) => {
    setDraft(next);
    onCommit(next);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
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
    <div ref={rootRef} className="relative">
      <input
        value={draft}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              cancel();
            }
          }, 0);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent/60"
      />
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-surface-raised py-1 shadow-lg">
          {fontOptions.map((fontName, index) => {
            const active = fontName === value;
            const highlighted = index === highlightedIndex;
            return (
              <button
                key={fontName}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(fontName);
                }}
                onClick={() => commit(fontName)}
                className={`w-full px-3 py-2 text-left text-sm ${
                  highlighted
                    ? "bg-accent/20 text-accent"
                    : active
                      ? "text-accent"
                      : "text-text hover:bg-surface-overlay"
                }`}
                style={{ fontFamily: `"${fontName}", sans-serif` }}
              >
                {fontName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
