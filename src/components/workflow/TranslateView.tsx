import { useCallback, useEffect, useRef, useState } from "react";
import { parseAss, serializeAss, type SubtitleCue } from "@/lib/ass";
import { isTranslationProviderReady } from "@/constants/translationProviders";
import { useUiStore } from "../../stores/uiStore";
import {
  captureProjectDocumentGuard,
  useProjectStore,
} from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { IconAlertTriangle, IconCheck } from "../layout/NavIcons";
import { Select } from "../ui/select-adapter";
import { Button } from "../ui/button";
import {
  getSettings,
  loadAssText,
  pathExists,
  saveAssText,
} from "../../services/tauri";
import {
  createTranslationProvider,
  type TranslationProgress,
  type TranslationResult,
} from "../../services/translation";
import {
  confirmDiscardUnsavedChanges,
  type DiscardUnsavedChangesDecision,
} from "../../services/unsavedChanges";
import { withDiscardedSubtitleRecovery } from "../../services/subtitleRecovery";
import type { AppSettings } from "../../types";
import { mergeRetryResult, translatedCueCount } from "./translationResult";

const TARGET_LANGS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

const MAX_VISIBLE_ERRORS = 20;

type ActiveRun = {
  id: number;
  controller: AbortController;
  acceptingRequests: boolean;
  cancelRequested: boolean;
};

type ApplyResult = "saved" | "save-error" | "stale";

function buildGlossary(settings: AppSettings): Record<string, string> | undefined {
  const glossary: Record<string, string> = {};
  for (const line of settings.translationGlossary?.split("\n") ?? []) {
    const match = line.trim().match(/^(.+?)\s*->\s*(.+)$/);
    if (match) glossary[match[1].trim()] = match[2].trim();
  }
  return Object.keys(glossary).length > 0 ? glossary : undefined;
}

