import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDefaultDocument,
  PRIMARY_STYLE,
  mergeShortCues,
  segmentsToCues,
  serializeAss,
} from "@hikaru/ass-core";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { IconCheck } from "../layout/NavIcons";
import { Button } from "../ui/button";
import { Select } from "../ui/select-adapter";
import { ModelManager } from "./ModelManager";
import {
  ASR_ENGINE_OPTIONS,
  KOTOBA_FASTER_WHISPER_DESCRIPTION,
  asrModelOptions,
  defaultAsrModel,
} from "../../constants/asr";
import {
  cancelAsr,
  checkFfmpeg,
  deleteCachedAudio,
  extractAudio,
  getAsrProgress,
  getSettings,
  getVideoInfo,
  invalidateFfmpegStatus,
  listAsrEngines,
  onAudioExtractProgress,
  pathExists,
  saveAssText,
  startAsr,
} from "../../services/tauri";
import type {
  AsrEngineInfo,
  AsrJobSnapshot,
  FfmpegStatus,
  VadConfig,
} from "../../types";
import { useRuntimeDependencyPreparation } from "../../hooks/useRuntimeDependencyPreparation";
import {
  ASR_ENGINE_NOT_INSTALLED_HINT,
  ASR_ENGINE_NOT_INSTALLED_LABEL,
  isAsrEngineNotInstalledError,
  isSelectedAsrEngineUnavailable,
} from "../../utils/asrSidecarError";
import { RuntimeDependencyDialog } from "./RuntimeDependencyDialog";

const ASR_DEVICES = [
  { value: "auto", label: "自动" },
  { value: "cpu", label: "CPU" },
  { value: "cuda", label: "CUDA（NVIDIA GPU）" },
];
const ASR_POLL_INTERVAL_MS = 700;
const ASR_PROGRESS_RETRY_LIMIT = 90;
const ASR_PROGRESS_RETRY_MAX_DELAY_MS = 3000;

const VAD_INPUT_CLASS =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

