import { useEffect } from "react";
import { Button } from "../ui/button";

export type EditorToastVariant = "success" | "error" | "info";

export interface EditorToastMessage {
  id: number;
  variant: EditorToastVariant;
  text: string;
}

interface EditorToastProps {
  message: EditorToastMessage | null;
  onClose: () => void;
}

const VARIANT_CLASS: Record<EditorToastVariant, string> = {
  success: "border-success bg-success text-white",
  error: "border-danger bg-danger text-white",
  info: "border-border bg-surface-raised text-text",
};

export function EditorToast({ message, onClose }: EditorToastProps) {
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(
      onClose,
      message.variant === "error" ? 4000 : 2500,
    );
    return () => window.clearTimeout(timeout);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div
      className={`fixed top-14 left-1/2 z-40 flex -translate-x-1/2 max-w-[360px] items-center gap-3 rounded border px-3 py-2 text-sm shadow-lg ${VARIANT_CLASS[message.variant]}`}
      role={message.variant === "error" ? "alert" : "status"}
    >
      <span className="min-w-0 flex-1 break-words">{message.text}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="shrink-0 px-1.5 text-xs opacity-70 hover:opacity-100"
      >
        关闭
      </Button>
    </div>
  );
}
