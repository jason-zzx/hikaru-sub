import { useUiStore } from "../../stores/uiStore";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { WelcomeView } from "../workflow/WelcomeView";
import { DownloadView } from "../workflow/DownloadView";
import { ImportView } from "../workflow/ImportView";
import { TranscribeView } from "../workflow/TranscribeView";
import { TranslateView } from "../workflow/TranslateView";
import { EditorView } from "../editor/EditorView";
import { BurnView } from "../workflow/BurnView";
import { SettingsView } from "../workflow/SettingsView";

const stepViews = {
  welcome: WelcomeView,
  download: DownloadView,
  import: ImportView,
  transcribe: TranscribeView,
  translate: TranslateView,
  editor: EditorView,
  burn: BurnView,
  settings: SettingsView,
} as const;

export function AppLayout() {
  const currentStep = useUiStore((s) => s.currentStep);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const View = stepViews[currentStep];

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={sidebarCollapsed} />
        <main className="flex min-w-0 flex-1 flex-col bg-surface">
          <View />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
