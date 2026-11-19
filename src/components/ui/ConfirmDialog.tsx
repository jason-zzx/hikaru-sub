import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

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

const BUTTON_VARIANT: Record<
  NonNullable<ConfirmDialogOption["variant"]>,
  "default" | "outline" | "destructive"
> = {
  default: "outline",
  primary: "default",
  danger: "destructive",
};

/**
 * 通用确认对话框：基于标准 shadcn Dialog，支持多选项按钮。
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onSelect(escValue ?? "__close__");
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={BUTTON_VARIANT[option.variant ?? "default"]}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
