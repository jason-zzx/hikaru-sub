import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASR_DEVICE_OPTIONS,
  ASR_ENGINE_OPTIONS,
  asrModelOptions,
} from "../constants/asr";
import { checkAsrModel, listAsrEngines } from "../services/tauri";
import type {
  AsrDeviceCapability,
  AsrEngineInfo,
  AsrModelStatus,
} from "../types";
import type { SelectOption } from "../components/ui/select-adapter";

export type AsrModelRefreshOutcome =
  | { kind: "ok"; status: AsrModelStatus }
  | { kind: "error"; error: string }
  | { kind: "aborted" };

type ModelAvailabilityState = {
  engine: string;
  loading: boolean;
  statuses: Record<string, AsrModelStatus>;
  errors: Record<string, string>;
};

function optionLabel(label: string, reason: string): string {
  return `${label}（${reason}）`;
}

function unavailableReason(
  status: AsrModelStatus,
): { unavailable: boolean; reason: string } {
  switch (status.disposition) {
    case "ready":
    case "supportedMissing":
      return { unavailable: false, reason: "" };
    case "postMvpUnavailable":
      return {
        unavailable: true,
        reason: status.reason?.trim() || "后续版本支持",
      };
    case "unsupported":
      return {
        unavailable: true,
        reason: status.reason?.trim() || "当前版本不支持",
      };
    default:
      return {
        unavailable: !status.available,
        reason: status.reason?.trim() || "当前路线不可用",
      };
  }
}

export function asrEngineSelectOptions(
  engines: AsrEngineInfo[] | null,
  error: string | null,
): SelectOption[] {
  return ASR_ENGINE_OPTIONS.map((option) => {
    const engine = engines?.find((item) => item.name === option.value);
    const reason = error
      ? "检测失败"
      : engines === null
        ? "检测中"
        : !engine
          ? "当前版本不可用"
          : engine.available
            ? null
            : engine.reason?.trim() || "当前版本不可用";
    return reason
      ? { ...option, label: optionLabel(option.label, reason), disabled: true }
      : option;
  });
}

export function asrModelSelectOptions(
  engine: string,
  state: ModelAvailabilityState,
): SelectOption[] {
  return asrModelOptions(engine).map((option) => {
    const status = state.engine === engine ? state.statuses[option.value] : undefined;
    const error = state.engine === engine ? state.errors[option.value] : undefined;
    if (error) {
      return {
        ...option,
        label: optionLabel(option.label, "检测失败"),
        disabled: true,
      };
    }
    if (!status) {
      return {
        ...option,
        label: optionLabel(option.label, "检测中"),
        disabled: true,
      };
    }
    const projected = unavailableReason(status);
    return projected.unavailable
      ? {
          ...option,
          label: optionLabel(option.label, projected.reason),
          disabled: true,
        }
      : option;
  });
}

function deviceCapability(
  engine: AsrEngineInfo | null,
  device: string,
): AsrDeviceCapability | null {
  if (!engine?.available) return null;
  if (device === "auto") {
    return engine.devices?.find((item) => item.device === "cpu") ?? {
      device: "cpu",
      available: engine.device?.toLowerCase() === "cpu",
    };
  }
  const explicit = engine.devices?.find((item) => item.device === device);
  if (explicit) return explicit;
  return {
    device: device === "cuda" ? "cuda" : "cpu",
    available: engine.device?.toLowerCase() === device,
    reason: device === "cuda" ? "后续版本支持" : "当前设备不可用",
  };
}

export function asrDeviceSelectOptions(
  engine: AsrEngineInfo | null,
  loading: boolean,
  error: string | null,
): SelectOption[] {
  return ASR_DEVICE_OPTIONS.map((option) => {
    const capability = deviceCapability(engine, option.value);
    const reason = error
      ? "检测失败"
      : loading
        ? "检测中"
        : !engine?.available
          ? engine?.reason?.trim() || "当前引擎不可用"
          : capability?.available
            ? null
            : capability?.downloadRequired
              ? capability.reason?.trim() || "需下载 CUDA 运行时"
              : capability?.reason?.trim() || "当前设备不可用";
    return reason
      ? {
          ...option,
          label: optionLabel(option.label, reason),
          disabled: !capability?.downloadRequired,
        }
      : option;
  });
}

function modelRouteAvailable(status: AsrModelStatus | null): boolean {
  if (!status) return false;
  if (status.disposition) {
    return status.disposition === "ready" || status.disposition === "supportedMissing";
  }
  return status.available;
}

export interface AsrAvailabilityRefreshOutcome {
  routeAvailable: boolean;
  unavailableReason: string | null;
  deviceDownloadRequired: boolean;
}

