export type WorkflowStep =
  | "welcome"
  | "download"
  | "import"
  | "transcribe"
  | "translate"
  | "editor"
  | "burn"
  | "settings";

export type ActiveSubtitleKind = "transcribed" | "translated";

export interface VideoSession {
  videoPath: string;
  workspacePath: string;
  audioPath: string;
  transcribedAssPath: string;
  translatedAssPath: string;
  burnAssPath: string;
  sourceLang: "ja";
}

export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  primaryText: string;
  secondaryText?: string;
  style: string;
  layer: number;
}

export interface AppSettings {
  ffmpegPath?: string;
  pythonPath?: string;
  asrServicePath?: string;
  asrEngine: string;
  asrModel: string;
  asrDevice: string;
  translationBaseUrl: string;
  translationModel: string;
  translationApiKey?: string;
  defaultSourceLang: string;
  defaultTargetLang: string;
  translationBatchSize: number;
  translationContextWindow: number;
  translationCustomPrompt?: string;
  translationGlossary?: string;
  subtitleMergeMode: "inline" | "separate";
  runtimeSourceMode?: RuntimeDependencySourceMode;
}

export type FfmpegSource = "settings" | "managed" | "system";

export interface FfmpegStatus {
  available: boolean;
  path: string;
  source: FfmpegSource;
  version?: string;
}

export interface AudioExtractProgress {
  /** 已处理时长（毫秒） */
  processedMs: number;
  /** 视频总时长（毫秒），未知时为 0 */
  durationMs: number;
  /** 0~1，总时长未知时为 null */
  percent: number | null;
}

/** ASR sidecar 输出的时间片段（与 ass-core AsrSegment 同构）。 */
export interface AsrSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface AsrEngineInfo {
  name: string;
  /** 依赖是否就绪（如 faster-whisper 是否已安装） */
  available: boolean;
}

export type AsrJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AsrJobSnapshot {
  id: string;
  status: AsrJobStatus;
  /** 0~1 */
  progress: number;
  durationMs: number;
  processedMs: number;
  segmentCount: number;
  detectedLanguage: string | null;
  error: string | null;
  /** 仅在请求包含片段时返回 */
  segments?: AsrSegment[];
}

/** VAD（语音活动检测）配置。所有字段可选，未设置时引擎使用各自默认值。 */
export interface VadConfig {
  threshold?: number;
  minSpeechDurationMs?: number;
  minSilenceDurationMs?: number;
  speechPadMs?: number;
  /** Parakeet 专用：超过此长度的语音段会被切分 */
  maxSegmentDurationMs?: number;
}

export interface StartAsrArgs {
  audioPath: string;
  engine: string;
  model: string;
  device: string;
  language?: string | null;
  outputAssPath?: string | null;
  /** 是否启用可配置 VAD 预处理 */
  useVad?: boolean;
  /** VAD 参数；仅在 useVad 为真时生效 */
  vadConfig?: VadConfig | null;
}

/** ASR 模型在本地缓存中的就绪状态。 */
export interface AsrModelStatus {
  engine: string;
  model: string;
  /** 引擎依赖是否就绪（不就绪时无法检测/下载） */
  available: boolean;
  /** 模型文件是否已在本地缓存 */
  downloaded: boolean;
}

export type ModelDownloadStatus = "running" | "completed" | "failed";

export interface ModelDownloadSnapshot {
  id: string;
  status: ModelDownloadStatus;
  /** 0~1，总大小未知时为 0 */
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  hfEndpoint?: string | null;
  hfHome?: string | null;
  debugLogPath?: string | null;
}

export type AsrSetupProfile =
  | "default"
  | "parakeet-cpu"
  | "parakeet-cuda"
  | "qwen3-cpu"
  | "qwen3-cuda";

export type AsrSetupStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface StartAsrSetupArgs {
  profile: AsrSetupProfile;
  engine: string;
  recreate?: boolean;
  pythonPath?: string | null;
  asrServicePath?: string | null;
}

export interface ProbeAsrSetupEnvironmentArgs {
  pythonPath?: string | null;
  asrServicePath?: string | null;
}

export interface AsrSetupSnapshot {
  id: string;
  status: AsrSetupStatus;
  profile: AsrSetupProfile;
  stage: string;
  progress: number | null;
  logTail: string[];
  exitCode?: number | null;
  error: string | null;
}

export interface AsrSetupEnvironment {
  serviceTemplatePath?: string | null;
  managedServicePath: string;
  pythonPath?: string | null;
  pythonVersion?: string | null;
  pythonOk: boolean;
  venvPath: string;
  venvExists: boolean;
  hasNvidiaGpu: boolean;
}

export type RuntimeDependencyKind =
  | "ffmpeg"
  | "python311"
  | "asrVenv"
  | "asrModels"
  | "downloads";

export type RuntimeDependencySourceMode = "official" | "china";