export function TranslateView() {
  const setStep = useUiStore((state) => state.setStep);
  const openSettings = useUiStore((state) => state.openSettings);
  const session = useProjectStore((state) => state.session);
  const setCues = useProjectStore((state) => state.setCues);
  const setAssMetadata = useProjectStore((state) => state.setAssMetadata);
  const setActiveSubtitle = useProjectStore(
    (state) => state.setActiveSubtitle,
  );
  const markSaved = useProjectStore((state) => state.markSaved);
  const translationTask = useTaskStore((state) => state.tasks.translate);
  const upsertTask = useTaskStore((state) => state.upsertTask);
  const updateTask = useTaskStore((state) => state.updateTask);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [targetLang, setTargetLang] = useState("zh-CN");
  const [translating, setTranslating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [resultApplied, setResultApplied] = useState(false);

  // Page-owned logical source (transcribed ASS), not projectStore editor rows.
  const [sourceCues, setSourceCues] = useState<SubtitleCue[]>([]);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [hasAss, setHasAss] = useState(false);

  const operationIdRef = useRef(0);
  const activeRunRef = useRef<ActiveRun | null>(null);

  useEffect(() => {
    getSettings()
      .then((nextSettings) => {
        setSettings(nextSettings);
        setSelectedProviderId(
          nextSettings.defaultTranslationProviderId ?? "",
        );
      })
      .catch(() => setSettings(null))
      .finally(() => setSettingsLoading(false));
  }, []);

  useEffect(() => {
    setTranslating(false);
    setSaving(false);
    setCanCancel(false);
    setProgress(null);

    return () => {
      operationIdRef.current += 1;
      const run = activeRunRef.current;
      activeRunRef.current = null;
      if (run) {
        run.acceptingRequests = false;
        run.controller.abort();
      }
      const task = useTaskStore.getState().tasks.translate;
      if (task?.status === "running") {
        useTaskStore.getState().updateTask("translate", {
          status: "idle",
          message: "翻译已取消，不会在后台继续运行",
        });
      }
    };
  }, [session?.videoPath]);

  useEffect(() => {
    if (!session) {
      setSourceCues([]);
      setHasAss(false);
      setSourceLoading(false);
      setResult(null);
      setResultApplied(false);
      return;
    }
    setTargetLang(settings?.defaultTargetLang || "zh-CN");
    setSourceLoading(true);
    setResult(null);
    setResultApplied(false);
    setError(null);

    let cancelled = false;
    (async () => {
      try {
        const exists = await pathExists(session.transcribedAssPath);
        if (cancelled) return;
        if (!exists) {
          setHasAss(false);
          setSourceCues([]);
          return;
        }
        const text = await loadAssText(session.transcribedAssPath);
        if (cancelled) return;
        const doc = parseAss(text, { mergeBilingual: false });
        setHasAss(true);
        setSourceCues(doc.cues);
      } catch {
        if (!cancelled) {
          setHasAss(false);
          setSourceCues([]);
        }
      } finally {
        if (!cancelled) setSourceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, settings?.defaultTargetLang]);

  const providerOptions =
    settings?.translationProviders.map((provider) => ({
      value: provider.id,
      label: provider.name.trim() || "未命名供应商",
    })) ?? [];
  const activeProvider = settings?.translationProviders.find(
    (provider) => provider.id === selectedProviderId,
  );
  const activeProviderReady = isTranslationProviderReady(activeProvider);

  const showStaleError = useCallback(() => {
    setResult(null);
    setResultApplied(false);
    setProgress(null);
    setError("字幕或工作视频已发生变化，已放弃本次翻译结果");
    updateTask("translate", {
      status: "error",
      message: "翻译结果已过期",
    });
  }, [updateTask]);

  const applyAndSave = useCallback(
    async (
      logicalCues: SubtitleCue[],
      discardDecision: DiscardUnsavedChangesDecision,
      documentGuard: ReturnType<typeof captureProjectDocumentGuard>,
      isCurrent: () => boolean,
    ): Promise<ApplyResult> => {
      if (!session || !settings || !isCurrent() || !documentGuard.unchanged()) {
        return "stale";
      }

      const { assScriptInfo, assStyles } = useProjectStore.getState();
      let baseDoc;
      if (assScriptInfo && assStyles.length > 0) {
        baseDoc = {
          scriptInfo: assScriptInfo,
          styles: assStyles,
          cues: logicalCues,
        };
      } else {
        const originalAssText = await loadAssText(session.transcribedAssPath);
        if (!isCurrent() || !documentGuard.unchanged()) return "stale";
        baseDoc = parseAss(originalAssText, { mergeBilingual: false });
        baseDoc.cues = logicalCues;
      }

      const serialized = serializeAss(baseDoc, {
        mergeMode: settings.subtitleMergeMode,
        preserveOrder: true,
      });
      const physicalDoc = parseAss(serialized, { mergeBilingual: false });
      const applied = await withDiscardedSubtitleRecovery(
        discardDecision.recoveryVideoPath,
        () => {
          if (!isCurrent() || !documentGuard.unchanged()) return false;
          setCues(physicalDoc.cues);
          setAssMetadata(physicalDoc.scriptInfo, physicalDoc.styles);
          return true;
        },
      );
      if (!applied) return "stale";

      const resultGuard = captureProjectDocumentGuard(session.videoPath);
      const snapshot = useProjectStore.getState().captureSaveSnapshot();
      try {
        await saveAssText(session.translatedAssPath, serialized);
        if (!isCurrent() || !resultGuard.sameDocument()) return "stale";
        setActiveSubtitle("translated", session.translatedAssPath);
        markSaved(snapshot.token);
        return "saved";
      } catch {
        if (!isCurrent() || !resultGuard.sameDocument()) return "stale";
        setActiveSubtitle("translated", null);
        return "save-error";
      }
    },
    [
      markSaved,
      session,
      setActiveSubtitle,
      setAssMetadata,
      setCues,
      settings,
    ],
  );

  const executeTranslation = useCallback(
    async (
      inputCues: SubtitleCue[],
      currentResult: TranslationResult | null,
      discardDecision: DiscardUnsavedChangesDecision,
      documentGuard: ReturnType<typeof captureProjectDocumentGuard>,
    ) => {
      if (!session || !settings || !activeProvider || inputCues.length === 0) {
        return;
      }

      const priorRun = activeRunRef.current;
      if (priorRun) {
        priorRun.acceptingRequests = false;
        priorRun.controller.abort();
      }
      const run: ActiveRun = {
        id: ++operationIdRef.current,
        controller: new AbortController(),
        acceptingRequests: true,
        cancelRequested: false,
      };
      activeRunRef.current = run;
      const isCurrent = () =>
        activeRunRef.current === run && operationIdRef.current === run.id;

      setError(null);
      setResultApplied(false);
      setTranslating(true);
      setCanCancel(true);
      setProgress(null);
      if (!currentResult) setResult(null);
      upsertTask({
        id: "translate",
        label: "AI 翻译",
        status: "running",
        progress: 0,
        message: "正在翻译",
      });

      let latestProgress = 0;
      try {
        const provider = createTranslationProvider({
          apiType: activeProvider.apiType,
          baseUrl: activeProvider.baseUrl,
          apiKey: activeProvider.apiKey,
          model: activeProvider.model,
          maxConcurrency: activeProvider.maxConcurrency,
          requestsPerMinute: activeProvider.requestsPerMinute,
          temperature: activeProvider.temperature,
        });
        const nextAttempt = await provider.translateBatch(
          inputCues,
          {
            sourceLang: "ja",
            targetLang,
            batchSize: settings.translationBatchSize,
            contextWindow: settings.translationContextWindow,
            customPrompt: settings.translationCustomPrompt,
            glossary: buildGlossary(settings),
            timeout: 60_000,
            signal: run.controller.signal,
          },
          (nextProgress) => {
            if (!isCurrent()) return;
            latestProgress = nextProgress.progress;
            setProgress(nextProgress);
            updateTask("translate", {
              progress: Math.round(nextProgress.progress * 100),
            });
          },
        );

        run.acceptingRequests = false;
        if (isCurrent()) setCanCancel(false);
        if (!isCurrent()) return;
        if (!documentGuard.unchanged()) {
          showStaleError();
          return;
        }

        let nextResult = currentResult
          ? mergeRetryResult(currentResult, nextAttempt)
          : nextAttempt;
        if (run.cancelRequested) {
          nextResult = { ...nextResult, cancelled: true };
        }
        setResult(nextResult);

        if (nextResult.cancelled) {
          updateTask("translate", {
            status: "idle",
            progress: Math.round(latestProgress * 100),
            message: `翻译已取消：成功 ${nextResult.successCount} 条，失败 ${nextResult.failedCount} 条`,
          });
          return;
        }
        if (nextResult.failedCount > 0) {
          updateTask("translate", {
            status: "error",
            message:
              nextResult.successCount > 0
                ? `翻译部分完成：成功 ${nextResult.successCount} 条，失败 ${nextResult.failedCount} 条`
                : `翻译失败：成功 0 条，失败 ${nextResult.failedCount} 条`,
          });
          return;
        }

        const applyResult = await applyAndSave(
          nextResult.cues,
          discardDecision,
          documentGuard,
          isCurrent,
        );
        if (applyResult === "stale") {
          if (isCurrent()) showStaleError();
          return;
        }
        setResultApplied(true);
        if (applyResult === "save-error") {
          setError("翻译已完成，但保存字幕文件失败，请进入编辑器另存");
          updateTask("translate", {
            status: "error",
            progress: 100,
            message: "翻译完成，但保存失败",
          });
          return;
        }
        updateTask("translate", {
          status: "success",
          progress: 100,
          message: `翻译完成：成功 ${nextResult.successCount} 条，失败 0 条`,
        });
      } catch {
        run.acceptingRequests = false;
        if (!isCurrent()) return;
        setCanCancel(false);
        if (run.cancelRequested) {
          const cancelledAttempt: TranslationResult = {
            cues: inputCues,
            successCount: 0,
            failedCount: inputCues.length,
            errors: [],
            cancelled: true,
          };
          const cancelledResult = currentResult
            ? mergeRetryResult(currentResult, cancelledAttempt)
            : cancelledAttempt;
          setResult(cancelledResult);
          updateTask("translate", {
            status: "idle",
            message: `翻译已取消：成功 ${cancelledResult.successCount} 条，失败 ${cancelledResult.failedCount} 条`,
          });
        } else {
          setError("翻译请求失败，请稍后重试");
          updateTask("translate", {
            status: "error",
            message: "翻译失败",
          });
        }
      } finally {
        if (isCurrent()) {
          activeRunRef.current = null;
          setCanCancel(false);
          setTranslating(false);
        }
      }
    },
    [
      activeProvider,
      applyAndSave,
      session,
      settings,
      showStaleError,
      targetLang,
      updateTask,
      upsertTask,
    ],
  );

  const startTranslation = useCallback(
    async (
      inputCues: SubtitleCue[],
      currentResult: TranslationResult | null,
    ) => {
      if (!session || !activeProviderReady || inputCues.length === 0) return;
      const preflightId = ++operationIdRef.current;
      const documentGuard = captureProjectDocumentGuard(session.videoPath);
      const discardDecision = await confirmDiscardUnsavedChanges();
      if (!discardDecision.proceed || operationIdRef.current !== preflightId) {
        return;
      }
      if (!documentGuard.unchanged()) {
        showStaleError();
        return;
      }
      await executeTranslation(
        inputCues,
        currentResult,
        discardDecision,
        documentGuard,
      );
    },
    [
      activeProviderReady,
      executeTranslation,
      session,
      showStaleError,
    ],
  );

  const handleTranslate = useCallback(
    () => startTranslation(sourceCues, null),
    [sourceCues, startTranslation],
  );

  const handleRetry = useCallback(() => {
    if (!result) return;
    const failedCues = result.cues.filter(
      (cue) => !cue.secondaryText?.trim(),
    );
    return startTranslation(failedCues, result);
  }, [result, startTranslation]);

  const handleCancel = useCallback(() => {
    const run = activeRunRef.current;
    if (!run?.acceptingRequests) return;
    run.acceptingRequests = false;
    run.cancelRequested = true;
    setCanCancel(false);
    run.controller.abort();
  }, []);

  const handleSaveCurrent = useCallback(async () => {
    if (!session || !result || translatedCueCount(result.cues) === 0) return;
    const operationId = ++operationIdRef.current;
    const documentGuard = captureProjectDocumentGuard(session.videoPath);
    const discardDecision = await confirmDiscardUnsavedChanges();
    if (!discardDecision.proceed || operationIdRef.current !== operationId) {
      return;
    }
    if (!documentGuard.unchanged()) {
      showStaleError();
      return;
    }

    const isCurrent = () => operationIdRef.current === operationId;
    setSaving(true);
    setError(null);
    upsertTask({
      id: "translate",
      label: "AI 翻译",
      status: "running",
      progress: 100,
      message: "正在保存翻译结果",
    });

    try {
      const applyResult = await applyAndSave(
        result.cues,
        discardDecision,
        documentGuard,
        isCurrent,
      );
      if (applyResult === "stale") {
        if (isCurrent()) showStaleError();
        return;
      }
      setResultApplied(true);
      if (applyResult === "save-error") {
        setError("翻译结果已应用，但保存字幕文件失败，请进入编辑器另存");
        updateTask("translate", {
          status: "error",
          message: "翻译结果保存失败",
        });
        return;
      }
      updateTask("translate", {
        status: result.cancelled ? "idle" : "error",
        message: `已保存当前结果：成功 ${result.successCount} 条，失败 ${result.failedCount} 条`,
      });
    } catch {
      if (isCurrent()) {
        setError("保存当前结果失败，请稍后重试");
        updateTask("translate", {
          status: "error",
          message: "翻译结果保存失败",
        });
      }
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }, [
    applyAndSave,
    result,
    session,
    showStaleError,
    updateTask,
    upsertTask,
  ]);

  const busy = translating || saving;
  const canTranslate =
    !busy &&
    !sourceLoading &&
    sourceCues.length > 0 &&
    activeProviderReady;
  const statsCues = result?.cues ?? sourceCues;
  const hasTranslation = translatedCueCount(statsCues) > 0;
  const incompleteResult = Boolean(
    result && (result.cancelled || result.failedCount > 0),
  );
  const visibleErrors = result?.errors.slice(0, MAX_VISIBLE_ERRORS) ?? [];
  const previousTaskMessage =
    !busy &&
    !result &&
    !error &&
    translationTask?.status === "idle" &&
    translationTask.message?.startsWith("翻译已取消")
      ? translationTask.message
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto p-6">
      <header>
        <h2 className="text-xl font-semibold">AI 翻译</h2>
        <p className="mt-1 text-sm text-text-muted">
          通过大模型 API 批量翻译，生成双语 ASS 字幕
        </p>
      </header>

      {!sourceLoading && !hasAss && (
        <div className="rounded-lg border border-yellow-600/30 bg-yellow-500/10 p-4 text-sm text-yellow-700 dark:text-yellow-200">
          <p className="flex items-center gap-2 font-medium">
            <IconAlertTriangle className="h-4 w-4" />
            <span>未检测到字幕文件</span>
          </p>
          <p className="mt-1 text-yellow-800/90 dark:text-yellow-300/80">
            请先完成「转录」步骤生成单语字幕
          </p>
        </div>
      )}

      {!sourceLoading && hasAss && sourceCues.length === 0 && (
        <div className="rounded-lg border border-yellow-600/30 bg-yellow-500/10 p-4 text-sm text-yellow-700 dark:text-yellow-200">
          <p className="flex items-center gap-2 font-medium">
            <IconAlertTriangle className="h-4 w-4" />
            <span>字幕为空</span>
          </p>
          <p className="mt-1 text-yellow-800/90 dark:text-yellow-300/80">
            当前视频没有字幕条目，请先完成转录
          </p>
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface-raised p-5">
        <h3 className="mb-4 font-medium">翻译配置</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="w-24 text-sm text-text-muted">源语言</label>
            <div className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted">
              日语
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="w-24 text-sm text-text-muted">目标语言</label>
            <Select
              value={targetLang}
              onChange={setTargetLang}
              options={TARGET_LANGS}
              disabled={busy}
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="w-24 text-sm text-text-muted">供应商</label>
            <Select
              value={selectedProviderId}
              onChange={setSelectedProviderId}
              options={providerOptions}
              disabled={busy || settingsLoading}
              placeholder="选择供应商"
            />
          </div>

          {!settingsLoading && !activeProviderReady && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-yellow-600/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-200">
              <IconAlertTriangle className="h-4 w-4 shrink-0" />
              <span>所选供应商配置不完整，请前往「设置」页面配置</span>
              <Button
                type="button"
                variant="outline"
                onClick={() => openSettings("providers")}
                className="border-yellow-600/50 px-2.5 text-xs text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-200"
              >
                前往设置
              </Button>
            </div>
          )}

          {activeProvider && (
            <div className="space-y-2 rounded-md border border-border bg-surface p-3 text-xs text-text-muted">
              <div>
                <span className="text-text-dimmed">供应商：</span>{" "}
                {activeProvider.name.trim() || "未填写"}
              </div>
              <div>
                <span className="text-text-dimmed">模型：</span>{" "}
                {activeProvider.model.trim() || "未填写"}
              </div>
            </div>
          )}
        </div>
      </section>

      {(busy || progress || result || error || previousTaskMessage) && (
        <section className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="mb-4 font-medium">翻译状态</h3>

          {translating && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">
                  {progress?.currentBatch ?? "正在准备翻译"}
                </span>
                <span className="font-mono text-primary">
                  {Math.round((progress?.progress ?? 0) * 100)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(progress?.progress ?? 0) * 100}%` }}
                />
              </div>
              {progress && (
                <div className="flex justify-between text-xs text-text-muted">
                  <span>
                    {progress.completedCues} / {progress.totalCues} 条
                  </span>
                  <span>
                    {progress.completedBatches} / {progress.totalBatches} 批次
                  </span>
                </div>
              )}
            </div>
          )}

          {saving && <p className="text-sm text-text-muted">正在保存当前结果...</p>}

          {previousTaskMessage && (
            <div className="rounded-md border border-border bg-surface p-3 text-sm text-text-muted">
              <p className="font-medium text-text">上次翻译状态</p>
              <p className="mt-1 text-xs">{previousTaskMessage}</p>
            </div>
          )}

          {result &&
            !busy &&
            !error &&
            !result.cancelled &&
            result.failedCount === 0 && (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <IconCheck className="h-5 w-5" />
              <span>
                翻译完成，成功 {result.successCount} 条、失败 0 条
              </span>
            </div>
          )}

          {result && !busy && result.cancelled && (
            <div className="rounded-md border border-yellow-600/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-200">
              <p className="font-medium">翻译已取消</p>
              <p className="mt-1 text-xs">
                成功 {result.successCount} 条、失败 {result.failedCount} 条
              </p>
            </div>
          )}

          {result &&
            !busy &&
            !result.cancelled &&
            result.successCount > 0 &&
            result.failedCount > 0 && (
              <div className="rounded-md border border-yellow-600/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-200">
                <p className="font-medium">翻译部分完成</p>
                <p className="mt-1 text-xs">
                  成功 {result.successCount} 条、失败 {result.failedCount} 条
                </p>
              </div>
            )}

          {result &&
            !busy &&
            !result.cancelled &&
            result.successCount === 0 &&
            result.failedCount > 0 && (
              <div className="rounded-md border border-red-600/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">
                <p className="font-medium">翻译失败</p>
                <p className="mt-1 text-xs">
                  成功 0 条、失败 {result.failedCount} 条
                </p>
              </div>
            )}

          {result && incompleteResult && visibleErrors.length > 0 && !busy && (
            <details className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-muted">
              <summary className="cursor-pointer font-medium text-text">
                查看失败原因
              </summary>
              <ul className="mt-2 space-y-1">
                {visibleErrors.map((message, index) => (
                  <li key={`${index}-${message}`}>{message}</li>
                ))}
              </ul>
              {result.errors.length > MAX_VISIBLE_ERRORS && (
                <p className="mt-2 text-text-dimmed">
                  另有 {result.errors.length - MAX_VISIBLE_ERRORS} 条未显示
                </p>
              )}
            </details>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-red-600/30 bg-red-500/10 p-3 text-sm text-red-300">
              <p className="font-medium">操作失败</p>
              <p className="mt-1 text-xs text-red-400">{error}</p>
            </div>
          )}
        </section>
      )}

      {statsCues.length > 0 && (
        <section className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="mb-4 font-medium">字幕统计</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-semibold text-primary">
                {statsCues.length}
              </div>
              <div className="mt-1 text-xs text-text-muted">总条数</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-primary">
                {translatedCueCount(statsCues)}
              </div>
              <div className="mt-1 text-xs text-text-muted">已翻译</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-primary">
                {statsCues.length - translatedCueCount(statsCues)}
              </div>
              <div className="mt-1 text-xs text-text-muted">未翻译</div>
            </div>
          </div>
        </section>
      )}

      <footer className="flex items-center justify-between">
        <Button
          onClick={() => setStep("transcribe")}
          variant="outline"
          className="text-sm"
          disabled={busy}
        >
          返回转录
        </Button>

        <div className="flex flex-wrap justify-end gap-3">
          {translating && canCancel && (
            <Button type="button" variant="outline" onClick={handleCancel}>
              取消翻译
            </Button>
          )}

          {result && incompleteResult && !busy && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleRetry}
                disabled={result.failedCount === 0 || !activeProviderReady}
              >
                重试失败条目
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveCurrent}
                disabled={result.successCount === 0}
              >
                保存当前结果
              </Button>
            </>
          )}

          {!translating && (
            <Button
              onClick={handleTranslate}
              disabled={!canTranslate}
              variant="default"
              className="px-6 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {hasTranslation ? "重新翻译" : "开始翻译"}
            </Button>
          )}

          {resultApplied && hasTranslation && (
            <Button
              onClick={() => setStep("editor")}
              disabled={busy}
              variant="outline"
              className="border-primary px-6 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              进入编辑
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
