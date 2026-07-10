import { useCallback, useRef, useState } from "react";
import {
  getRuntimeDependencyProgress,
  prepareRuntimeDependency,
  probeRuntimeDependencies,
} from "../services/tauri";
import type {
  RuntimeDependencyKind,
  RuntimeDependencyProbe,
  RuntimeDependencySnapshot,
} from "../types";
import { RUNTIME_SOURCE_MODE_LABEL } from "../constants/runtimeDependencies";

const POLL_INTERVAL_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useRuntimeDependencyPreparation(kind: RuntimeDependencyKind) {
  const [probe, setProbe] = useState<RuntimeDependencyProbe | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeDependencySnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const afterPrepareRef = useRef<(() => void | Promise<void>) | null>(null);

  const refreshProbe = useCallback(async () => {
    const next = await probeRuntimeDependencies();
    setProbe(next);
    return next;
  }, []);

  const requestDependency = useCallback(
    async (afterPrepare?: () => void | Promise<void>) => {
      const next = await refreshProbe();
      const item = next.items.find((entry) => entry.kind === kind);
      if (item?.status === "available") return true;
      afterPrepareRef.current = afterPrepare ?? null;
      setSnapshot(null);
      setError(null);
      setOpen(true);
      return false;
    },
    [kind, refreshProbe],
  );

  const confirmPrepare = useCallback(async () => {
    setError(null);
    setSnapshot(null);
    try {
      const jobId = await prepareRuntimeDependency({ kind });
      for (;;) {
        const next = await getRuntimeDependencyProgress(jobId);
        setSnapshot(next);
        if (next.status === "completed") {
          setOpen(false);
          await refreshProbe();
          await afterPrepareRef.current?.();
          afterPrepareRef.current = null;
          return true;
        }
        if (next.status === "failed" || next.status === "cancelled") {
          setError(next.error ?? "运行时依赖准备失败");
          return false;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (e) {
      setError(`运行时依赖准备失败：${String(e)}`);
      return false;
    }
  }, [kind, refreshProbe]);

  const item = probe?.items.find((entry) => entry.kind === kind);
  const progressPercent =
    snapshot?.progress === null || snapshot?.progress === undefined
      ? null
      : Math.round(snapshot.progress * 100);

  return {
    error,
    item,
    open,
    progressPercent,
    probe,
    requestDependency,
    setOpen,
    snapshot,
    sourceLabel: probe
      ? RUNTIME_SOURCE_MODE_LABEL[probe.sourceMode]
      : RUNTIME_SOURCE_MODE_LABEL.official,
    confirmPrepare,
    refreshProbe,
  };
}
