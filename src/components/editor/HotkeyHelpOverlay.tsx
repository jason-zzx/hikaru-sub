import {
  EDITOR_HOTKEYS,
  formatHotkeyLabel,
  groupHotkeysByCategory,
  type HotkeyDef,
} from "./hotkeys";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

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
  const groups = groupHotkeysByCategory(hotkeys);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
          <DialogDescription className="sr-only">
            字幕编辑器键盘快捷键列表
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {[...groups.entries()].map(([category, defs]) => (
            <div key={category}>
              <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {category}
              </h4>
              <div className="space-y-1">
                {defs.map((def) => (
                  <div
                    key={def.id}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="text-foreground">{def.description}</span>
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {formatHotkeyLabel(def)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
