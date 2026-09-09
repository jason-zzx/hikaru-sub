import { useCallback, useEffect, useRef, useState } from "react";
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
  const [open, setOpenState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const afterPrepareRef = useRef<(() => void | Promise<void>) | null>(null);
  const generationRef = useRef(0);
  const busyRef = useRef(false);

  const setOpen = useCallback((next: boolean) => {
    if (!next) {
      generationRef.current += 1;
      afterPrepareRef.current = null;
      busyRef.current = false;
      setPreparing(false);
    }
    setOpenState(next);
  }, []);

  useEffect(() => {
    setOpen(false);
    setProbe(null);
    setSnapshot(null);
    setError(null);
    return () => {
      generationRef.current += 1;
      afterPrepareRef.current = null;
      busyRef.current = false;
    };
  }, [kind, setOpen]);

  const refreshProbe = useCallback(async () => {
    const generation = generationRef.current;
    const next = await probeRuntimeDependencies();
    if (generation === generationRef.current) setProbe(next);
    return next;
  }, []);

  const requestDependency = useCallback(
    async (afterPrepare?: () => void | Promise<void>) => {
      if (busyRef.current) return false;
      busyRef.current = true;
      const generation = ++generationRef.current;
      afterPrepareRef.current = afterPrepare ?? null;
      setProbe(null);
      setSnapshot(null);
      setError(null);
      // The shared probe can verify other runtimes too; show feedback before awaiting it.
      setOpenState(true);
      try {
        const next = await refreshProbe();
        if (generation !== generationRef.current) return false;
        const item = next.items.find((entry) => entry.kind === kind);
        if (item?.status === "available") {
          afterPrepareRef.current = null;
          setOpenState(false);
          await afterPrepare?.();
          return true;
        }
        if (!item?.expectedDownloadBytes) {
          setError("当前运行时依赖不可下载，请重新检测可用性。");
        }
        return false;
      } catch {
        if (generation === generationRef.current) {
          setError("运行时依赖检测失败，请关闭后重试。");
        }
        return false;
      } finally {
        if (generation === generationRef.current) busyRef.current = false;
      }
    },
    [kind, refreshProbe],
  );

  const confirmPrepare = useCallback(async () => {
    if (busyRef.current || !open || !probe?.items.find((entry) => entry.kind === kind)?.expectedDownloadBytes) return false;
    busyRef.current = true;
    const generation = generationRef.current;
    setPreparing(true);
    setError(null);
    setSnapshot(null);
    try {
      const jobId = await prepareRuntimeDependency({ kind });
      while (generation === generationRef.current) {
        const next = await getRuntimeDependencyProgress(jobId);
        if (generation !== generationRef.current) return false;
        setSnapshot(next);
        if (next.status === "completed") {
          const refreshed = await refreshProbe();
          if (generation !== generationRef.current) return false;
          if (refreshed.items.find((entry) => entry.kind === kind)?.status !== "available") {
            setError("运行时依赖准备后仍不可用，请重试。");
            return false;
          }
          const afterPrepare = afterPrepareRef.current;
          afterPrepareRef.current = null;
          setOpenState(false);
          await afterPrepare?.();
          return true;
        }
        if (next.status === "failed" || next.status === "cancelled") {
          setError("运行时依赖准备失败，请重试。");
          return false;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      return false;
    } catch {
      if (generation === generationRef.current) {
        setError("运行时依赖准备失败，请重试。");
      }
      return false;
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
        setPreparing(false);
      }
    }
  }, [kind, open, probe, refreshProbe]);

  const item = probe?.items.find((entry) => entry.kind === kind);
  const progressPercent =
    snapshot?.progress === null || snapshot?.progress === undefined
      ? null
      : Math.round(snapshot.progress * 100);

  return {
    error,
    item,
    open,
    preparing,
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
