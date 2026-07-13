import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { Select } from "../ui/select-adapter";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { AsrEngineSetupPanel } from "./AsrEngineSetupPanel";
import { ModelManager } from "./ModelManager";
import { RuntimeDependenciesPanel } from "./RuntimeDependenciesPanel";
import type {
  AppSettings,
  RuntimeDependencyKind,
  RuntimeDependencyProbe,
  RuntimeDependencySnapshot,
  RuntimeDependencySourceMode,
  RuntimeDependencyStorage,
} from "../../types";
import {
  ASR_ENGINE_OPTIONS,
  KOTOBA_FASTER_WHISPER_DESCRIPTION,
  asrModelOptions,
  defaultAsrModel,
} from "../../constants/asr";
import { RUNTIME_DEPENDENCY_LABEL } from "../../constants/runtimeDependencies";
import { useProjectStore } from "../../stores/projectStore";

const TARGET_LANGS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

const ASR_DEVICES = [
  { value: "auto", label: "自动" },
  { value: "cpu", label: "CPU" },
  { value: "cuda", label: "CUDA（NVIDIA GPU）" },
];

const inputClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

const RUNTIME_PREPARATION_POLL_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RuntimePreparationSnapshots = Partial<
  Record<RuntimeDependencyKind, RuntimeDependencySnapshot>
>;

export function SettingsView() {
  const asrSectionRef = useRef<HTMLDivElement | null>(null);
  const runtimePreparationJobsRef = useRef<Partial<Record<RuntimeDependencyKind, string>>>({});
  const sessionVideoPath = useProjectStore((state) => state.session?.videoPath ?? null);
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
    asrSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMessage(null);
  };

  const updateAsrEngine = (engine: string) => {
    update("asrEngine", engine);
    update("asrModel", defaultAsrModel(engine));
  };

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
          <p className="mt-1 text-sm text-text-muted">
            运行时依赖、ASR 引擎、翻译 API 等全局配置
          </p>
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

      <div className="flex-1 overflow-auto px-6 py-5">
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

          <div ref={asrSectionRef}>
            <Section title="日语转录（ASR）默认" desc="新建视频会话时使用的默认转录配置（源语言固定为日语）">
              <Field label="引擎">
                <Select
                  value={settings.asrEngine}
                  onChange={updateAsrEngine}
                  options={ASR_ENGINE_OPTIONS}
                />
              </Field>
              <Field label="模型">
                <Select
                  value={settings.asrModel}
                  onChange={(v) => update("asrModel", v)}
                  options={asrModelOptions(settings.asrEngine)}
                />
                {settings.asrEngine === "parakeet" && (
                  <p className="mt-1 text-xs text-text-muted">
                    Parakeet 使用 NVIDIA NeMo，可选依赖需单独安装；当前集成针对日语模型。
                  </p>
                )}
                {settings.asrEngine === "kotoba-faster-whisper" && (
                  <p className="mt-1 text-xs text-text-muted">
                    {KOTOBA_FASTER_WHISPER_DESCRIPTION}
                  </p>
                )}
                <div className="mt-1.5">
                  <ModelManager
                    key={`${settings.asrEngine}:${settings.asrModel}:${asrSetupRefreshKey}`}
                    engine={settings.asrEngine}
                    model={settings.asrModel}
                  />
                </div>
              </Field>
              <Field label="设备">
                <Select
                  value={settings.asrDevice}
                  onChange={(v) => update("asrDevice", v)}
                  options={ASR_DEVICES}
                />
              </Field>
              <AsrEngineSetupPanel
                engine={settings.asrEngine}
                device={settings.asrDevice}
                pythonPath={settings.pythonPath}
                asrServicePath={settings.asrServicePath}
                refreshKey={asrSetupRefreshKey}
                disabled={saving}
                onBeforeStart={async () => {
                  await setSettings(settings);
                  setDirty(false);
                setMessage(null);
                }}
                onRunningChange={setAsrSetupRunning}
                onComplete={refreshSettingsAfterAsrSetup}
              />
            </Section>
          </div>

          <Section title="翻译（OpenAI 兼容）" desc="API Key 仅保存在本机配置文件中，不会写入字幕文件或源码">
            <Field label="Base URL">
              <input
                className={inputClass}
                value={settings.translationBaseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => update("translationBaseUrl", e.target.value)}
              />
            </Field>
            <Field label="模型">
              <input
                className={inputClass}
                value={settings.translationModel}
                placeholder="gpt-4o-mini"
                onChange={(e) => update("translationModel", e.target.value)}
              />
            </Field>
            <Field label="API Key">
              <input
                className={inputClass}
                type="password"
                value={settings.translationApiKey ?? ""}
                placeholder="sk-..."
                autoComplete="off"
                onChange={(e) => update("translationApiKey", e.target.value || undefined)}
              />
            </Field>
            <Field label="每批翻译条数">
              <input
                className={inputClass}
                type="number"
                min="5"
                max="50"
                value={settings.translationBatchSize}
                onChange={(e) => update("translationBatchSize", Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-text-muted">
                范围：5-50，批量翻译时每次请求包含的字幕条数
              </p>
            </Field>
            <Field label="额外上下文条数">
              <input
                className={inputClass}
                type="number"
                min="1"
                max="10"
                value={settings.translationContextWindow}
                onChange={(e) => update("translationContextWindow", Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-text-muted">
                范围：1-10，每批前后附加的上下文字幕条数，用于提高连贯性
              </p>
            </Field>
            <Field label="自定义 Prompt">
              <textarea
                className={`${inputClass} min-h-[80px] resize-y`}
                value={settings.translationCustomPrompt ?? ""}
                placeholder="可选，将附加在系统提示词之后"
                onChange={(e) => update("translationCustomPrompt", e.target.value || undefined)}
              />
            </Field>
            <Field label="术语表（Glossary）">
              <textarea
                className={`${inputClass} min-h-[100px] resize-y`}
                value={settings.translationGlossary ?? ""}
                placeholder="每行一个术语映射，格式：原文 -> 译文&#10;例如：&#10;Kubernetes -> K8s&#10;Machine Learning -> 机器学习"
                onChange={(e) => update("translationGlossary", e.target.value || undefined)}
              />
              <p className="mt-1 text-xs text-text-muted">
                每行一个术语映射，格式：原文 -&gt; 译文
              </p>
            </Field>
            <Field label="字幕合并模式">
              <Select
                value={settings.subtitleMergeMode}
                onChange={(v) => update("subtitleMergeMode", v as "inline" | "separate")}
                options={[
                  { value: "inline", label: "行内拼接（译文 / 原文）" },
                  { value: "separate", label: "分离双行（上下两条字幕）" },
                ]}
              />
              <p className="mt-1 text-xs text-text-muted">
                行内拼接：单条字幕显示「译文 / 原文」；分离双行：生成两条时间轴相同的字幕
              </p>
            </Field>
          </Section>

          <Section title="默认目标语言" desc="新建视频会话时使用的翻译目标语言">
            <Field label="目标语言">
              <Select
                value={settings.defaultTargetLang}
                onChange={(v) => update("defaultTargetLang", v)}
                options={TARGET_LANGS}
              />
            </Field>
          </Section>
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

function Section({
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-text-muted">{label}</span>
      {children}
    </label>
  );
}
