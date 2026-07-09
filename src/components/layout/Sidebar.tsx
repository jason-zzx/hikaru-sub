import type { ReactNode } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import type { WorkflowStep } from "../../types";
import {
  IconBurn,
  IconDownload,
  IconEditor,
  IconHome,
  IconImport,
  IconSettings,
  IconTranscribe,
  IconTranslate,
} from "./NavIcons";
import { ModeToggle } from "../ModeToggle";

interface NavItem {
  step: WorkflowStep;
  label: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { step: "welcome", label: "首页", icon: <IconHome /> },
  { step: "download", label: "下载", icon: <IconDownload /> },
  { step: "import", label: "导入", icon: <IconImport /> },
  { step: "transcribe", label: "转录", icon: <IconTranscribe /> },
  { step: "translate", label: "翻译", icon: <IconTranslate /> },
  { step: "editor", label: "编辑", icon: <IconEditor /> },
  { step: "burn", label: "压制", icon: <IconBurn /> },
];

const bottomItems: NavItem[] = [
  { step: "settings", label: "设置", icon: <IconSettings /> },
];

interface SidebarProps {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: SidebarProps) {
  const currentStep = useUiStore((s) => s.currentStep);
  const setStep = useUiStore((s) => s.setStep);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const session = useProjectStore((s) => s.session);

  const renderItem = (item: NavItem) => {
    const active = currentStep === item.step;
    return (
      <button
        key={item.step}
        type="button"
        onClick={(event) => {
          setStep(item.step);
          event.currentTarget.blur();
        }}
        title={item.label}
        data-active={active}
        className="flex w-full items-center gap-2.5 rounded-md p-2 text-sm ring-sidebar-ring transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground"
      >
        <span className="flex shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:shrink-0">
          {item.icon}
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
      </button>
    );
  };

  return (
    <aside
      className={`group flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-52"
      }`}
    >
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-4">
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-wide">
              Hikaru Sub
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              AI 字幕工具
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          title="切换侧边栏"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="切换侧边栏"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map(renderItem)}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <div className="mb-1 flex flex-col">
          <ModeToggle />
        </div>
        <div className="flex flex-col gap-1">
          {bottomItems.map(renderItem)}
        </div>
        {!collapsed && session && (
          <p
            className="mt-2 truncate px-3 text-xs text-muted-foreground"
            title={session.videoPath}
          >
            {session.videoPath.split(/[/\\]/).pop()}
          </p>
        )}
      </div>
    </aside>
  );
}
