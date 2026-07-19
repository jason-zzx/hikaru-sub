import { useEffect } from "react";
import {
  EDITOR_HOTKEYS,
  formatHotkeyLabel,
  groupHotkeysByCategory,
  type HotkeyDef,
} from "./hotkeys";
import { Button } from "../ui/button";

interface HotkeyHelpOverlayProps {
  open: boolean;
  onClose: () => void;
  hotkeys?: readonly HotkeyDef[];
}

export function HotkeyHelpOverlay({
  open,
  onClose,
  hotkeys = EDITOR_HOTKEYS,
}: HotkeyHelpOverlayProps) {
  // 浮层打开时 Esc 关闭（编辑框外的 Esc 不在键位表内，此处局部处理）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const groups = groupHotkeysByCategory(hotkeys);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-[560px] overflow-auto rounded-lg border border-border bg-surface-raised p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">键盘快捷键</h3>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="关闭（Esc）"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>
        {[...groups.entries()].map(([category, defs]) => (
          <div key={category} className="mb-4 last:mb-0">
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
              {category}
            </h4>
            <div className="space-y-1">
              {defs.map((def) => (
                <div
                  key={def.id}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="text-text">{def.description}</span>
                  <kbd className="shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-text-muted">
                    {formatHotkeyLabel(def)}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
