import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

export function SettingsSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function SettingsField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function ModeOptionButton({
  active,
  onClick,
  label,
  desc,
  disabled,
  className,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  desc: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "h-auto flex-col items-start gap-1 rounded-lg px-4 py-3 text-left whitespace-normal transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground ring-2 ring-ring/30 hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20"
          : "border-border bg-card hover:border-primary/50 hover:bg-muted",
        className,
      )}
    >
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <span className="block text-xs font-normal text-muted-foreground">
        {desc}
      </span>
    </Button>
  );
}
