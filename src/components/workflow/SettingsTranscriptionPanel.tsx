import { Select } from "../ui/select-adapter";
import { ModelManager } from "./ModelManager";
import { SettingsField, SettingsSection } from "./settingsForm";
import { Button } from "../ui/button";
import type { AppSettings } from "../../types";
import { defaultAsrModel } from "../../constants/asr";
import { useAsrAvailability } from "../../hooks/useAsrAvailability";

interface SettingsTranscriptionPanelProps {
  settings: AppSettings;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function SettingsTranscriptionPanel({
  settings,
  update,
}: SettingsTranscriptionPanelProps) {
  const availability = useAsrAvailability(
    settings.asrEngine,
    settings.asrModel,
    settings.asrDevice,
  );

  const updateAsrEngine = (engine: string) => {
    update("asrEngine", engine);
    update("asrModel", defaultAsrModel(engine));
  };

  return (
    <SettingsSection
      title="日语转录（ASR）默认"
      desc="内置 Native CPU 运行时；模型按需下载，不可用路线保留显示"
    >
      <SettingsField label="引擎">
        <Select
          value={settings.asrEngine}
          onChange={updateAsrEngine}
          options={availability.engineOptions}
        />
      </SettingsField>
      <SettingsField label="模型">
        <Select
          value={settings.asrModel}
          onChange={(value) => update("asrModel", value)}
          options={availability.modelOptions}
        />
        <div className="mt-1.5">
          <ModelManager
            key={`${settings.asrEngine}:${settings.asrModel}`}
            engine={settings.asrEngine}
            model={settings.asrModel}
            status={availability.selectedModelStatus}
            checking={availability.modelLoading}
            checkError={availability.selectedModelError}
            refreshStatus={availability.refreshSelectedModel}
          />
        </div>
      </SettingsField>
      <SettingsField label="设备">
        <Select
          value={settings.asrDevice}
          onChange={(value) => update("asrDevice", value)}
          options={availability.deviceOptions}
        />
      </SettingsField>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className={availability.routeAvailable ? "text-success" : "text-warning"}>
          {availability.loading
            ? "正在检测 Native ASR 可用性…"
            : availability.routeAvailable
              ? "当前路线可用"
              : availability.unavailableReason || "当前路线不可用"}
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={() => void availability.refresh()}
          disabled={availability.loading}
          className="px-2.5 py-1 text-xs"
        >
          重新检测可用性
        </Button>
      </div>
    </SettingsSection>
  );
}
