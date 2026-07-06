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
  const project = useProjectStore((s) => s.project);

  const renderItem = (item: NavItem) => {
    const active = currentStep === item.step;
    return (
      <button
        key={item.step}
        type="button"
        onClick={() => setStep(item.step)}
        title={item.label}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
          active
            ? "bg-accent/20 text-accent"
            : "text-text-muted hover:bg-surface-overlay hover:text-text"
        }`}
      >
        <span className="flex shrink-0 items-center justify-center">{item.icon}</span>
        {!collapsed && <span className="truncate">{item.label}</span>}
      </button>
    );
  };

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-border bg-surface-raised transition-[width] ${
        collapsed ? "w-14" : "w-52"
      }`}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-4">
        {!collapsed && (
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-text">
              Hikaru Sub
            </h1>
            <p className="text-xs text-text-muted">AI 字幕工具</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded p-1 text-text-muted hover:bg-surface-overlay hover:text-text"
          aria-label="切换侧边栏"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map(renderItem)}
      </nav>

      <div className="border-t border-border p-2">
        {bottomItems.map(renderItem)}
        {!collapsed && project && (
          <p
            className="mt-2 truncate px-3 text-xs text-text-muted"
            title={project.videoPath}
          >
            {project.videoPath.split(/[/\\]/).pop()}
          </p>
        )}
      </div>
    </aside>
  );
}