function projectFreshRoute(
  selectedEngine: AsrEngineInfo | null,
  selectedModelStatus: AsrModelStatus | null,
  selectedModelError: string | null,
  device: string,
): AsrAvailabilityRefreshOutcome {
  const capability = deviceCapability(selectedEngine, device);
  const deviceAvailable = !!selectedEngine?.available && !!capability?.available;
  const deviceDownloadRequired =
    device === "cuda" && !!capability?.downloadRequired;
  let unavailableReason: string | null = null;
  if (!selectedEngine?.available) {
    unavailableReason =
      selectedEngine?.reason?.trim() || "当前引擎在此版本不可用";
  } else if (selectedModelError) {
    unavailableReason = `模型可用性检测失败：${selectedModelError}`;
  } else if (!modelRouteAvailable(selectedModelStatus)) {
    unavailableReason =
      selectedModelStatus?.reason?.trim() || "当前模型在此版本不可用";
  } else if (!deviceAvailable && !deviceDownloadRequired) {
    unavailableReason = capability?.reason?.trim() || "当前设备不可用";
  }
  return {
    routeAvailable:
      !!selectedEngine?.available &&
      !selectedModelError &&
      modelRouteAvailable(selectedModelStatus) &&
      (deviceAvailable || deviceDownloadRequired),
    unavailableReason,
    deviceDownloadRequired,
  };
}

