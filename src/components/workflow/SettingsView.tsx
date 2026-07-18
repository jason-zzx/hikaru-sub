import { useEffect, useRef, useState } from "react";
import {
  checkFfmpeg,
  getSettings,
  cleanupRuntimeDependency,
  getRuntimeDependencyProgress,
  invalidateFfmpegStatus,
  measureRuntimeDependencyStorage,
  prepareRuntimeDependency,
  probeRuntimeDependencies,
  setSettings,
} from "../../services/tauri";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { RuntimeDependenciesPanel } from "./RuntimeDependenciesPanel";
import { SettingsTranscriptionPanel } from "./SettingsTranscriptionPanel";
import { SettingsTranslationPanel } from "./SettingsTranslationPanel";
import type {
  AppSettings,
  RuntimeDependencyKind,
  RuntimeDependencyProbe,
  RuntimeDependencySnapshot,
  RuntimeDependencySourceMode,
  RuntimeDependencyStorage,
  SettingsCategory,
} from "../../types";
import { RUNTIME_DEPENDENCY_LABEL } from "../../constants/runtimeDependencies";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";

const RUNTIME_PREPARATION_POLL_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RuntimePreparationSnapshots = Partial<
  Record<RuntimeDependencyKind, RuntimeDependencySnapshot>
>;

const SETTINGS_CATEGORIES: { id: SettingsCategory; label: string; subtitle: string }[] = [
  {
    id: "runtime",
    label: "运行依赖",
    subtitle: "管理下载源、受管依赖与存储占用",
  },
  {
    id: "transcription",
    label: "转录",
    subtitle: "日语 ASR 引擎、模型与设备默认配置",
  },
  {
    id: "translation",
    label: "翻译",
    subtitle: "翻译 API、批处理参数与默认目标语言",
  },
];

