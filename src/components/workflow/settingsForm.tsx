import type { ReactNode } from "react";

export const settingsInputClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

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
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-text-muted">{desc}</p>}
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
      <span className="text-sm text-text-muted">{label}</span>
      {children}
    </label>
  );
}