const DEFAULT_VAD_CONFIG: Required<VadConfig> = {
  threshold: 0.5,
  minSpeechDurationMs: 500,
  minSilenceDurationMs: 300,
  speechPadMs: 400,
  maxSegmentDurationMs: 25000,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function progressRetryDelay(attempt: number): number {
  return Math.min(ASR_PROGRESS_RETRY_MAX_DELAY_MS, ASR_POLL_INTERVAL_MS + attempt * 200);
}

function isMissingJobError(message: string): boolean {
  return message.includes("转录任务不存在") || message.includes("HTTP 404");
}

function formatMs(ms: number): string {
  if (!ms || ms < 0) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TranscribeView() {
  const setStep = useUiStore((s) => s.setStep);
  const session = useProjectStore((s) => s.session);
  const setCues = useProjectStore((s) => s.setCues);
  const setAssMetadata = useProjectStore((s) => s.setAssMetadata);
  const setActiveSubtitle = useProjectStore((s) => s.setActiveSubtitle);
  const markSaved = useProjectStore((s) => s.markSaved);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const ffmpegPreparation = useRuntimeDependencyPreparation("ffmpeg");

  // 音轨提取
  const [audioReady, setAudioReady] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractPercent, setExtractPercent] = useState<number | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // ASR 配置
  const [engine, setEngine] = useState("faster-whisper");
  const [model, setModel] = useState("large-v3");
  const [device, setDevice] = useState("auto");
  const [engines, setEngines] = useState<AsrEngineInfo[] | null>(null);
  const [engineMsg, setEngineMsg] = useState<string | null>("未检测");
  const [sidecarEngineMissing, setSidecarEngineMissing] = useState(false);
  const [modelCheckTrigger, setModelCheckTrigger] = useState(0);

  // VAD 语音检测预处理配置（仅当前会话有效，不写入项目/全局设置）
  const [useVad, setUseVad] = useState(false);
  const [vadConfig, setVadConfig] = useState<VadConfig>({});

  // 转录任务
  const [transcribing, setTranscribing] = useState(false);
  const [job, setJob] = useState<AsrJobSnapshot | null>(null);
  const [asrError, setAsrError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [savedAssPath, setSavedAssPath] = useState<string | null>(null);

  const pollingRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const engineCheckRequestRef = useRef(0);

  const refreshFfmpeg = useCallback(async (force = false) => {
    if (force) invalidateFfmpegStatus();
    const next = await checkFfmpeg({ force });
    setFfmpeg(next);
    return next;
  }, []);

  useEffect(() => {
    refreshFfmpeg().catch(() => setFfmpeg(null));
  }, [refreshFfmpeg]);

  // 初始化配置 + 检测已有音轨
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    getSettings()
      .then((settings) => {
        if (cancelled) return;
        const nextEngine = settings.asrEngine || "faster-whisper";
        setEngine(nextEngine);
        setModel(settings.asrModel || defaultAsrModel(nextEngine));
        setDevice(settings.asrDevice || "auto");
      })
      .catch(() => {
        if (cancelled) return;
        setEngine("faster-whisper");
        setModel("large-v3");
        setDevice("auto");
      });

    pathExists(session.audioPath)
      .then((exists) => {
        if (!cancelled) setAudioReady(exists);
      })
      .catch(() => {
        if (!cancelled) setAudioReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  // 卸载时停止轮询
  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, []);

  if (!session) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6">
        <header>
          <h2 className="text-xl font-semibold">日语转录</h2>
          <p className="mt-1 text-sm text-text-muted">
            提取音轨并使用本地 ASR 模型生成日语 ASS 字幕
          </p>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface-raised">
          <p className="text-text-muted">尚未打开视频</p>
          <Button className="px-4 py-2" onClick={() => setStep("import")}>
            前往导入
          </Button>
        </div>
      </div>
    );
  }

  const audioPath = session.audioPath;
  const ffmpegMissing = ffmpeg !== null && !ffmpeg.available;
  const selectedEngineUnavailable = isSelectedAsrEngineUnavailable(
    engines,
    engine,
  );
  const engineSetupRequired =
    selectedEngineUnavailable || sidecarEngineMissing;

  const runExtract = async () => {
    if (!audioPath) {
      setExtractError("当前视频会话缺少音轨缓存路径");
      return;
    }
    setExtractError(null);
    setExtracting(true);
    setExtractPercent(0);
    upsertTask({
      id: "extract-audio",
      label: "提取音轨",
      status: "running",
      progress: 0,
    });

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await onAudioExtractProgress((p) => {
        const pct = p.percent === null ? null : Math.round(p.percent * 100);
        setExtractPercent(pct);
        if (pct !== null) updateTask("extract-audio", { progress: pct });
      });
      await extractAudio(session.videoPath, audioPath);
      setAudioReady(true);
      setExtractPercent(100);
      updateTask("extract-audio", { status: "success", progress: 100 });
    } catch (e) {
      setExtractError(`音轨提取失败：${String(e)}`);
      updateTask("extract-audio", { status: "error" });
    } finally {
      unlisten?.();
      setExtracting(false);
    }
  };

  const handleExtract = async () => {
    if (ffmpegMissing) {
      await ffmpegPreparation.requestDependency(async () => {
        const next = await refreshFfmpeg(true);
        if (next.available) await runExtract();
      });
      return;
    }
    await runExtract();
  };

  const detectEngines = useCallback(async () => {
    const requestId = engineCheckRequestRef.current + 1;
    engineCheckRequestRef.current = requestId;
    setEngineMsg("检测中…");
    setModelCheckTrigger((value) => value + 1);
    try {
      const list = await listAsrEngines();
      if (engineCheckRequestRef.current !== requestId) return;
      setEngines(list);
      setSidecarEngineMissing(false);
      const current = list.find((e) => e.name === engine);
      if (!current || !current.available) {
        setEngineMsg(
          `${ASR_ENGINE_NOT_INSTALLED_LABEL}：${engine}。${ASR_ENGINE_NOT_INSTALLED_HINT}`,
        );
      } else {
        setEngineMsg("sidecar 就绪");
      }
    } catch (e) {
      if (engineCheckRequestRef.current !== requestId) return;
      setEngines(null);
      if (isAsrEngineNotInstalledError(e)) {
        setSidecarEngineMissing(true);
        setEngineMsg(
          `${ASR_ENGINE_NOT_INSTALLED_LABEL}。${ASR_ENGINE_NOT_INSTALLED_HINT}`,
        );
      } else {
        setSidecarEngineMissing(false);
        setEngineMsg(`无法启动 sidecar：${String(e)}`);
      }
    }
  }, [engine]);

  const handleEngineChange = (nextEngine: string) => {
    setEngine(nextEngine);
    setModel(defaultAsrModel(nextEngine));
    setEngineMsg("未检测");
    setSidecarEngineMissing(false);
  };

  const pollLoop = async (jobId: string) => {
    pollingRef.current = true;
    let progressQueryFailures = 0;
    while (pollingRef.current) {
      let snap: AsrJobSnapshot;
      try {
        snap = await getAsrProgress(jobId, false);
        progressQueryFailures = 0;
        setAsrError(null);
      } catch (e) {
        if (!pollingRef.current) break;
        const message = String(e);
        if (!isMissingJobError(message) && progressQueryFailures < ASR_PROGRESS_RETRY_LIMIT) {
          progressQueryFailures += 1;
          setAsrError(
            `sidecar 暂时无响应，正在重试进度查询（${progressQueryFailures}/${ASR_PROGRESS_RETRY_LIMIT}）：${message}`,
          );
          await sleep(progressRetryDelay(progressQueryFailures));
          continue;
        }
        setAsrError(`查询进度失败：${message}`);
        updateTask("asr", { status: "error" });
        break;
      }
      if (!pollingRef.current) break; // 轮询期间已被取消，丢弃本次结果
      setJob(snap);
      updateTask("asr", { progress: Math.round(snap.progress * 100) });

      if (snap.status === "completed") {
        try {
          const full = await getAsrProgress(jobId, true);
          const segments = full.segments ?? [];
          const cues = mergeShortCues(segmentsToCues(segments, PRIMARY_STYLE));
          setCues(cues);
          setResultCount(cues.length);
          setJob(full);
          updateTask("asr", { status: "success", progress: 100 });

          // 保存字幕到可见的转录文件
          if (cues.length > 0) {
            try {
              // 获取视频分辨率（写入 ASS PlayRes，后续翻译/编辑沿用）
              let resX: number | undefined;
              let resY: number | undefined;
              let playResWarning: string | null = null;
              try {
                const videoInfo = await getVideoInfo(session.videoPath);
                resX = videoInfo.width;
                resY = videoInfo.height;
              } catch (err) {
                console.warn("无法读取视频分辨率，ASS PlayRes 将使用默认 1920×1080:", err);
                playResWarning =
                  "无法读取视频分辨率，字幕 PlayRes 已使用默认 1920×1080";
              }

              const doc = createDefaultDocument("Hikaru Sub", resX, resY);
              doc.cues = cues;
              setAssMetadata(doc.scriptInfo, doc.styles);
              const assText = serializeAss(doc);
              await saveAssText(session.transcribedAssPath, assText);
              setActiveSubtitle("transcribed", session.transcribedAssPath);
              markSaved();
              setSavedAssPath(session.transcribedAssPath);
              try {
                await deleteCachedAudio(session.audioPath);
                setAudioReady(false);
              } catch (deleteErr) {
                console.warn("删除缓存音轨失败:", deleteErr);
              }
              if (playResWarning) {
                setAsrError(playResWarning);
              }
            } catch (saveErr) {
              console.warn("保存 ASS 文件失败:", saveErr);
              setAsrError(`转录完成，但保存 ASS 失败：${String(saveErr)}`);
            }
          } else if (cues.length === 0) {
            setAsrError("转录完成，但没有生成字幕片段，未保存 ASS");
          }
        } catch (e) {
          setAsrError(`生成字幕失败：${String(e)}`);
          updateTask("asr", { status: "error" });
        }
        break;
      }
      if (snap.status === "failed") {
        setAsrError(snap.error ?? "转录失败");
        updateTask("asr", { status: "error" });
        break;
      }
      if (snap.status === "cancelled") {
        updateTask("asr", { status: "idle" });
        break;
      }
      await sleep(ASR_POLL_INTERVAL_MS);
    }
    pollingRef.current = false;
    setTranscribing(false);
  };

  const handleTranscribe = async () => {
    if (engineSetupRequired) {
      setAsrError(
        `${ASR_ENGINE_NOT_INSTALLED_LABEL}。${ASR_ENGINE_NOT_INSTALLED_HINT}`,
      );
      return;
    }
    setAsrError(null);
    setResultCount(null);
    setSavedAssPath(null);
    setJob(null);
    setTranscribing(true);
    upsertTask({
      id: "asr",
      label: "日语转录",
      status: "running",
      progress: 0,
    });
    try {
      const jobId = await startAsr({
        audioPath,
        engine,
        model,
        device,
        language: "ja",
        outputAssPath: session.transcribedAssPath,
        useVad,
        vadConfig: useVad
          ? {
              threshold: vadConfig.threshold ?? DEFAULT_VAD_CONFIG.threshold,
              minSpeechDurationMs:
                vadConfig.minSpeechDurationMs ?? DEFAULT_VAD_CONFIG.minSpeechDurationMs,
              minSilenceDurationMs:
                vadConfig.minSilenceDurationMs ?? DEFAULT_VAD_CONFIG.minSilenceDurationMs,
              speechPadMs: vadConfig.speechPadMs ?? DEFAULT_VAD_CONFIG.speechPadMs,
              maxSegmentDurationMs:
                vadConfig.maxSegmentDurationMs ?? DEFAULT_VAD_CONFIG.maxSegmentDurationMs,
            }
          : null,
      });
      jobIdRef.current = jobId;
      void pollLoop(jobId);
    } catch (e) {
      setAsrError(`启动转录失败：${String(e)}`);
      updateTask("asr", { status: "error" });
      setTranscribing(false);
    }
  };

  const handleCancel = async () => {
    const jobId = jobIdRef.current;
    // 立即停止轮询并恢复 UI，给出即时反馈
    pollingRef.current = false;
    jobIdRef.current = null;
    setJob(null);
    setTranscribing(false);
    updateTask("asr", { status: "idle" });
    if (!jobId) return;
    try {
      await cancelAsr(jobId); // 通知后端在下个片段边界停止
    } catch {
      // 忽略取消请求本身的错误，轮询会反映最终状态
    }
  };

  const percent = job ? Math.round(job.progress * 100) : 0;

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
          <h2 className="text-xl font-semibold">日语转录</h2>
          <p className="mt-1 text-sm text-text-muted">
            提取音轨并使用本地 ASR 模型生成日语 ASS 字幕
          </p>
      </header>

      {ffmpegMissing && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">未检测到 FFmpeg，无法提取音轨。</span>
          <Button
            variant="outline"
            type="button"
            onClick={() =>
              void ffmpegPreparation.requestDependency(async () => {
                await refreshFfmpeg(true);
              })
            }
            className="shrink-0 rounded-md border border-warning/50 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
          >
            准备 FFmpeg
          </Button>
        </div>
      )}

      {/* 步骤 1：提取音轨 */}
      <StepCard
        index={1}
        title="提取音轨"
        done={audioReady}
      >
        <p className="truncate font-mono text-xs text-text-muted" title={audioPath}>
          {audioPath || "（无输出路径）"}
        </p>
        {extracting && (
          <ProgressBar
            percent={extractPercent}
            label={
              extractPercent === null
                ? "提取中…"
                : `提取中 ${extractPercent}%`
            }
          />
        )}
        {extractError && (
          <p className="text-sm text-danger">{extractError}</p>
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="default"
            type="button"
            onClick={handleExtract}
            disabled={extracting || ffmpegMissing}
            className="rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {extracting ? "提取中…" : audioReady ? "重新提取" : "提取音轨"}
          </Button>
          {audioReady && !extracting && (
            <span className="text-sm text-success">音轨已就绪</span>
          )}
        </div>
      </StepCard>

      {/* 步骤 2：转录配置 */}
      <StepCard
        index={2}
        title="转录设置"
        desc="选择引擎、模型与设备（源语言固定为日语）"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="引擎">
            <Select
              value={engine}
              onChange={handleEngineChange}
              disabled={transcribing}
              options={ASR_ENGINE_OPTIONS}
            />
          </Labeled>
          <Labeled label="模型">
            <Select
              value={model}
              onChange={setModel}
              disabled={transcribing}
              options={asrModelOptions(engine)}
            />
            {engine === "kotoba-faster-whisper" && (
              <p className="mt-1 text-xs text-text-muted">
                {KOTOBA_FASTER_WHISPER_DESCRIPTION}
              </p>
            )}
            {engine === "parakeet" && (
              <p className="mt-1 text-xs text-text-muted">
                Parakeet 日语模型优先使用 char timestamps，并会重新按日语标点与长度切分字幕。
              </p>
            )}
            {engine === "qwen3-asr" && (
              <p className="mt-1 text-xs text-text-muted">
                Qwen3-ASR 自带 ForcedAligner 产出字级时间戳，文本质量与时间轴精度优于 Parakeet；长音频自动分块转录。
              </p>
            )}
          </Labeled>
          <Labeled label="设备">
            <Select
              value={device}
              onChange={setDevice}
              disabled={transcribing}
              options={ASR_DEVICES}
            />
          </Labeled>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-muted">引擎状态：</span>
          {engineMsg && (
            <span
              className={
                engineSetupRequired ? "text-warning" : "text-text-muted"
              }
            >
              {engineMsg}
            </span>
          )}
          {engineSetupRequired && !transcribing && (
            <Button
              variant="outline"
              type="button"
              onClick={() => setStep("settings")}
              className="rounded-md border border-warning/50 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/20"
            >
              前往设置
            </Button>
          )}
          <Button
            variant="outline"
            type="button"
            onClick={detectEngines}
            disabled={transcribing}
            className="rounded-md px-2.5 py-1 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            检测引擎状态
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useVad}
              disabled={transcribing}
              onChange={(e) => setUseVad(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm text-text">启用 VAD 语音检测预处理</span>
          </label>

          {useVad && (
            <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <Labeled label="语音阈值 (0.0–1.0)">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  disabled={transcribing}
                  value={vadConfig.threshold ?? DEFAULT_VAD_CONFIG.threshold}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setVadConfig({
                      ...vadConfig,
                      threshold: Number.isNaN(v) ? undefined : v,
                    });
                  }}
                  className={VAD_INPUT_CLASS}
                />
                <p className="mt-1 text-xs text-text-muted">
                  默认 0.5。提高减少误检，降低提升灵敏度。
                </p>
              </Labeled>

              <Labeled label="最小语音段长度 (ms)">
                <input
                  type="number"
                  min={0}
                  max={2000}
                  step={100}
                  disabled={transcribing}
                  value={
                    vadConfig.minSpeechDurationMs ??
                    DEFAULT_VAD_CONFIG.minSpeechDurationMs
                  }
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setVadConfig({
                      ...vadConfig,
                      minSpeechDurationMs: Number.isNaN(v) ? undefined : v,
                    });
                  }}
                  className={VAD_INPUT_CLASS}
                />
                <p className="mt-1 text-xs text-text-muted">
                  过滤短于此时长的语音片段，避免噪声干扰。
                </p>
              </Labeled>

              <Labeled label="最小静音间隔 (ms)">
                <input
                  type="number"
                  min={100}
                  max={3000}
                  step={100}
                  disabled={transcribing}
                  value={
                    vadConfig.minSilenceDurationMs ??
                    DEFAULT_VAD_CONFIG.minSilenceDurationMs
                  }
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setVadConfig({
                      ...vadConfig,
                      minSilenceDurationMs: Number.isNaN(v) ? undefined : v,
                    });
                  }}
                  className={VAD_INPUT_CLASS}
                />
                <p className="mt-1 text-xs text-text-muted">
                  语音段之间需多长静音才分割。降低会产生更多更短的语音段。
                </p>
              </Labeled>

              {(engine === "parakeet" || engine === "qwen3-asr") && (
                <Labeled label="最大语音段长度 (ms)">
                  <input
                    type="number"
                    min={15000}
                    max={35000}
                    step={1000}
                    disabled={transcribing}
                    value={
                      vadConfig.maxSegmentDurationMs ??
                      DEFAULT_VAD_CONFIG.maxSegmentDurationMs
                    }
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setVadConfig({
                        ...vadConfig,
                        maxSegmentDurationMs: Number.isNaN(v) ? undefined : v,
                      });
                    }}
                    className={VAD_INPUT_CLASS}
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    {engine === "parakeet" ? "Parakeet" : "Qwen3-ASR"} 专用：超过此长度的语音段会被切分。默认 25 秒。
                  </p>
                </Labeled>
              )}
            </div>
          )}
        </div>

        <ModelManager
          engine={engine}
          model={model}
          auto={false}
          trigger={modelCheckTrigger}
        />
      </StepCard>

      {/* 步骤 3：转录 */}
      <StepCard
        index={3}
        title="开始转录"
        done={resultCount !== null}
        desc="本地推理，时长取决于模型与设备"
      >
        {asrError && <p className="text-sm text-danger">{asrError}</p>}

        {job && transcribing && (
          <div className="flex flex-col gap-2">
            <ProgressBar
              percent={percent}
              label={`${job.status === "pending" ? "排队中" : "转录中"} ${percent}%`}
            />
            <div className="flex flex-wrap gap-4 text-xs text-text-muted">
              <span>
                进度 {formatMs(job.processedMs)} / {formatMs(job.durationMs)}
              </span>
              <span>已生成 {job.segmentCount} 段</span>
              {job.detectedLanguage && (
                <span>检测语言 {job.detectedLanguage}</span>
              )}
            </div>
          </div>
        )}

        {resultCount !== null && (
          <p className="text-sm text-success">
            转录完成，已生成 {resultCount} 条字幕
            {job?.detectedLanguage ? `（语言 ${job.detectedLanguage}）` : ""}
            {savedAssPath ? (
              <>
                ，已保存到{" "}
                <span className="break-all font-mono" title={savedAssPath}>
                  {savedAssPath}
                </span>
              </>
            ) : null}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {transcribing ? (
            <Button
              variant="outline"
              type="button"
              onClick={handleCancel}
              className="rounded-lg border border-danger/50 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10"
            >
              取消转录
            </Button>
          ) : (
            <Button
              variant="default"
              type="button"
              onClick={handleTranscribe}
              disabled={!audioReady || engineSetupRequired}
              className="rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resultCount !== null ? "重新转录" : "开始转录"}
            </Button>
          )}
          {!audioReady && !transcribing && (
            <span className="text-xs text-text-muted">请先提取音轨</span>
          )}
          {resultCount !== null && !transcribing && (
            <Button
              variant="outline"
              type="button"
              onClick={() => setStep("translate")}
              className="rounded-lg px-4 py-2 text-sm text-text"
            >
              前往翻译
            </Button>
          )}
        </div>
      </StepCard>

      <RuntimeDependencyDialog
        open={ffmpegPreparation.open}
        kind="ffmpeg"
        reason="提取音轨需要 FFmpeg。"
        sizeBytes={ffmpegPreparation.item?.sizeBytes ?? 0}
        targetPath={ffmpegPreparation.item?.path ?? "安装目录/deps/ffmpeg/current"}
        sourceLabel={ffmpegPreparation.sourceLabel}
        status={
          ffmpegPreparation.snapshot?.status === "running" ||
          ffmpegPreparation.snapshot?.status === "pending"
            ? "running"
            : ffmpegPreparation.snapshot?.status === "completed"
              ? "completed"
              : ffmpegPreparation.snapshot?.status === "failed"
                ? "failed"
                : "idle"
        }
        progressPercent={ffmpegPreparation.progressPercent}
        error={ffmpegPreparation.error}
        onConfirm={ffmpegPreparation.confirmPrepare}
        onCancel={() => ffmpegPreparation.setOpen(false)}
        onChangeSource={() => setStep("settings")}
      />
    </div>
  );
}

function StepCard({
  index,
  title,
  desc,
  done,
  children,
}: {
  index: number;
  title: string;
  desc?: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface-raised p-5">
      <div className="mb-4 flex items-start gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            done
              ? "bg-success/20 text-success"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {done ? <IconCheck className="h-4 w-4" /> : index}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {desc && <p className="mt-0.5 text-xs text-text-muted">{desc}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-3 pl-10">{children}</div>
    </section>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function ProgressBar({
  percent,
  label,
}: {
  percent: number | null;
  label?: string;
}) {
  const indeterminate = percent === null;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-overlay">
        <div
          className={`h-full rounded-full bg-accent transition-[width] ${
            indeterminate ? "w-1/3 animate-pulse" : ""
          }`}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
      {label && <span className="text-xs text-text-muted">{label}</span>}
    </div>
  );
}
