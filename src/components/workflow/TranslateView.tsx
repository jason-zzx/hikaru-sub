import { useCallback, useEffect, useState } from "react";
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
} from "../../services/translation";
import { confirmDiscardUnsavedChanges } from "../../services/unsavedChanges";
import { withDiscardedSubtitleRecovery } from "../../services/subtitleRecovery";
import type { AppSettings } from "../../types";

const TARGET_LANGS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

export function TranslateView() {
  const setStep = useUiStore((s) => s.setStep);
  const openSettings = useUiStore((s) => s.openSettings);
  const session = useProjectStore((s) => s.session);
  const setCues = useProjectStore((s) => s.setCues);
  const setAssMetadata = useProjectStore((s) => s.setAssMetadata);
  const setActiveSubtitle = useProjectStore((s) => s.setActiveSubtitle);
  const markSaved = useProjectStore((s) => s.markSaved);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [targetLang, setTargetLang] = useState("zh-CN");
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Page-owned logical source (transcribed ASS), not projectStore editor rows.
  const [sourceCues, setSourceCues] = useState<SubtitleCue[]>([]);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [hasAss, setHasAss] = useState(false);
  const [logicalResultCues, setLogicalResultCues] = useState<SubtitleCue[] | null>(
    null,
  );

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
    if (!session) {
      setSourceCues([]);
      setHasAss(false);
      setSourceLoading(false);
      return;
    }
    setTargetLang(settings?.defaultTargetLang || "zh-CN");
    setSourceLoading(true);
    setSuccess(false);
    setLogicalResultCues(null);

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
        // Page-owned source only — do not overwrite editor styles/scriptInfo on enter.
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

  const handleTranslate = useCallback(async () => {
    if (
      !session ||
      !settings ||
      !activeProviderReady ||
      sourceCues.length === 0
    ) {
      return;
    }
    const discardDecision = await confirmDiscardUnsavedChanges();
    if (!discardDecision.proceed) return;
    const documentGuard = captureProjectDocumentGuard(session.videoPath);
    const rejectStaleResult = () => {
      if (documentGuard.unchanged()) return false;
      setError("字幕或工作视频已发生变化，已放弃本次翻译结果");
      updateTask("translate", { status: "error" });
      return true;
    };

    setError(null);
    setSuccess(false);
    setTranslating(true);
    setProgress(null);

    upsertTask({
      id: "translate",
      label: "AI 翻译",
      status: "running",
      progress: 0,
    });

    try {
      const provider = createTranslationProvider({
        apiType: activeProvider.apiType,
        baseUrl: activeProvider.baseUrl,
        apiKey: activeProvider.apiKey,
        model: activeProvider.model,
        maxConcurrency: activeProvider.maxConcurrency,
        requestsPerMinute: activeProvider.requestsPerMinute,
        temperature: 0.3,
      });

      const glossary: Record<string, string> = {};
      if (settings.translationGlossary) {
        const lines = settings.translationGlossary.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const match = trimmed.match(/^(.+?)\s*->\s*(.+)$/);
          if (match) {
            glossary[match[1].trim()] = match[2].trim();
          }
        }
      }

      const result = await provider.translateBatch(
        sourceCues,
        {
          sourceLang: "ja",
          targetLang: targetLang,
          batchSize: settings.translationBatchSize,
          contextWindow: settings.translationContextWindow,
          customPrompt: settings.translationCustomPrompt,
          glossary: Object.keys(glossary).length > 0 ? glossary : undefined,
          timeout: 60000,
        },
        (p) => {
          setProgress(p);
          updateTask("translate", {
            progress: Math.round(p.progress * 100),
          });
        },
      );
      if (rejectStaleResult()) return;

      // Bilingual boundary: serialize logical result, re-parse as physical rows.
      const { assScriptInfo, assStyles } = useProjectStore.getState();
      let baseDoc;
      if (assScriptInfo && assStyles.length > 0) {
        baseDoc = {
          scriptInfo: assScriptInfo,
          styles: assStyles,
          cues: result.cues,
        };
      } else {
        const originalAssText = await loadAssText(session.transcribedAssPath);
        baseDoc = parseAss(originalAssText, { mergeBilingual: false });
        baseDoc.cues = result.cues;
      }
      if (rejectStaleResult()) return;

      const serialized = serializeAss(baseDoc, {
        mergeMode: settings.subtitleMergeMode,
        preserveOrder: true,
      });
      const physicalDoc = parseAss(serialized, { mergeBilingual: false });
      const applied = await withDiscardedSubtitleRecovery(
        discardDecision.recoveryVideoPath,
        () => {
          if (!documentGuard.unchanged()) return false;
          setCues(physicalDoc.cues);
          setAssMetadata(physicalDoc.scriptInfo, physicalDoc.styles);
          return true;
        },
      );
      if (!applied) {
        rejectStaleResult();
        return;
      }
      setLogicalResultCues(result.cues);
      // Pair immutable serialized output with physical doc/token before write await.
      const resultGuard = captureProjectDocumentGuard(session.videoPath);
      const snap = useProjectStore.getState().captureSaveSnapshot();

      try {
        await saveAssText(session.translatedAssPath, serialized);
        if (!resultGuard.sameDocument()) {
          setError("工作视频已切换，翻译文件已写入但未覆盖当前字幕");
          updateTask("translate", { status: "error" });
          return;
        }
        setActiveSubtitle("translated", session.translatedAssPath);
        markSaved(snap.token);
        console.log(`翻译后的字幕已保存到: ${session.translatedAssPath}`);
      } catch (saveErr) {
        if (!resultGuard.sameDocument()) {
          updateTask("translate", { status: "error" });
          return;
        }
        // Keep physical rows in memory as unsaved translated content.
        setActiveSubtitle("translated", null);
        console.warn("保存翻译后的字幕失败:", saveErr);
      }

      setSuccess(true);
      updateTask("translate", { status: "success", progress: 100 });

      if (result.errors.length > 0) {
        console.warn(`翻译完成，但有 ${result.errors.length} 个请求发生错误`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      updateTask("translate", { status: "error" });
    } finally {
      setTranslating(false);
    }
  }, [
    session,
    settings,
    activeProvider,
    activeProviderReady,
    sourceCues,
    targetLang,
    setCues,
    setAssMetadata,
    setActiveSubtitle,
    markSaved,
    upsertTask,
    updateTask,
  ]);

  const canTranslate =
    !translating &&
    !sourceLoading &&
    sourceCues.length > 0 &&
    activeProviderReady;

  const statsCues = logicalResultCues ?? sourceCues;
  const hasTranslation = Boolean(
    logicalResultCues?.some((c) => c.secondaryText),
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
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
              disabled={translating}
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="w-24 text-sm text-text-muted">供应商</label>
            <Select
              value={selectedProviderId}
              onChange={setSelectedProviderId}
              options={providerOptions}
              disabled={translating || settingsLoading}
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

      {(translating || progress || success || error) && (
        <section className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="mb-4 font-medium">翻译状态</h3>

          {translating && progress && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">{progress.currentBatch}</span>
                <span className="font-mono text-primary">
                  {Math.round(progress.progress * 100)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress.progress * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-text-muted">
                <span>
                  {progress.completedCues} / {progress.totalCues} 条
                </span>
                <span>
                  {progress.completedBatches} / {progress.totalBatches} 批次
                </span>
              </div>
            </div>
          )}

          {success && !translating && (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <IconCheck className="h-5 w-5" />
              <span>翻译完成，已生成双语字幕</span>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-600/30 bg-red-500/10 p-3 text-sm text-red-300">
              <p className="font-medium">翻译失败</p>
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
                {statsCues.filter((c) => c.secondaryText).length}
              </div>
              <div className="mt-1 text-xs text-text-muted">已翻译</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-primary">
                {statsCues.filter((c) => !c.secondaryText).length}
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
          disabled={translating}
        >
          返回转录
        </Button>

        <div className="flex gap-3">
          <Button
            onClick={handleTranslate}
            disabled={!canTranslate}
            variant="default"
            className="px-6 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {translating
              ? "翻译中..."
              : hasTranslation
                ? "重新翻译"
                : "开始翻译"}
          </Button>

          {hasTranslation && (
            <Button
              onClick={() => setStep("editor")}
              disabled={translating}
              variant="outline"
              className="px-6 py-2 text-sm font-medium border-primary text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              进入编辑
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
