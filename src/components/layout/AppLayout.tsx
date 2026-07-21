import { useUiStore } from "../../stores/uiStore";
import { useBurnJobPoller } from "../../hooks/useBurnJobPoller";
import { useClipJobPoller } from "../../hooks/useClipJobPoller";
import { useUnsavedChangesCloseGuard } from "../../hooks/useUnsavedChangesCloseGuard";
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
import { ClipInProgressGate } from "../workflow/ClipInProgressGate";

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

  useBurnJobPoller();
  useClipJobPoller();
  useUnsavedChangesCloseGuard();

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={sidebarCollapsed} />
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden flex-col bg-surface">
          <ClipInProgressGate step={currentStep}>
            <View />
          </ClipInProgressGate>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