export interface RuntimeDependencyBinarySource {
  url: string;
  sha256: string;
  sizeBytes: number;
  archive: "zip" | "tar.gz" | "tar.xz" | "windowsInstaller";
  stripPrefix?: string | null;
}

export interface RuntimeDependencySourceProfile {
  id: "official" | "china";
  label: string;
  ffmpeg?: RuntimeDependencyBinarySource;
  python311?: RuntimeDependencyBinarySource;
  pipIndexUrl?: string | null;
  pipExtraIndexUrls?: string[];
  pytorchCpuIndexUrl?: string | null;
  pytorchCudaIndexUrl?: string | null;
  pytorchCpuFindLinksUrl?: string | null;
  pytorchCudaFindLinksUrl?: string | null;
  huggingfaceEndpoint?: string | null;
}

export type RuntimeDependencyJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface RuntimeDependencyItem {
  kind: RuntimeDependencyKind;
  status: "available" | "missing" | "needsSetup";
  path?: string | null;
  source?: string | null;
  version?: string | null;
  managed: boolean;
  sizeBytes: number;
}

export interface RuntimeDependencyProbe {
  items: RuntimeDependencyItem[];
  sourceMode: RuntimeDependencySourceMode;
}

export interface PrepareRuntimeDependencyArgs {
  kind: RuntimeDependencyKind;
  engine?: string | null;
  model?: string | null;
  profile?: AsrSetupProfile | null;
  recreate?: boolean;
}

export interface RuntimeDependencySnapshot {
  id: string;
  kind: RuntimeDependencyKind;
  status: RuntimeDependencyJobStatus;
  stage: string;
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number;
  resolvedPath?: string | null;
  logTail: string[];
  error: string | null;
}

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
  /** 视频帧率；后端无法探测时为 null */
  fps: number | null;
}

export interface VideoPlaybackProbe {
  videoCodec: string;
  audioCodec?: string;
  formatName: string;
  needsTranscode: boolean;
  reason?: string;
}

export interface PreviewFontFile {
  path: string;
  url: string;
  fileName: string;
  displayName?: string | null;
  familyNames?: string[];
  fontNames?: string[];
}

export interface RenderSubtitlePreviewFrameArgs {
  videoPath: string;
  assText: string;
  timeMs: number;
  fontDir?: string | null;
}

export interface RenderSubtitlePreviewFrameResult {
  imagePath: string;
  imageUrl: string;
}

export type DownloadMode = "single" | "separate";

export type DownloadStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadMediaProbe {
  hasVideo: boolean;
  hasAudio: boolean;
  extension: string;
  durationMs: number;
}

export interface ProbeDownloadMediaArgs {
  mode: DownloadMode;
  videoUrl: string;
  audioUrl?: string | null;
  headers?: string | null;
}

export type DownloadStrategy = "auto" | "segments" | "ffmpeg";

export interface StartVideoDownloadArgs {
  mode: DownloadMode;
  name: string;
  videoUrl: string;
  audioUrl?: string | null;
  headers?: string | null;
  saveDir?: string | null;
  strategy?: DownloadStrategy | null;
}

export interface DownloadSnapshot {
  id: string;
  status: DownloadStatus;
  progress: number | null;
  processedMs: number;
  durationMs: number;
  outputPath: string | null;
  error: string | null;
}

export type BurnMode = "hardSubMp4" | "softSubMkv";

export type BurnVideoEncoder =
  | "auto"
  | "libX264"
  | "h264Nvenc"
  | "h264Qsv"
  | "h264Amf"
  | "h264Videotoolbox";

export type BurnStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface StartBurnArgs {
  videoPath: string;
  assPath: string;
  outputPath: string;
  mode: BurnMode;
  crf?: number | null;
  preset?: string | null;
  videoEncoder?: BurnVideoEncoder | null;
  videoBitrateKbps?: number | null;
  fontDir?: string | null;
}

export interface BurnVideoProbe {
  videoBitrateKbps: number | null;
  availableEncoders: BurnVideoEncoder[];
  preferredEncoder: BurnVideoEncoder;
}

export interface BurnSnapshot {
  id: string;
  status: BurnStatus;
  progress: number | null;
  processedMs: number;
  durationMs: number;
  outputPath: string | null;
  error: string | null;
}

export type ClipMode = "soft" | "hard";

export type ClipStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface StartVideoClipArgs {
  videoPath: string;
  startMs: number;
  endMs: number;
  mode: ClipMode;
  saveDir?: string | null;
  fileName?: string | null;
}

export interface ClipSnapshot {
  id: string;
  status: ClipStatus;
  progress: number | null;
  processedMs: number;
  durationMs: number;
  outputPath: string | null;
  error: string | null;
  fellBackToHard: boolean;
}

export interface ExtractVideoFrameArgs {
  videoPath: string;
  timeMs: number;
}

export interface ExtractVideoFrameResult {
  imagePath: string;
  imageUrl: string;
}
