import { useCallback, useEffect, useRef, useState } from "react";
import {
  PRIMARY_STYLE,
  mergeShortCues,
  segmentsToCues,
} from "@hikaru/ass-core";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { IconCheck } from "../layout/NavIcons";
import { Select } from "../ui/Select";
import { ModelManager } from "./ModelManager";
import {
  cancelAsr,
  checkFfmpeg,
  extractAudio,
  getAsrProgress,
  listAsrEngines,
  onAudioExtractProgress,
  pathExists,
  startAsr,
} from "../../services/tauri";
import type {
  AsrEngineInfo,
  AsrJobSnapshot,
  FfmpegStatus,
} from "../../types";

const ASR_MODELS = ["tiny", "base", "small", "medium", "large-v2", "large-v3"];
const ASR_DEVICES = [
  { value: "auto", label: "自动" },
  { value: "cpu", label: "CPU" },
  { value: "cuda", label: "CUDA（NVIDIA GPU）" },
];
const SOURCE_LANGS = [
  { value: "auto", label: "自动检测" },
  { value: "ja", label: "日语" },
  { value: "en", label: "英语" },
  { value: "zh", label: "中文" },
  { value: "ko", label: "韩语" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatMs(ms: number): string {
  if (!ms || ms < 0) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TranscribeView() {
  const setStep = useUiStore((s) => s.setStep);
  const project = useProjectStore((s) => s.project);
  const setCues = useProjectStore((s) => s.setCues);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);

  // 音轨提取
  const [audioReady, setAudioReady] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractPercent, setExtractPercent] = useState<number | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // ASR 配置
  const [engine, setEngine] = useState("faster-whisper");
  const [model, setModel] = useState("large-v3");
  const [device, setDevice] = useState("auto");
  const [language, setLanguage] = useState("auto");
  const [engines, setEngines] = useState<AsrEngineInfo[] | null>(null);
  const [engineMsg, setEngineMsg] = useState<string | null>(null);

  // 转录任务
  const [transcribing, setTranscribing] = useState(false);
  const [job, setJob] = useState<AsrJobSnapshot | null>(null);
  const [asrError, setAsrError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);

  const pollingRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    checkFfmpeg()
      .then(setFfmpeg)
      .catch(() => setFfmpeg(null));
  }, []);

  // 初始化配置 + 检测已有音轨
  useEffect(() => {
    if (!project) return;
    setEngine(project.asr.engine || "faster-whisper");
    setModel(project.asr.model || "large-v3");
    setDevice(project.asr.device || "auto");
    setLanguage(project.sourceLang || "auto");
    if (project.audioPath) {
      pathExists(project.audioPath)
        .then(setAudioReady)
        .catch(() => setAudioReady(false));
    }
  }, [project]);

  // 卸载时停止轮询
  useEffect(() => {
    return () => {
      pollingRef.current = false;
    };
  }, []);

  if (!project) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6">
        <header>
          <h2 className="text-xl font-semibold">ASR 转录</h2>
          <p className="mt-1 text-sm text-text-muted">
            提取音轨并使用本地 ASR 模型生成 ASS 字幕
          </p>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface-raised">
          <p className="text-text-muted">尚未打开项目</p>
          <button
            type="button"
            onClick={() => setStep("import")}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted"
          >
            前往导入
          </button>
        </div>
      </div>
    );
  }

  const audioPath = project.audioPath ?? "";
  const ffmpegMissing = ffmpeg !== null && !ffmpeg.available;

  const handleExtract = async () => {
    if (!audioPath) {
      setExtractError("项目缺少音轨输出路径");
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
      await extractAudio(project.videoPath, audioPath);
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

  const detectEngines = useCallback(async () => {
    setEngineMsg("检测中…");
    try {
      const list = await listAsrEngines();
      setEngines(list);
      const current = list.find((e) => e.name === engine);
      if (current && !current.available) {
        setEngineMsg(`引擎 ${engine} 依赖未安装，请先安装 asr-service 依赖`);
      } else {
        setEngineMsg("sidecar 就绪");
      }
    } catch (e) {
      setEngines(null);
      setEngineMsg(`无法启动 sidecar：${String(e)}`);
    }
  }, [engine]);

  // 进入页面（及引擎变更）自动检测引擎可用性
  useEffect(() => {
    void detectEngines();
  }, [detectEngines]);

  const pollLoop = async (jobId: string) => {
    pollingRef.current = true;
    while (pollingRef.current) {
      let snap: AsrJobSnapshot;
      try {
        snap = await getAsrProgress(jobId, false);
      } catch (e) {
        setAsrError(`查询进度失败：${String(e)}`);
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

          // 保存字幕到文件
          if (project?.assPath && cues.length > 0) {
            try {
              const { serializeAss, createDefaultDocument } = await import("@hikaru/ass-core");
              const { getVideoInfo } = await import("../../services/tauri");

              // 获取视频分辨率
              let resX: number | undefined;
              let resY: number | undefined;
              try {
                const videoInfo = await getVideoInfo(project.videoPath);
                resX = videoInfo.width;
                resY = videoInfo.height;
              } catch {
                // 获取失败时使用默认值（1920x1080）
              }

              const doc = createDefaultDocument("Hikaru-Sub", resX, resY);
              doc.cues = cues;
              const assText = serializeAss(doc);
              const { saveAssText } = await import("../../services/tauri");
              await saveAssText(project.assPath, assText);
            } catch (saveErr) {
              console.warn("保存 ASS 文件失败:", saveErr);
            }
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
      await sleep(700);
    }
    pollingRef.current = false;
    setTranscribing(false);
  };

  const handleTranscribe = async () => {
    setAsrError(null);
    setResultCount(null);
    setJob(null);
    setTranscribing(true);
    upsertTask({
      id: "asr",
      label: "ASR 转录",
      status: "running",
      progress: 0,
    });
    try {
      const jobId = await startAsr({
        audioPath,
        engine,
        model,
        device,
        language: language === "auto" ? null : language,
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
        <h2 className="text-xl font-semibold">ASR 转录</h2>
        <p className="mt-1 text-sm text-text-muted">
          提取音轨并使用本地 ASR 模型生成单语 ASS 字幕
        </p>
      </header>

      {ffmpegMissing && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">未检测到 FFmpeg，无法提取音轨。</span>
          <button
            type="button"
            onClick={() => setStep("settings")}
            className="shrink-0 rounded-md border border-warning/50 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
          >
            前往设置
          </button>
        </div>
      )}

      {/* 步骤 1：提取音轨 */}
      <StepCard
        index={1}
        title="提取音轨"
        done={audioReady}
        desc="使用 FFmpeg 提取 16kHz 单声道 WAV"
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
          <button
            type="button"
            onClick={handleExtract}
            disabled={extracting || ffmpegMissing}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {extracting ? "提取中…" : audioReady ? "重新提取" : "提取音轨"}
          </button>
          {audioReady && !extracting && (
            <span className="text-sm text-success">音轨已就绪</span>
          )}
        </div>
      </StepCard>

      {/* 步骤 2：转录配置 */}
      <StepCard
        index={2}
        title="转录设置"
        desc="选择引擎、模型、设备与源语言"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label="引擎">
            <Select
              value={engine}
              onChange={setEngine}
              disabled={transcribing}
              options={[{ value: "faster-whisper", label: "faster-whisper" }]}
            />
          </Labeled>
          <Labeled label="模型">
            <Select
              value={model}
              onChange={setModel}
              disabled={transcribing}
              options={ASR_MODELS.map((m) => ({ value: m, label: m }))}
            />
          </Labeled>
          <Labeled label="设备">
            <Select
              value={device}
              onChange={setDevice}
              disabled={transcribing}
              options={ASR_DEVICES}
            />
          </Labeled>
          <Labeled label="源语言">
            <Select
              value={language}
              onChange={setLanguage}
              disabled={transcribing}
              options={SOURCE_LANGS}
            />
          </Labeled>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-muted">引擎状态：</span>
          {engineMsg && (
            <span
              className={
                engines?.find((e) => e.name === engine)?.available === false
                  ? "text-warning"
                  : "text-text-muted"
              }
            >
              {engineMsg}
            </span>
          )}
        </div>
        <ModelManager engine={engine} model={model} />
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
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {transcribing ? (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border border-danger/50 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10"
            >
              取消转录
            </button>
          ) : (
            <button
              type="button"
              onClick={handleTranscribe}
              disabled={!audioReady}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resultCount !== null ? "重新转录" : "开始转录"}
            </button>
          )}
          {!audioReady && !transcribing && (
            <span className="text-xs text-text-muted">请先提取音轨</span>
          )}
          {resultCount !== null && !transcribing && (
            <button
              type="button"
              onClick={() => setStep("translate")}
              className="rounded-lg border border-border px-4 py-2 text-sm text-text hover:border-accent/50"
            >
              前往翻译
            </button>
          )}
        </div>
      </StepCard>
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
              : "bg-accent/15 text-accent"
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
