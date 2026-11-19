import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const MODES = ["light", "dark", "system"] as const;

const MODE_META: Record<
  (typeof MODES)[number],
  { label: string; icon: typeof Sun }
> = {
  light: { label: "浅色", icon: Sun },
  dark: { label: "深色", icon: Moon },
  system: { label: "跟随系统", icon: Monitor },
};

/**
 * 主题切换：与 Sidebar 导航项同款样式，单击在 浅色 → 深色 → 跟随系统 间循环。
 */
export function ModeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();
  const current = theme as (typeof MODES)[number];
  const { label, icon: Icon } = MODE_META[current] ?? MODE_META.dark;

  const cycle = () => {
    const idx = MODES.indexOf(current);
    const next = MODES[(idx + 1) % MODES.length];
    setTheme(next);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={cycle}
      title={label}
      aria-label={label}
      className={cn(
        "h-auto w-full gap-2.5 rounded-md p-2 text-sm font-normal text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2",
        collapsed ? "justify-center" : "justify-start",
      )}
    >
      <span className="flex shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:shrink-0">
        <Icon />
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Button>
  );
}
