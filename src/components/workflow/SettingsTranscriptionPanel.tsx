import { Select } from "../ui/select-adapter";
import { AsrEngineSetupPanel } from "./AsrEngineSetupPanel";
import { ModelManager } from "./ModelManager";
import { SettingsField, SettingsSection } from "./settingsForm";
import type { AppSettings } from "../../types";
import {
  ASR_ENGINE_OPTIONS,
  KOTOBA_FASTER_WHISPER_DESCRIPTION,
  asrModelOptions,
  defaultAsrModel,
} from "../../constants/asr";

const ASR_DEVICES = [
  { value: "auto", label: "自动" },
  { value: "cpu", label: "CPU" },
  { value: "cuda", label: "CUDA（NVIDIA GPU）" },
];

interface SettingsTranscriptionPanelProps {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  asrSetupRefreshKey: number;
  saving: boolean;
  onBeforeAsrSetupStart: () => Promise<void>;
  onAsrSetupRunningChange: (running: boolean) => void;
  onAsrSetupComplete: () => void | Promise<void>;
}

export function SettingsTranscriptionPanel({
  settings,
  update,
  asrSetupRefreshKey,
  saving,
  onBeforeAsrSetupStart,
  onAsrSetupRunningChange,
  onAsrSetupComplete,
}: SettingsTranscriptionPanelProps) {
  const updateAsrEngine = (engine: string) => {
    update("asrEngine", engine);
    update("asrModel", defaultAsrModel(engine));
  };

  return (
    <SettingsSection
      title="日语转录（ASR）默认"
      desc="新建视频会话时使用的默认转录配置（源语言固定为日语）"
    >
      <SettingsField label="引擎">
        <Select
          value={settings.asrEngine}
          onChange={updateAsrEngine}
          options={ASR_ENGINE_OPTIONS}
        />
      </SettingsField>
      <SettingsField label="模型">
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
      </SettingsField>
      <SettingsField label="设备">
        <Select
          value={settings.asrDevice}
          onChange={(v) => update("asrDevice", v)}
          options={ASR_DEVICES}
        />
      </SettingsField>
      <AsrEngineSetupPanel
        engine={settings.asrEngine}
        device={settings.asrDevice}
        pythonPath={settings.pythonPath}
        asrServicePath={settings.asrServicePath}
        refreshKey={asrSetupRefreshKey}
        disabled={saving}
        onBeforeStart={onBeforeAsrSetupStart}
        onRunningChange={onAsrSetupRunningChange}
        onComplete={onAsrSetupComplete}
      />
    </SettingsSection>
  );
}
