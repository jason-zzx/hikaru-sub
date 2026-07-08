import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAsrSetup,
  getAsrSetupProgress,
  getRuntimeDependencyProgress,
  prepareRuntimeDependency,
  probeAsrSetupEnvironment,
  probeRuntimeDependencies,
  startAsrSetup,
} from "../../services/tauri";
import {
  ASR_SETUP_PROFILE_LABEL,
  resolveAsrSetupProfile,
} from "../../constants/asrSetup";
import type { AsrSetupEnvironment, AsrSetupSnapshot } from "../../types";
import type { RuntimeDependencyProbe, RuntimeDependencySnapshot } from "../../types";
import { RuntimeDependencyDialog } from "./RuntimeDependencyDialog";
import { Button } from "../ui/button";

const POLL_INTERVAL_MS = 800;
const SOURCE_LABEL: Record<"official" | "china" | "custom", string> = {
  official: "官方源",
  china: "中国大陆镜像",
  custom: "自定义",
};

interface AsrEngineSetupPanelProps {
  engine: string;
  device: string;
  pythonPath?: string;
  asrServicePath?: string;
  refreshKey?: number;
  disabled?: boolean;
  onBeforeStart?: () => Promise<void>;
  onRunningChange?: (running: boolean) => void;
  onComplete?: () => void | Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function AsrEngineSetupPanel({
  engine,
  device,
  pythonPath,
  asrServicePath,
  refreshKey = 0,
  disabled = false,
  onBeforeStart,
  onRunningChange,
  onComplete,
}: AsrEngineSetupPanelProps) {
  const [env, setEnv] = useState<AsrSetupEnvironment | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AsrSetupSnapshot | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [recreate, setRecreate] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [runtimeProbe, setRuntimeProbe] = useState<RuntimeDependencyProbe | null>(null);
  const [dependencyDialogOpen, setDependencyDialogOpen] = useState(false);
  const [dependencySnapshot, setDependencySnapshot] =
    useState<RuntimeDependencySnapshot | null>(null);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const pollingRef = useRef(false);

  const refreshEnvironment = useCallback(async () => {
    try {
      const next = await probeAsrSetupEnvironment({
        pythonPath: pythonPath ?? null,
        asrServicePath: asrServicePath ?? null,
      });
      setEnv(next);
      setEnvError(null);
    } catch (e) {
      setEnv(null);
      setEnvError(String(e));
    }
  }, [asrServicePath, pythonPath]);

  useEffect(() => {
    void refreshEnvironment();
  }, [refreshEnvironment, engine, device, pythonPath, asrServicePath, refreshKey]);

  useEffect(() => {
    probeRuntimeDependencies()
      .then(setRuntimeProbe)
      .catch(() => setRuntimeProbe(null));
  }, [engine, device, pythonPath, asrServicePath]);

  useEffect(() => {
    onRunningChange?.(running);
  }, [onRunningChange, running]);

  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, []);

  const profile = useMemo(
    () => resolveAsrSetupProfile(engine, device, env),
    [engine, device, env],
  );

