import { useCallback, useEffect, useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { IconCheck } from "../layout/NavIcons";
import { Select } from "../ui/Select";
import { getSettings, pathExists } from "../../services/tauri";
import {
  createTranslationProvider,
  type TranslationProgress,
} from "../../services/translation";
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
  const project = useProjectStore((s) => s.project);
  const cues = useProjectStore((s) => s.cues);
  const setCues = useProjectStore((s) => s.setCues);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [targetLang, setTargetLang] = useState("zh-CN");
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // 检查前置条件
  const [hasAss, setHasAss] = useState(false);
  const [checkingAss, setCheckingAss] = useState(true);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    if (!project) return;
    setTargetLang(project.targetLang || "zh-CN");

    // 检查字幕文件或内存中的 cues
    if (cues.length > 0) {
      setHasAss(true);
      setCheckingAss(false);
    } else if (project.assPath) {
      pathExists(project.assPath)
        .then((exists) => {
          setHasAss(exists);
          setCheckingAss(false);
        })
        .catch(() => {
          setHasAss(false);
          setCheckingAss(false);
        });
    } else {
      setHasAss(false);
      setCheckingAss(false);
    }
  }, [project, cues.length]);

  const handleTranslate = useCallback(async () => {
    if (!project || !settings || cues.length === 0) return;

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
        baseUrl: settings.translationBaseUrl,
        apiKey: settings.translationApiKey,
        model: settings.translationModel,
        temperature: 0.3,
      });

      // 解析术语表
      const glossary: Record<string, string> = {};
      if (settings.translationGlossary) {
        const lines = settings.translationGlossary.split('\n');
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
        cues,
        {
          sourceLang: project.sourceLang || "ja",
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

      // 更新 cues
      setCues(result.cues);

      // 保存翻译后的 ASS 文件
      if (project.assPath) {
        try {
          const { loadAssText, saveAssText } = await import("../../services/tauri");
          const { parseAss, serializeAss } = await import("@hikaru/ass-core");

          // 读取原始 ASS（获取样式和元数据）
          const originalAssText = await loadAssText(project.assPath);
          const doc = parseAss(originalAssText);

          // 更新 cues
          doc.cues = result.cues;

          // 生成译文文件路径：原文件名 + .translated.ass
          const translatedPath = project.assPath.replace(/\.ass$/i, '.translated.ass');
          await saveAssText(translatedPath, serializeAss(doc));

          console.log(`翻译后的字幕已保存到: ${translatedPath}`);
        } catch (saveErr) {
          console.warn("保存翻译后的字幕失败:", saveErr);
        }
      }

      setSuccess(true);
      updateTask("translate", { status: "success", progress: 100 });

      if (result.errors.length > 0) {
        console.warn("翻译警告：", result.errors);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      updateTask("translate", { status: "error" });
    } finally {
      setTranslating(false);
    }
  }, [
    project,
    settings,
    cues,
    targetLang,
    setCues,
    upsertTask,
    updateTask,
  ]);

  const canTranslate =
    !translating &&
    cues.length > 0 &&
    settings?.translationBaseUrl &&
    settings?.translationModel;

  const hasTranslation = cues.some((c) => c.secondaryText);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h2 className="text-xl font-semibold">AI 翻译</h2>
        <p className="mt-1 text-sm text-text-muted">
          通过大模型 API 批量翻译，生成双语 ASS 字幕
        </p>
      </header>

      {/* 前置条件检查 */}
      {!checkingAss && !hasAss && (
        <div className="rounded-lg border border-yellow-600/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          <p className="font-medium">⚠️ 未检测到字幕文件</p>
          <p className="mt-1 text-yellow-300/80">
            请先完成「转录」步骤生成单语字幕
          </p>
        </div>
      )}

      {cues.length === 0 && (
        <div className="rounded-lg border border-yellow-600/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          <p className="font-medium">⚠️ 字幕为空</p>
          <p className="mt-1 text-yellow-300/80">
            当前项目没有字幕条目，请先完成转录
          </p>
        </div>
      )}

      {/* 配置区 */}
      <section className="rounded-xl border border-border bg-surface-raised p-5">
        <h3 className="mb-4 font-medium">翻译配置</h3>

        <div className="space-y-4">
          {/* 源语言（只读） */}
          <div className="flex items-center gap-4">
            <label className="w-24 text-sm text-text-muted">源语言</label>
            <div className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-muted">
              {project?.sourceLang === "ja"
                ? "日语"
                : project?.sourceLang === "en"
                  ? "英语"
                  : project?.sourceLang === "zh"
                    ? "中文"
                    : project?.sourceLang || "自动检测"}
            </div>
          </div>

          {/* 目标语言 */}
          <div className="flex items-center gap-4">
            <label className="w-24 text-sm text-text-muted">目标语言</label>
            <Select
              value={targetLang}
              onChange={setTargetLang}
              options={TARGET_LANGS}
              disabled={translating}
            />
          </div>

          {/* API 配置提示 */}
          {settings && !settings.translationBaseUrl && (
            <div className="rounded-md border border-yellow-600/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
              ⚠️ 未配置翻译 API，请前往「设置」页面配置
            </div>
          )}

          {settings && settings.translationBaseUrl && (
            <div className="space-y-2 rounded-md border border-border bg-surface p-3 text-xs text-text-muted">
              <div>
                <span className="text-text-dimmed">API：</span>{" "}
                {settings.translationBaseUrl}
              </div>
              <div>
                <span className="text-text-dimmed">模型：</span>{" "}
                {settings.translationModel}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 翻译状态 */}
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

      {/* 字幕统计 */}
      {cues.length > 0 && (
        <section className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="mb-4 font-medium">字幕统计</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-semibold text-primary">
                {cues.length}
              </div>
              <div className="mt-1 text-xs text-text-muted">总条数</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-primary">
                {cues.filter((c) => c.secondaryText).length}
              </div>
              <div className="mt-1 text-xs text-text-muted">已翻译</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-primary">
                {cues.filter((c) => !c.secondaryText).length}
              </div>
              <div className="mt-1 text-xs text-text-muted">未翻译</div>
            </div>
          </div>
        </section>
      )}

      {/* 操作按钮 */}
      <footer className="flex items-center justify-between">
        <button
          onClick={() => setStep("transcribe")}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-raised disabled:opacity-50"
          disabled={translating}
        >
          返回转录
        </button>

        <div className="flex gap-3">
          <button
            onClick={handleTranslate}
            disabled={!canTranslate}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {translating
              ? "翻译中..."
              : hasTranslation
                ? "重新翻译"
                : "开始翻译"}
          </button>

          {hasTranslation && (
            <button
              onClick={() => setStep("editor")}
              disabled={translating}
              className="rounded-md border border-primary px-6 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              进入编辑
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
