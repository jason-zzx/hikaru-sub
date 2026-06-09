import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "../layout/NavIcons";

export interface SelectOption {
  value: string;
  label: string;
}

const triggerClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent/60 flex cursor-pointer items-center justify-between gap-2 pr-3 text-left disabled:cursor-not-allowed disabled:opacity-60";

/**
 * 自定义下拉选择：替代原生 <select>，确保跨平台（含 WebKitGTK）深色样式一致。
 */
export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-surface-raised py-1 shadow-lg">
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    active
                      ? "bg-accent/20 text-accent"
                      : "text-text hover:bg-surface-overlay"
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