  const pollJob = async (id: string) => {
    pollingRef.current = true;
    try {
      while (pollingRef.current) {
        const next = await getAsrSetupProgress(id);
        setSnapshot(next);
        if (
          next.status === "completed" ||
          next.status === "failed" ||
          next.status === "cancelled"
        ) {
          pollingRef.current = false;
          setRunning(false);
          if (next.status === "completed") {
            setSetupError(null);
            await refreshEnvironment();
            try {
              await onComplete?.();
            } catch (e) {
              setSetupError(`刷新设置失败：${String(e)}`);
            }
          } else {
            setSetupError(next.error ?? "ASR 引擎依赖配置失败");
          }
          break;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (e) {
      if (pollingRef.current) {
        pollingRef.current = false;
        setRunning(false);
        setSetupError(`刷新配置进度失败：${String(e)}`);
      }
    }
  };

  const startSetupJob = async () => {
    try {
      const id = await startAsrSetup({
        profile,
        recreate,
        pythonPath: pythonPath ?? null,
        asrServicePath: asrServicePath ?? null,
      });
      setJobId(id);
      setRunning(true);
      void pollJob(id);
    } catch (e) {
      setSetupError(`启动配置失败：${String(e)}`);
      setRunning(false);
    }
  };

  const handleStart = async () => {
    setSetupError(null);
    setSnapshot(null);
    try {
      await onBeforeStart?.();
    } catch (e) {
      setSetupError(`保存当前设置失败：${String(e)}`);
      return;
    }
    if (env?.pythonOk === false) {
      try {
        const probe = await probeRuntimeDependencies();
        setRuntimeProbe(probe);
      } catch {
        setRuntimeProbe(null);
      }
      setDependencySnapshot(null);
      setDependencyError(null);
      setDependencyDialogOpen(true);
      return;
    }
    await startSetupJob();
  };

  const handlePreparePython = async () => {
    setDependencyError(null);
    setDependencySnapshot(null);
    try {
      const id = await prepareRuntimeDependency({ kind: "python311" });
      for (;;) {
        const next = await getRuntimeDependencyProgress(id);
        setDependencySnapshot(next);
        if (next.status === "completed") {
          setDependencyDialogOpen(false);
          await refreshEnvironment();
          try {
            const probe = await probeRuntimeDependencies();
            setRuntimeProbe(probe);
          } catch {
            setRuntimeProbe(null);
          }
          await startSetupJob();
          break;
        }
        if (next.status === "failed" || next.status === "cancelled") {
          setDependencyError(next.error ?? "Python 3.11 准备失败");
          break;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (e) {
      setDependencyError(`准备 Python 3.11 失败：${String(e)}`);
    }
  };

  const handleCancel = async () => {
    pollingRef.current = false;
    setRunning(false);
    if (!jobId) return;
    try {
      await cancelAsrSetup(jobId);
      const next = await getAsrSetupProgress(jobId);
      setSnapshot(next);
    } catch (e) {
      setSetupError(`取消配置失败：${String(e)}`);
    }
  };

  const progressPercent =
    snapshot?.progress === null || snapshot?.progress === undefined
      ? null
      : Math.round(snapshot.progress * 100);
  const canStart =
    !disabled &&
    !running &&
    !envError &&
    !!env?.serviceTemplatePath;
  const pythonItem = runtimeProbe?.items.find((item) => item.kind === "python311");
  const dependencyProgressPercent =
    dependencySnapshot?.progress === null || dependencySnapshot?.progress === undefined
      ? null
      : Math.round(dependencySnapshot.progress * 100);

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-text">ASR 引擎依赖</h4>
          <p className="mt-1 text-xs text-text-muted">
            当前将配置：{ASR_SETUP_PROFILE_LABEL[profile]}
          </p>
        </div>
        <Button
          type="button"
          onClick={running ? handleCancel : handleStart}
          disabled={running ? false : !canStart}
          className={`px-3 py-2 text-sm font-medium ${
            running
              ? "border border-danger/50 text-danger hover:bg-danger/10"
              : "hover:bg-accent-muted"
          }`}
        >
          {running ? "取消配置" : "配置当前引擎依赖"}
        </Button>
      </div>

      <div className="mt-3 flex flex-col gap-2 text-xs text-text-muted">
        {env ? (
          <>
            <span>
              Python：
              {env.pythonOk
                ? `${env.pythonVersion ?? "已检测"} · ${env.pythonPath ?? "自动检测"}`
                : "需要 Python 3.11，点击配置时会先下载受管 Python。"}
            </span>
            <span className="break-all">
              受管目录：{env.managedServicePath}
            </span>
            <span>
              虚拟环境：{env.venvExists ? "已存在" : "未创建"}
              {env.hasNvidiaGpu ? " · 已检测到 NVIDIA GPU" : ""}
            </span>
          </>
        ) : envError ? (
          <span className="text-danger">环境探测失败：{envError}</span>
        ) : (
          <span>检测 ASR 配置环境中…</span>
        )}
        {env && !env.serviceTemplatePath && (
          <span className="text-danger">
            未找到 ASR 服务模板，请确认安装包包含 asr-service 资源。
          </span>
        )}
        {env && !env.pythonOk && (
          <span className="text-warning">
            未检测到 Python 3.11；也可以在上方配置已有的 Python 3.11 路径。
          </span>
        )}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={recreate}
          disabled={running}
          onChange={(e) => setRecreate(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        <span>重建虚拟环境</span>
      </label>

      {snapshot && (
        <div className="mt-3 flex flex-col gap-2">
          <ProgressBar percent={progressPercent} />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-text-muted">{snapshot.stage}</span>
            {snapshot.status === "completed" && (
              <span className="text-success">引擎依赖配置完成</span>
            )}
            {snapshot.status === "failed" && (
              <span className="text-danger">
                配置失败：{snapshot.error ?? "未知错误"}
              </span>
            )}
            {snapshot.status === "cancelled" && (
              <span className="text-warning">配置已取消</span>
            )}
          </div>
        </div>
      )}

      {setupError && (
        <p className="mt-3 text-sm text-danger">{setupError}</p>
      )}

      {snapshot?.logTail?.length ? (
        <details className="mt-3 rounded-md border border-border bg-surface-raised">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-text">
            查看安装日志
          </summary>
          <pre className="max-h-52 overflow-auto border-t border-border px-3 py-2 text-xs leading-relaxed text-text-muted">
            {snapshot.logTail.join("\n")}
          </pre>
        </details>
      ) : null}

      <RuntimeDependencyDialog
        open={dependencyDialogOpen}
        kind="python311"
        reason="ASR 配置需要 Python 3.11。"
        sizeBytes={pythonItem?.sizeBytes ?? 0}
        targetPath={pythonItem?.path ?? "安装目录/deps/python311/current"}
        sourceLabel={
          runtimeProbe ? SOURCE_LABEL[runtimeProbe.effectiveSource] : "自动推荐"
        }
        status={
          dependencySnapshot?.status === "running" ||
          dependencySnapshot?.status === "pending"
            ? "running"
            : dependencySnapshot?.status === "completed"
              ? "completed"
              : dependencySnapshot?.status === "failed"
                ? "failed"
                : "idle"
        }
        progressPercent={dependencyProgressPercent}
        error={dependencyError}
        onConfirm={handlePreparePython}
        onCancel={() => setDependencyDialogOpen(false)}
        onChangeSource={() => setSetupError("请在设置页的运行时依赖区域更改下载源")}
      />
    </div>
  );
}

function ProgressBar({ percent }: { percent: number | null }) {
  const indeterminate = percent === null;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-overlay">
      <div
        className={`h-full rounded-full bg-accent transition-[width] duration-300 ${
          indeterminate ? "w-1/3 animate-pulse" : ""
        }`}
        style={indeterminate ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
