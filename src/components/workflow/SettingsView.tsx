import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  checkFfmpeg,
  getSettings,
  pickDirectory,
  pickExecutableFile,
  setSettings,
} from "../../services/tauri";
import { IconChevronDown } from "../layout/NavIcons";
import type { AppSettings, FfmpegStatus } from "../../types";

const FFMPEG_SOURCE_LABEL: Record<FfmpegStatus["source"], string> = {
  settings: "自定义路径",
  bundled: "随应用捆绑",
  system: "系统 PATH",
};

const SOURCE_LANGS = [
  { value: "auto", label: "自动检测" },
  { value: "ja", label: "日语" },
  { value: "en", label: "英语" },
  { value: "zh", label: "中文" },
  { value: "ko", label: "韩语" },
];

const TARGET_LANGS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

const ASR_MODELS = ["tiny", "base", "small", "medium", "large-v2", "large-v3"];
const ASR_DEVICES = [
  { value: "auto", label: "自动" },
  { value: "cpu", label: "CPU" },
  { value: "cuda", label: "CUDA（NVIDIA GPU）" },
];

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent/60";

interface SelectOption {
  value: string;
  label: string;
}

export function SettingsView() {
  const [settings, setLocal] = useState<AppSettings | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    getSettings()
      .then(setLocal)
      .catch((e) => setMessage({ kind: "error", text: `加载设置失败：${String(e)}` }));
    refreshFfmpeg();
  }, []);

  const refreshFfmpeg = () => {
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
      refreshFfmpeg();
    } catch (e) {
      setMessage({ kind: "error", text: `保存失败：${String(e)}` });
    } finally {
      setSaving(false);
    }
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
            disabled={saving || !dirty}
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

          <Section title="转录（ASR）默认" desc="新建项目时使用的默认转录配置">
            <Field label="引擎">
              <Select
                value={settings.asrEngine}
                onChange={(v) => update("asrEngine", v)}
                options={[{ value: "faster-whisper", label: "faster-whisper" }]}
              />
            </Field>
            <Field label="模型">
              <Select
                value={settings.asrModel}
                onChange={(v) => update("asrModel", v)}
                options={ASR_MODELS.map((m) => ({ value: m, label: m }))}
              />
            </Field>
            <Field label="设备">
              <Select
                value={settings.asrDevice}
                onChange={(v) => update("asrDevice", v)}
                options={ASR_DEVICES}
              />
            </Field>
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
          </Section>

          <Section title="默认语言" desc="新建项目时的源语言与目标语言">
            <Field label="源语言">
              <Select
                value={settings.defaultSourceLang}
                onChange={(v) => update("defaultSourceLang", v)}
                options={SOURCE_LANGS}
              />
            </Field>
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

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex cursor-pointer items-center justify-between gap-2 pr-3 text-left`}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-surface-raised py-1 shadow-lg">
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    active
                      ? "bg-accent/20 text-accent"
                      : "text-text hover:bg-surface-overlay"
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
