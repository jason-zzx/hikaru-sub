import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import {
  clampProviderInteger,
  createTranslationProviderSettings,
  TRANSLATION_API_DEFAULT_URLS,
  TRANSLATION_API_TYPES,
  TRANSLATION_PROVIDER_LIMITS,
} from "@/constants/translationProviders";
import { createTranslationProvider } from "@/services/translation";
import type {
  TranslationApiType,
  TranslationProviderSettings,
} from "@/types";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/input";
import { Select } from "../ui/select-adapter";
import { SettingsField, SettingsSection } from "./settingsForm";

interface SettingsProvidersPanelProps {
  providers: TranslationProviderSettings[];
  defaultProviderId?: string;
  onChange: (
    providers: TranslationProviderSettings[],
    defaultProviderId?: string,
  ) => void;
}

export function changeProviderApiType(
  provider: TranslationProviderSettings,
  apiType: TranslationApiType,
): TranslationProviderSettings {
  return {
    ...provider,
    apiType,
    baseUrl: TRANSLATION_API_DEFAULT_URLS[apiType],
    model: "",
  };
}

export function deleteProvider(
  providers: TranslationProviderSettings[],
  defaultProviderId: string | undefined,
  providerId: string,
): {
  providers: TranslationProviderSettings[];
  defaultProviderId?: string;
} {
  const remaining = providers.filter((provider) => provider.id !== providerId);
  return {
    providers: remaining,
    defaultProviderId:
      remaining.length === 0
        ? undefined
        : defaultProviderId === providerId ||
            !remaining.some((provider) => provider.id === defaultProviderId)
          ? remaining[0].id
          : defaultProviderId,
  };
}