export function useAsrAvailability(engine: string, model: string, device: string) {
  const activeEngineRef = useRef(engine);
  activeEngineRef.current = engine;
  const activeModelRef = useRef(model);
  activeModelRef.current = model;
  const engineRequestRef = useRef(0);
  const modelRequestRef = useRef(0);
  const [engines, setEngines] = useState<AsrEngineInfo[] | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<ModelAvailabilityState>({
    engine,
    loading: true,
    statuses: {},
    errors: {},
  });

  const refreshEngines = useCallback(async (): Promise<AsrEngineInfo[] | null> => {
    const requestId = ++engineRequestRef.current;
    setEngineLoading(true);
    setEngineError(null);
    try {
      const next = await listAsrEngines();
      if (engineRequestRef.current !== requestId) return null;
      setEngines(next);
      return next;
    } catch (error) {
      if (engineRequestRef.current !== requestId) return null;
      setEngines(null);
      setEngineError(String(error));
      return null;
    } finally {
      if (engineRequestRef.current === requestId) setEngineLoading(false);
    }
  }, []);

  const refreshModels = useCallback(async (
    requestedEngine: string,
    selectedModel: string,
  ): Promise<ModelAvailabilityState | null> => {
    const requestId = ++modelRequestRef.current;
    const models = asrModelOptions(requestedEngine).map((option) => option.value);
    if (!models.includes(selectedModel)) models.push(selectedModel);
    setModelState((current) => ({
      engine: requestedEngine,
      loading: true,
      statuses: current.engine === requestedEngine ? current.statuses : {},
      errors: {},
    }));
    const results = await Promise.all(
      models.map(async (currentModel) => {
        try {
          return {
            model: currentModel,
            status: await checkAsrModel(requestedEngine, currentModel),
          };
        } catch (error) {
          return { model: currentModel, error: String(error) };
        }
      }),
    );
    if (
      modelRequestRef.current !== requestId ||
      activeEngineRef.current !== requestedEngine
    ) {
      return null;
    }
    const statuses: Record<string, AsrModelStatus> = {};
    const errors: Record<string, string> = {};
    for (const result of results) {
      if (result.status) statuses[result.model] = result.status;
      if (result.error) errors[result.model] = result.error;
    }
    const nextState = {
      engine: requestedEngine,
      loading: false,
      statuses,
      errors,
    };
    setModelState(nextState);
    return nextState;
  }, []);

  const refreshSelectedModel = useCallback(async (): Promise<AsrModelRefreshOutcome> => {
    const requestedEngine = engine;
    const requestedModel = model;
    const requestId = ++modelRequestRef.current;
    setModelState((current) => ({
      engine: requestedEngine,
      loading: true,
      statuses: current.engine === requestedEngine ? current.statuses : {},
      errors: current.engine === requestedEngine ? current.errors : {},
    }));
    try {
      const status = await checkAsrModel(requestedEngine, requestedModel);
      if (
        modelRequestRef.current !== requestId ||
        activeEngineRef.current !== requestedEngine
      ) {
        return { kind: "aborted" };
      }
      setModelState((current) => ({
        engine: requestedEngine,
        loading: false,
        statuses: { ...current.statuses, [requestedModel]: status },
        errors: Object.fromEntries(
          Object.entries(current.errors).filter(([key]) => key !== requestedModel),
        ),
      }));
      return { kind: "ok", status };
    } catch (error) {
      if (
        modelRequestRef.current !== requestId ||
        activeEngineRef.current !== requestedEngine
      ) {
        return { kind: "aborted" };
      }
      const message = String(error);
      setModelState((current) => {
        const statuses = { ...current.statuses };
        delete statuses[requestedModel];
        return {
          engine: requestedEngine,
          loading: false,
          statuses,
          errors: { ...current.errors, [requestedModel]: message },
        };
      });
      return { kind: "error", error: message };
    }
  }, [engine, model]);

  useEffect(() => {
    void refreshEngines();
  }, [refreshEngines]);

  useEffect(() => {
    void refreshModels(engine, activeModelRef.current);
  }, [engine, refreshModels]);

  useEffect(() => {
    if (modelState.engine !== engine || modelState.loading) return;
    if (modelState.statuses[model] || modelState.errors[model]) return;
    void refreshSelectedModel();
  }, [engine, model, modelState, refreshSelectedModel]);

  useEffect(
    () => () => {
      engineRequestRef.current += 1;
      modelRequestRef.current += 1;
    },
    [],
  );

  const selectedEngine = engines?.find((item) => item.name === engine) ?? null;
  const currentModelState = modelState.engine === engine ? modelState : null;
  const selectedModelStatus = currentModelState?.statuses[model] ?? null;
  const selectedModelError = currentModelState?.errors[model] ?? null;
  const modelLoading = !currentModelState || currentModelState.loading;
  const engineOptions = useMemo(
    () => asrEngineSelectOptions(engines, engineError),
    [engineError, engines],
  );
  const modelOptions = useMemo(
    () => asrModelSelectOptions(engine, modelState),
    [engine, modelState],
  );
  const deviceOptions = useMemo(
    () => asrDeviceSelectOptions(selectedEngine, engineLoading, engineError),
    [engineError, engineLoading, selectedEngine],
  );

  const selectedDeviceCapability = deviceCapability(selectedEngine, device);
  const deviceAvailable =
    ASR_DEVICE_OPTIONS.some((option) => option.value === device) &&
    !!selectedEngine?.available &&
    !!selectedDeviceCapability?.available;
  const deviceDownloadRequired =
    device === "cuda" && !!selectedDeviceCapability?.downloadRequired;

  const loading = engineLoading || modelLoading;
  const error = engineError || selectedModelError;
  let unavailableReasonText: string | null = null;
  if (engineError) {
    unavailableReasonText = `引擎可用性检测失败：${engineError}`;
  } else if (!engineLoading && !selectedEngine?.available) {
    unavailableReasonText =
      selectedEngine?.reason?.trim() || "当前引擎在此版本不可用";
  } else if (selectedModelError) {
    unavailableReasonText = `模型可用性检测失败：${selectedModelError}`;
  } else if (!modelLoading && !modelRouteAvailable(selectedModelStatus)) {
    unavailableReasonText =
      selectedModelStatus?.reason?.trim() || "当前模型在此版本不可用";
  } else if (!engineLoading && !deviceAvailable && !deviceDownloadRequired) {
    unavailableReasonText =
      selectedDeviceCapability?.reason?.trim() || "当前设备不可用";
  }

  const refresh = useCallback(async (): Promise<AsrAvailabilityRefreshOutcome> => {
    const requestedEngine = engine;
    const requestedModel = model;
    const [nextEngines, nextModelState] = await Promise.all([
      refreshEngines(),
      refreshModels(requestedEngine, requestedModel),
    ]);
    if (
      !nextEngines ||
      !nextModelState ||
      activeEngineRef.current !== requestedEngine ||
      activeModelRef.current !== requestedModel
    ) {
      return {
        routeAvailable: false,
        unavailableReason: "转录设置已变化，请重新开始。",
        deviceDownloadRequired: false,
      };
    }
    const nextEngine =
      nextEngines.find((item) => item.name === requestedEngine) ?? null;
    return projectFreshRoute(
      nextEngine,
      nextModelState.statuses[requestedModel] ?? null,
      nextModelState.errors[requestedModel] ?? null,
      device,
    );
  }, [device, engine, model, refreshEngines, refreshModels]);

  return {
    engines,
    selectedEngine,
    selectedModelStatus,
    selectedModelError,
    engineLoading,
    modelLoading,
    loading,
    error,
    routeAvailable:
      !loading &&
      !error &&
      !!selectedEngine?.available &&
      modelRouteAvailable(selectedModelStatus) &&
      (deviceAvailable || deviceDownloadRequired),
    unavailableReason: unavailableReasonText,
    selectedDeviceCapability,
    deviceDownloadRequired,
    engineOptions,
    modelOptions,
    deviceOptions,
    refresh,
    refreshSelectedModel,
  };
}
