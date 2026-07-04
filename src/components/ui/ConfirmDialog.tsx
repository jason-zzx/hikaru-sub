import { useEffect } from "react";

export interface ConfirmDialogOption {
  label: string;
  value: string;
  variant?: "default" | "primary" | "danger";
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  options: ConfirmDialogOption[];
  onSelect: (value: string) => void;
  /** Esc 视为取消，传入对应 value；省略则 Esc 仅关闭不回调 */
  escValue?: string;
}

const VARIANT_CLASS: Record<NonNullable<ConfirmDialogOption["variant"]>, string> = {
  default:
    "border-border bg-surface text-text hover:bg-surface-overlay",
  primary:
    "border-accent bg-accent text-white hover:bg-accent/90",
  danger:
    "border-danger/70 bg-danger/10 text-danger hover:bg-danger/20",
};

/**
 * 通用确认对话框：居中模态，支持多选项按钮。
 * 点击遮罩或按 Esc 关闭；由调用方决定如何处理每个选项的 value。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  options,
  onSelect,
  escValue,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSelect(escValue ?? "__close__");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, escValue, onSelect]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onSelect(escValue ?? "__close__");
        }
      }}
    >
      <div className="w-[440px] max-w-[calc(100vw-32px)] rounded-lg border border-border bg-surface-raised p-5 shadow-xl">
        <h3 className="mb-2 text-sm font-semibold text-text">{title}</h3>
        <p className="mb-4 text-sm text-text-muted">{description}</p>
        <div className="flex justify-end gap-2">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`rounded border px-3 py-1.5 text-sm ${
                VARIANT_CLASS[option.variant ?? "default"]
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
