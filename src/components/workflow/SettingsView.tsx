import { useEffect, useState, type ReactNode } from "react";
import {
  checkFfmpeg,
  getSettings,
  invalidateFfmpegStatus,
  pickDirectory,
  pickExecutableFile,
  setSettings,
} from "../../services/tauri";
import { Select } from "../ui/Select";
import { AsrEngineSetupPanel } from "./AsrEngineSetupPanel";
import { ModelManager } from "./ModelManager";
import type { AppSettings, FfmpegStatus } from "../../types";
import {
  ASR_ENGINE_OPTIONS,
  asrModelOptions,
  defaultAsrModel,
} from "../../constants/asr";

const FFMPEG_SOURCE_LABEL: Record<FfmpegStatus["source"], string> = {
  settings: "自定义路径",
  bundled: "随应用捆绑",
  system: "系统 PATH",
};

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
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent/60";

export function SettingsView() {
  const [settings, setLocal] = useState<AppSettings | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [asrSetupRunning, setAsrSetupRunning] = useState(false);
  const [asrSetupRefreshKey, setAsrSetupRefreshKey] = useState(0);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    getSettings()
      .then(setLocal)
      .catch((e) => setMessage({ kind: "error", text: `加载设置失败：${String(e)}` }));
    refreshFfmpeg();
  }, []);

  const refreshFfmpeg = (force = false) => {
    if (force) invalidateFfmpegStatus();
    checkFfmpeg()
      .then(setFfmpeg)
      .catch(() => setFfmpeg(null));
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
      setMessage({ kind: "ok", text: "设置已保存" });
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
    setMessage({ kind: "ok", text: "ASR 引擎依赖配置完成，设置已更新" });
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
            FFmpeg 路径、ASR 引擎、翻译 API 等全局配置
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span
              className={`text-sm ${
                message.kind === "ok" ? "text-success" : "text-danger"
              }`}
            >
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty || asrSetupRunning}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-8">
          <Section title="可执行程序路径" desc="留空则使用捆绑或系统 PATH 中的程序">
            <Field label="FFmpeg 路径">
              <PathInput
                value={settings.ffmpegPath ?? ""}
                placeholder="留空使用捆绑 / 系统 ffmpeg"
                onChange={(v) => update("ffmpegPath", v || undefined)}
                onBrowse={pickExecutableFile}
              />
              <p className="mt-1.5 text-xs text-text-muted">
                {ffmpeg
                  ? ffmpeg.available
                    ? `状态：就绪 · 来源 ${FFMPEG_SOURCE_LABEL[ffmpeg.source]}${
                        ffmpeg.version ? ` · ${ffmpeg.version}` : ""
                      }`
                    : "状态：未找到 FFmpeg"
                  : "状态：检测中…"}
              </p>
            </Field>
            <Field label="Python 路径">
              <PathInput
                value={settings.pythonPath ?? ""}
                placeholder="留空使用系统 python"
                onChange={(v) => update("pythonPath", v || undefined)}
                onBrowse={pickExecutableFile}
              />
            </Field>
            <Field label="ASR 服务目录">
              <PathInput
                value={settings.asrServicePath ?? ""}
                placeholder="asr-service 目录路径"
                onChange={(v) => update("asrServicePath", v || undefined)}
                onBrowse={pickDirectory}
              />
            </Field>
          </Section>

          <Section title="日语转录（ASR）默认" desc="新建项目时使用的默认转录配置（源语言固定为日语）">
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
              disabled={saving}
              onBeforeStart={async () => {
                await setSettings(settings);
                setDirty(false);
                setMessage({ kind: "ok", text: "设置已保存，开始配置 ASR 引擎依赖" });
              }}
              onRunningChange={setAsrSetupRunning}
              onComplete={refreshSettingsAfterAsrSetup}
            />
          </Section>

          <Section title="翻译（OpenAI 兼容）" desc="API Key 仅保存在本机配置文件中，不会写入项目或源码">
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

          <Section title="默认目标语言" desc="新建项目时使用的翻译目标语言">
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

function PathInput({
  value,
  placeholder,
  onChange,
  onBrowse,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBrowse: () => Promise<string | null>;
}) {
  const handleBrowse = async () => {
    const picked = await onBrowse();
    if (picked) onChange(picked);
  };

  return (
    <div className="flex gap-2">
      <input
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={handleBrowse}
        className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-text-muted hover:border-accent/50 hover:text-text"
      >
        浏览…
      </button>
    </div>
  );
}