export function SettingsView() {
  const runtimePreparationJobsRef = useRef<Partial<Record<RuntimeDependencyKind, string>>>({});
  const sessionVideoPath = useProjectStore((state) => state.session?.videoPath ?? null);
  const requestedCategory = useUiStore((state) => state.settingsCategory);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    () => useUiStore.getState().settingsCategory ?? "runtime",
  );
  const [settings, setLocal] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [asrSetupRunning, setAsrSetupRunning] = useState(false);
  const [asrSetupRefreshKey, setAsrSetupRefreshKey] = useState(0);
  const [runtimeProbe, setRuntimeProbe] = useState<RuntimeDependencyProbe | null>(null);
  const [runtimeStorage, setRuntimeStorage] = useState<RuntimeDependencyStorage | null>(null);
  const [runtimeStorageLoading, setRuntimeStorageLoading] = useState(false);
  const [cleanupKind, setCleanupKind] = useState<RuntimeDependencyKind | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [runtimePreparationSnapshots, setRuntimePreparationSnapshots] =
    useState<RuntimePreparationSnapshots>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    const initialize = async () => {
      try {
        const next = await getSettings();
        setLocal(next);
      } catch (e) {
        setMessage({ kind: "error", text: `加载设置失败：${String(e)}` });
      }
      await refreshRuntimeDependencies();
    };
    refreshFfmpeg();
    void initialize();
  }, []);

  useEffect(() => {
    if (requestedCategory) {
      setActiveCategory(requestedCategory);
    }
  }, [requestedCategory]);

  const refreshFfmpeg = (force = false) => {
    if (force) invalidateFfmpegStatus();
    checkFfmpeg()
      .catch(() => undefined);
  };

  const refreshRuntimeDependencies = async () => {
    try {
      const probe = await probeRuntimeDependencies();
      setRuntimeProbe(probe);
    } catch (e) {
      setMessage({ kind: "error", text: `检测运行时依赖失败：${String(e)}` });
    }
  };

  const refreshRuntimeStorage = async () => {
    setRuntimeStorageLoading(true);
    try {
      const next = await measureRuntimeDependencyStorage({
        preserveVideoPath: sessionVideoPath,
      });
      setRuntimeStorage(next);
    } catch (e) {
      setMessage({ kind: "error", text: `计算依赖占用失败：${String(e)}` });
    } finally {
      setRuntimeStorageLoading(false);
    }
  };

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setLocal((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
    setMessage(null);
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      await setSettings(settings);
      setDirty(false);
      setMessage(null);
      refreshFfmpeg(true);
    } catch (e) {
      setMessage({ kind: "error", text: `保存失败：${String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const refreshSettingsAfterAsrSetup = async () => {
    const next = await getSettings();
    setLocal(next);
    setDirty(false);
    setAsrSetupRefreshKey((value) => value + 1);
    setRuntimeStorage(null);
    void refreshRuntimeDependencies();
    setMessage(null);
  };

  const handleRuntimeSourceModeChange = async (mode: RuntimeDependencySourceMode) => {
    if (!settings) return;
    const next = { ...settings, runtimeSourceMode: mode };
    setLocal(next);
    setSaving(true);
    setMessage(null);
    try {
      await setSettings(next);
      setDirty(false);
      setMessage(null);
      void refreshRuntimeDependencies();
    } catch (e) {
      setMessage({ kind: "error", text: `保存下载源失败：${String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const handleCleanupDependency = (kind: RuntimeDependencyKind) => {
    if (cleaning) return;
    setCleanupKind(kind);
  };

  const confirmCleanupDependency = async () => {
    if (!cleanupKind || cleaning) return;
    const kind = cleanupKind;
    setCleaning(true);
    setMessage(null);
    try {
      await cleanupRuntimeDependency(kind, {
        preserveVideoPath: kind === "appCache" ? sessionVideoPath : null,
      });
      setCleanupKind(null);
      if (kind === "ffmpeg") refreshFfmpeg(true);
      if (kind === "python311" || kind === "asrVenv") {
        setAsrSetupRefreshKey((value) => value + 1);
      }
      void refreshRuntimeDependencies();
      await refreshRuntimeStorage();
      setMessage(null);
    } catch (e) {
      setMessage({ kind: "error", text: `清理失败：${String(e)}` });
    } finally {
      setCleaning(false);
    }
  };

  const setRuntimePreparationSnapshot = (
    kind: RuntimeDependencyKind,
    snapshot: RuntimeDependencySnapshot,
  ) => {
    setRuntimePreparationSnapshots((prev) => ({ ...prev, [kind]: snapshot }));
  };

  const handlePrepareRuntimeDependency = async (kind: RuntimeDependencyKind) => {
    if (runtimePreparationJobsRef.current[kind]) return;
    const label = RUNTIME_DEPENDENCY_LABEL[kind];
    runtimePreparationJobsRef.current[kind] = "starting";
    setRuntimePreparationSnapshot(kind, {
      id: "",
      kind,
      status: "pending",
      stage: "等待开始",
      progress: null,
      downloadedBytes: 0,
      totalBytes: 0,
      logTail: [],
      error: null,
    });
    try {
      const jobId = await prepareRuntimeDependency({ kind });
      runtimePreparationJobsRef.current[kind] = jobId;
      for (;;) {
        const snapshot = await getRuntimeDependencyProgress(jobId);
        setRuntimePreparationSnapshot(kind, snapshot);
        if (snapshot.status === "completed") {
          if (kind === "ffmpeg") refreshFfmpeg(true);
          if (kind === "python311") {
            setAsrSetupRefreshKey((value) => value + 1);
          }
          setRuntimeStorage(null);
          void refreshRuntimeDependencies();
          setMessage(null);
          return;
        }
        if (snapshot.status === "failed" || snapshot.status === "cancelled") {
          throw new Error(snapshot.error ?? `${label} 下载失败`);
        }
        await sleep(RUNTIME_PREPARATION_POLL_MS);
      }
    } catch (e) {
      setMessage({ kind: "error", text: `${label} 下载失败：${String(e)}` });
    } finally {
      delete runtimePreparationJobsRef.current[kind];
    }
  };

  const handleConfigureAsrFromRuntimePanel = () => {
    setActiveCategory("transcription");
    setMessage(null);
  };

  const activeMeta =
    SETTINGS_CATEGORIES.find((item) => item.id === activeCategory) ??
    SETTINGS_CATEGORIES[0];

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-text-muted">
        加载设置中…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold">设置</h2>
          <p className="mt-1 text-sm text-text-muted">{activeMeta.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty || asrSetupRunning}
            className="px-4 py-2"
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          className="flex w-48 shrink-0 flex-col gap-1 border-r border-border p-3"
          aria-label="设置分类"
        >
          {SETTINGS_CATEGORIES.map((item) => {
            const active = activeCategory === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-active={active}
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveCategory(item.id)}
                className="rounded-md px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[active=true]:bg-accent data-[active=true]:font-medium data-[active=true]:text-accent-foreground"
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 overflow-auto px-6 py-5">
          <div className="mx-auto flex max-w-2xl flex-col gap-8">
            {message ? (
              <div
                className={`rounded-md border px-3 py-2 text-sm break-words ${
                  message.kind === "ok"
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-danger/30 bg-danger/10 text-danger"
                }`}
              >
                {message.text}
              </div>
            ) : null}

            {activeCategory === "runtime" ? (
              <RuntimeDependenciesPanel
                probe={runtimeProbe}
                storage={runtimeStorage}
                storageLoading={runtimeStorageLoading}
                onChangeSourceMode={handleRuntimeSourceModeChange}
                onMeasureStorage={() => {
                  void refreshRuntimeStorage();
                }}
                onCleanup={handleCleanupDependency}
                onPrepareDependency={handlePrepareRuntimeDependency}
                onConfigureAsr={handleConfigureAsrFromRuntimePanel}
                preparations={runtimePreparationSnapshots}
                cleanupDisabled={cleaning}
              />
            ) : null}

            {activeCategory === "transcription" ? (
              <SettingsTranscriptionPanel
                settings={settings}
                update={update}
                asrSetupRefreshKey={asrSetupRefreshKey}
                saving={saving}
                onBeforeAsrSetupStart={async () => {
                  await setSettings(settings);
                  setDirty(false);
                  setMessage(null);
                }}
                onAsrSetupRunningChange={setAsrSetupRunning}
                onAsrSetupComplete={refreshSettingsAfterAsrSetup}
              />
            ) : null}

            {activeCategory === "translation" ? (
              <SettingsTranslationPanel settings={settings} update={update} />
            ) : null}
          </div>
        </div>
      </div>

      <Dialog
        open={cleanupKind !== null}
        onOpenChange={(open) => {
          if (!open && !cleaning) setCleanupKind(null);
        }}
      >
        <DialogContent className="gap-5 p-5 sm:max-w-sm" showCloseButton={!cleaning}>
          <DialogHeader className="gap-2 pr-6">
            <DialogTitle>确认清理</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
              {cleanupKind === "appCache"
                ? sessionVideoPath
                  ? "将清理应用缓存中的 workspace、转码代理、预览与切片抽帧（保留当前工作视频相关缓存），是否确认清理"
                  : "将清理应用缓存中的 workspace、转码代理、预览与切片抽帧，是否确认清理"
                : cleanupKind
                  ? `即将清理「${RUNTIME_DEPENDENCY_LABEL[cleanupKind]}」。清理后再次使用需要重新安装依赖，是否确认清理`
                  : "清理后再次使用需要重新安装依赖，是否确认清理"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="-mx-0 -mb-0 gap-2 rounded-none border-0 bg-transparent p-0 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={cleaning}
              className="px-3"
              onClick={() => setCleanupKind(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cleaning}
              className="px-3"
              onClick={() => {
                void confirmCleanupDependency();
              }}
            >
              {cleaning ? "清理中…" : "确认清理"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
