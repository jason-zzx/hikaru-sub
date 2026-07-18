import { Select } from "../ui/select-adapter";
import {
  SettingsField,
  SettingsSection,
  settingsInputClass,
} from "./settingsForm";
import type { AppSettings } from "../../types";

const TARGET_LANGS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

interface SettingsTranslationPanelProps {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function SettingsTranslationPanel({
  settings,
  update,
}: SettingsTranslationPanelProps) {
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="翻译行为"
        desc="供应商连接、认证与模型在「供应商」分类中管理"
      >
        <SettingsField label="每批翻译条数">
          <input
            className={settingsInputClass}
            type="number"
            min="5"
            max="50"
            value={settings.translationBatchSize}
            onChange={(e) =>
              update("translationBatchSize", Number(e.target.value))
            }
          />
          <p className="mt-1 text-xs text-text-muted">
            范围：5-50，批量翻译时每次请求包含的字幕条数
          </p>
        </SettingsField>
        <SettingsField label="额外上下文条数">
          <input
            className={settingsInputClass}
            type="number"
            min="1"
            max="10"
            value={settings.translationContextWindow}
            onChange={(e) =>
              update("translationContextWindow", Number(e.target.value))
            }
          />
          <p className="mt-1 text-xs text-text-muted">
            范围：1-10，每批前后附加的上下文字幕条数，用于提高连贯性
          </p>
        </SettingsField>
        <SettingsField label="自定义 Prompt">
          <textarea
            className={`${settingsInputClass} min-h-[80px] resize-y`}
            value={settings.translationCustomPrompt ?? ""}
            placeholder="可选，将附加在系统提示词之后"
            onChange={(e) =>
              update("translationCustomPrompt", e.target.value || undefined)
            }
          />
        </SettingsField>
        <SettingsField label="术语表（Glossary）">
          <textarea
            className={`${settingsInputClass} min-h-[100px] resize-y`}
            value={settings.translationGlossary ?? ""}
            placeholder="每行一个术语映射，格式：原文 -> 译文&#10;例如：&#10;Kubernetes -> K8s&#10;Machine Learning -> 机器学习"
            onChange={(e) =>
              update("translationGlossary", e.target.value || undefined)
            }
          />
          <p className="mt-1 text-xs text-text-muted">
            每行一个术语映射，格式：原文 -&gt; 译文
          </p>
        </SettingsField>
        <SettingsField label="字幕合并模式">
          <Select
            value={settings.subtitleMergeMode}
            onChange={(v) =>
              update("subtitleMergeMode", v as "inline" | "separate")
            }
            options={[
              { value: "inline", label: "行内拼接（译文 / 原文）" },
              { value: "separate", label: "分离双行（上下两条字幕）" },
            ]}
          />
          <p className="mt-1 text-xs text-text-muted">
            行内拼接：单条字幕显示「译文 / 原文」；分离双行：生成两条时间轴相同的字幕
          </p>
        </SettingsField>
      </SettingsSection>

      <SettingsSection
        title="默认目标语言"
        desc="新建视频会话时使用的翻译目标语言"
      >
        <SettingsField label="目标语言">
          <Select
            value={settings.defaultTargetLang}
            onChange={(v) => update("defaultTargetLang", v)}
            options={TARGET_LANGS}
          />
        </SettingsField>
      </SettingsSection>
    </div>
  );
}