export function SettingsProvidersPanel({
  providers,
  defaultProviderId,
  onChange,
}: SettingsProvidersPanelProps) {
  const [selectedId, setSelectedId] = useState(
    defaultProviderId ?? providers[0]?.id ?? "",
  );
  const [modelCandidates, setModelCandidates] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const modelRequestIdRef = useRef(0);

  const selected = providers.find((provider) => provider.id === selectedId);

  const resetModelDiscovery = () => {
    modelRequestIdRef.current += 1;
    setModelCandidates([]);
    setModelsLoading(false);
    setModelsError(null);
  };

  useEffect(() => {
    if (selected || providers.length === 0) return;
    resetModelDiscovery();
    setSelectedId(
      providers.find((provider) => provider.id === defaultProviderId)?.id ??
        providers[0].id,
    );
  }, [defaultProviderId, providers, selected]);

  const updateSelected = (patch: Partial<TranslationProviderSettings>) => {
    if (!selected) return;
    if ("baseUrl" in patch || "apiKey" in patch) resetModelDiscovery();
    onChange(
      providers.map((provider) =>
        provider.id === selected.id ? { ...provider, ...patch } : provider,
      ),
      defaultProviderId,
    );
  };

  const handleAdd = () => {
    const provider = createTranslationProviderSettings();
    onChange(
      [...providers, provider],
      defaultProviderId ?? provider.id,
    );
    setSelectedId(provider.id);
    resetModelDiscovery();
  };

  const handleApiTypeChange = (value: string) => {
    if (!selected) return;
    const next = changeProviderApiType(selected, value as TranslationApiType);
    onChange(
      providers.map((provider) =>
        provider.id === selected.id ? next : provider,
      ),
      defaultProviderId,
    );
    resetModelDiscovery();
  };

  const handleFetchModels = async () => {
    if (!selected?.baseUrl.trim() || !selected.apiKey.trim()) return;
    const requestId = ++modelRequestIdRef.current;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const provider = createTranslationProvider({
        apiType: selected.apiType,
        baseUrl: selected.baseUrl,
        apiKey: selected.apiKey,
        model: selected.model,
        maxConcurrency: selected.maxConcurrency,
        requestsPerMinute: selected.requestsPerMinute,
      });
      const models = await provider.listModels();
      if (requestId === modelRequestIdRef.current) setModelCandidates(models);
    } catch (error) {
      if (requestId === modelRequestIdRef.current) {
        setModelsError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestId === modelRequestIdRef.current) setModelsLoading(false);
    }
  };

  const confirmDelete = () => {
    if (!selected) return;
    const next = deleteProvider(providers, defaultProviderId, selected.id);
    onChange(next.providers, next.defaultProviderId);
    setSelectedId(next.providers[0]?.id ?? "");
    resetModelDiscovery();
    setDeleteOpen(false);
  };

  return (
    <SettingsSection
      title="翻译供应商"
      desc="API Key 必填且仅以明文保存在本机 settings.json 中；清空后保存会使供应商不可用"
    >
      <div className="grid min-h-[420px] grid-cols-1 overflow-hidden rounded-lg border border-border md:grid-cols-[minmax(160px,0.7fr)_minmax(0,1.5fr)]">
        <div className="flex min-w-0 flex-col border-b border-border bg-surface/40 md:border-r md:border-b-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2">
            <span className="text-xs font-medium text-text-muted">供应商列表</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="新增供应商"
              aria-label="新增供应商"
              onClick={handleAdd}
            >
              <Plus />
            </Button>
          </div>
          <div className="flex max-h-48 min-h-0 flex-1 flex-col gap-1 overflow-auto p-2 md:max-h-none">
            {providers.map((provider) => {
              const active = provider.id === selectedId;
              return (
                <Button
                  key={provider.id}
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  className="h-auto min-w-0 justify-start px-2 py-2 text-left"
                  onClick={() => {
                    setSelectedId(provider.id);
                    resetModelDiscovery();
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {provider.name.trim() || "未命名供应商"}
                  </span>
                  {provider.id === defaultProviderId ? (
                    <Star className="size-3.5 fill-current text-primary" />
                  ) : null}
                </Button>
              );
            })}
            {providers.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-text-muted">
                暂无供应商
              </p>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 overflow-auto p-4">
          {selected ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {selected.name.trim() || "未命名供应商"}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={selected.id === defaultProviderId}
                    onClick={() => onChange(providers, selected.id)}
                  >
                    <Star />
                    {selected.id === defaultProviderId ? "默认供应商" : "设为默认"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    title="删除供应商"
                    aria-label="删除供应商"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <SettingsField label="名称">
                <Input
                  aria-label="名称"
                  value={selected.name}
                  placeholder="例如：OpenAI"
                  onChange={(event) => updateSelected({ name: event.target.value })}
                />
              </SettingsField>
              <SettingsField label="API 类型">
                <Select
                  value={selected.apiType}
                  onChange={handleApiTypeChange}
                  options={TRANSLATION_API_TYPES}
                />
              </SettingsField>
              <SettingsField label="Base URL">
                <Input
                  aria-label="Base URL"
                  value={selected.baseUrl}
                  placeholder={TRANSLATION_API_DEFAULT_URLS[selected.apiType]}
                  onChange={(event) =>
                    updateSelected({ baseUrl: event.target.value })
                  }
                />
              </SettingsField>
              <SettingsField label="API Key">
                <Input
                  aria-label="API Key"
                  type="password"
                  value={selected.apiKey}
                  autoComplete="off"
                  placeholder="输入 API Key"
                  onChange={(event) =>
                    updateSelected({ apiKey: event.target.value })
                  }
                />
              </SettingsField>
              <SettingsField label="模型">
                <div className="flex gap-2">
                  <Input
                    aria-label="模型"
                    value={selected.model}
                    placeholder="输入模型名称"
                    onChange={(event) =>
                      updateSelected({ model: event.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      modelsLoading ||
                      !selected.baseUrl.trim() ||
                      !selected.apiKey.trim()
                    }
                    onClick={() => void handleFetchModels()}
                  >
                    <RefreshCw className={modelsLoading ? "animate-spin" : ""} />
                    {modelsLoading ? "获取中" : "获取模型"}
                  </Button>
                </div>
                {modelCandidates.length > 0 ? (
                  <Select
                    value={modelCandidates.includes(selected.model) ? selected.model : ""}
                    onChange={(model) => updateSelected({ model })}
                    options={modelCandidates.map((model) => ({
                      value: model,
                      label: model,
                    }))}
                    placeholder="选择获取到的模型"
                  />
                ) : null}
                {modelsError ? (
                  <p className="break-words text-xs text-danger">{modelsError}</p>
                ) : null}
              </SettingsField>

              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="最大并发数">
                  <Input
                    aria-label="最大并发数"
                    type="number"
                    min={TRANSLATION_PROVIDER_LIMITS.maxConcurrency.min}
                    max={TRANSLATION_PROVIDER_LIMITS.maxConcurrency.max}
                    value={selected.maxConcurrency}
                    onChange={(event) =>
                      updateSelected({
                        maxConcurrency: clampProviderInteger(
                          Number(event.target.value),
                          TRANSLATION_PROVIDER_LIMITS.maxConcurrency,
                        ),
                      })
                    }
                  />
                  <p className="text-xs text-text-muted">范围：1-50</p>
                </SettingsField>
                <SettingsField label="每分钟请求数（RPM）">
                  <Input
                    aria-label="每分钟请求数（RPM）"
                    type="number"
                    min={TRANSLATION_PROVIDER_LIMITS.requestsPerMinute.min}
                    max={TRANSLATION_PROVIDER_LIMITS.requestsPerMinute.max}
                    value={selected.requestsPerMinute}
                    onChange={(event) =>
                      updateSelected({
                        requestsPerMinute: clampProviderInteger(
                          Number(event.target.value),
                          TRANSLATION_PROVIDER_LIMITS.requestsPerMinute,
                        ),
                      })
                    }
                  />
                  <p className="text-xs text-text-muted">范围：1-100</p>
                </SettingsField>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-48 items-center justify-center text-sm text-text-muted">
              新增供应商后可配置连接信息
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="删除供应商"
        description={`确认删除「${selected?.name.trim() || "未命名供应商"}」？`}
        escValue="cancel"
        options={[
          { label: "取消", value: "cancel" },
          { label: "删除", value: "delete", variant: "danger" },
        ]}
        onSelect={(value) => {
          if (value === "delete") confirmDelete();
          else setDeleteOpen(false);
        }}
      />
    </SettingsSection>
  );
}
