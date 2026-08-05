# Journal - zzx (Part 1)

> AI development session journal
> Started: 2026-07-16

---



## Session 1: Bootstrap Trellis specs from codebase

**Date**: 2026-07-16
**Task**: Bootstrap Trellis specs from codebase
**Branch**: `dev`

### Summary

Filled frontend/tauri/asr Trellis specs from real Hikaru Sub sources; referenced AGENTS.md; English; check PASS. Specs left uncommitted per user request; archived 00-bootstrap-guidelines.

### Main Changes

- Unified all persistent `SubtitleCue` edits into one project undo/redo history.
- Added Aegisub-style text grouping, IME-safe preview/commit handling, caret restoration, and pending-time coordination.
- Paired save payloads with revision checkpoints and synchronized frontend specs, Agent guidance, and user documentation.

### Git Commits

(No commits - planning session)

### Testing

- `pnpm test`: 68 files, 462 tests passed.
- `pnpm build`: passed.
- Manual editor validation completed by the user.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Physical ASS rows and system clipboard

**Date**: 2026-07-16
**Task**: Physical ASS rows and system clipboard
**Branch**: `dev`

### Summary

Editor cues map 1:1 to Dialogue events; subtitleMergeMode stays translation-only; whole-row copy/cut/paste uses Tauri clipboard-manager with ASS event lines and plain-text fallback. Specs updated; ponytail cleanup removed systemClipboard wrapper.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `a15d7ad` | (see git log) |
| `8bbe49c` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Batch subtitle editing

**Date**: 2026-07-16
**Task**: Batch subtitle editing
**Branch**: `dev`

### Summary

Added batch right-panel formatting for multi-selected physical subtitle rows, preserved single-row caret behavior and one-step undo/redo, fixed duplicate font commits, and covered the flow with focused and full frontend checks.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `2b4efef` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Unified subtitle editor undo/redo history

**Date**: 2026-07-17
**Task**: Unified subtitle editor undo/redo history
**Branch**: `dev`

### Summary

Unified all persistent subtitle edits under one project-level undo/redo history, added Aegisub-style text grouping, coordinated IME and pending time drafts, paired saves with revision checkpoints, and synchronized tests and documentation.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `7c7afe1` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Editor layout redesign

**Date**: 2026-07-17
**Task**: Editor layout redesign
**Branch**: `dev`

### Summary

Redesigned the subtitle editor workspace, added aligned optional ASS Dialogue columns with field round-trip preservation, reflowed editing controls, and standardized compact H:MM:SS.cc time inputs.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `14b332c` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: Resizable editor panes

**Date**: 2026-07-17
**Task**: Resizable editor panes
**Branch**: `dev`

### Summary

Added pointer-resizable editor pane splitters with global persistence, minimum-size constraints, double-click reset, preserved editor arrow-key behavior, and simplified the implementation with native CSS Grid minmax.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `f873178` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Settings category navigation

**Date**: 2026-07-18
**Task**: Settings category navigation
**Branch**: `dev`

### Summary

Split Settings into left category nav (runtime/transcription/translation) with shell + panels, added uiStore.openSettings deep links from Transcribe/Translate/runtime dialogs, and updated frontend specs/tests.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `9f07dc8` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: Expand translation provider management

**Date**: 2026-07-19
**Task**: Expand translation provider management
**Branch**: `dev`

### Summary

Implemented multi-provider translation settings with OpenAI-compatible, Gemini, and Anthropic protocols, provider CRUD and model discovery, per-provider concurrency/RPM scheduling, legacy settings migration, session-local provider selection, and ASS/order-safe translation fallback. Added focused and full frontend/Rust tests, built successfully, reviewed and simplified the translation service, then committed the work as a8311aa.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `a8311aa` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: Manage subtitle editor shortcuts

**Date**: 2026-07-19
**Task**: Manage subtitle editor shortcuts
**Branch**: `dev`

### Summary

Added persisted subtitle editor shortcut management in Settings, including per-shortcut recording, conflict validation, restore-all and per-shortcut reset actions, effective bindings across editor consumers, compatibility handling, tests, and frontend/Tauri verification.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `3ccd1f0` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: Persistent Subtitle Style Library

**Date**: 2026-07-20
**Task**: Persistent Subtitle Style Library
**Branch**: `dev`

### Summary

Implemented a persistent application-level ASS style library with installed/portable fixed-path storage, first-run defaults, live-save editing, detached document/library copies, overwrite and deletion confirmations, atomic writes, concurrent-save protection, and regression coverage including document-style switch warning flicker.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `2bbf2c2` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: 扩展 ASR 模型与 ReazonSpeech

**Date**: 2026-07-20
**Task**: 扩展 ASR 模型与 ReazonSpeech
**Branch**: `dev`

### Summary

为 faster-whisper 增加 large-v3-turbo，并新增 ReazonSpeech NeMo v2 引擎；接入 CPU/CUDA 依赖、Windows HF 下载兜底、前端工作流与发布资源，完成 CUDA 真实模型冒烟和长音频内存优化。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `fbfab4c` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: 编辑页字幕查找替换与质检

**Date**: 2026-07-22
**Task**: 编辑页字幕查找替换与质检
**Branch**: `dev`

### Summary

实现物理字幕行查找、替换、筛选和前端质检，补充重叠高亮、播放头同步与不挤压列表的悬浮面板；全部替换保持单次历史操作，并完成全量测试、构建和文档同步。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `5e5823a` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 13: 翻译失败重试与取消

**Date**: 2026-07-23
**Task**: 翻译失败重试与取消
**Branch**: `main`

### Summary

实现翻译完整、部分失败与取消状态；支持取消排队和在途请求、仅重试未完成条目、显式保存不完整结果、安全错误摘要，以及按错误类别重试和快速停止。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `8d4f1f5` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: 最近工作视频与首页续接

**Date**: 2026-07-23
**Task**: 最近工作视频与首页续接
**Branch**: `dev`

### Summary

实现最近视频持久化、首页续接入口、共享视频/字幕打开流程与全局拖放，并补充竞态保护、回归测试和前端规范。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `ff27cbc` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: Editor playback UX: waveform alignment, smooth playhead, play-current-line

**Date**: 2026-07-27
**Task**: Editor playback UX: waveform alignment, smooth playhead, play-current-line
**Branch**: `dev`

### Summary

Fixed waveform readability (duration-scaled sampling, per-pixel peak aggregation, auto noise-floor contrast + Shift+wheel gain) and timeline alignment (aresample=async=1:first_pts=0 for HLS timestamp gaps, coveredMs-based mapping; same fix applied to ASR audio extraction). Smoothed playhead by moving heavy React consumers to boundary-frequency activeCueIds, transient DOM playhead overlay, requestSeek intent channel, memoized subtitle rows, split canvas layers. Added play-current-line button sharing R/play-segment action. Included 8 external review fixes and ponytail simplification round (-89 lines). Specs updated: audio decode timeline contract (tauri) and high-frequency playback timing rules (frontend).

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `6acc3a4` | (see git log) |
| `f094111` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 16: Stabilize long-audio Whisper segmentation

**Date**: 2026-07-30
**Task**: Stabilize long-audio Whisper segmentation
**Branch**: `dev`

### Summary

Implemented and validated a duration-gated Japanese large-v2 long-audio path with managed Silero V4, deterministic CTranslate2 runtime isolation, decoder prompt-state stabilization, timestamp safety, short/Kotoba isolation, lazy dependency loading, and queued cancellation handling. Sanitized private fixture identifiers and synchronized packaged sidecar resources.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `cdbe46d` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: Establish native ASR benchmark ground truth

**Date**: 2026-07-31
**Task**: Establish native ASR benchmark ground truth
**Branch**: `dev-crisp-asr`

### Summary

Implemented the authoritative WAV+ASS benchmark contract, shared CER/timeline/gap/Qwen timing metrics, deterministic sanitized reporting, and five-engine short Python diagnostics. Froze user-reviewed absolute quality/performance/resource gates, recorded per-case coverage, archived T01, and refreshed T02/T03 handoff paths.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `a9e31cb` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 18: Native ASR Rust job host

**Date**: 2026-08-02
**Task**: Native ASR Rust job host
**Branch**: `dev-crisp-asr`

### Summary

Implemented and independently reviewed the development-only Rust native ASR worker host with stable product IPC, shared active-slot arbitration, protocol reduction, recovery, bounded diagnostics, process-tree cancellation, legacy fallback, and full fake-worker validation.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `74d1a4e` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 19: Complete native CTranslate2 Whisper handoff

**Date**: 2026-08-04
**Task**: Complete native CTranslate2 Whisper handoff
**Branch**: `dev-crisp-asr`

### Summary

Implemented and independently reviewed the native CTranslate2 faster-whisper worker, CPU diagnosis and selected baseline, Candidate B Silero V6 experiment, deterministic evidence publishers, T05 host compatibility, and the migration-handoff-stop-revise closure. Archived T06 with native routing disabled and Python legacy/default preserved.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `b29412e` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 20: Complete T07 CTranslate2 CUDA development lane

**Date**: 2026-08-05
**Task**: Complete T07 CTranslate2 CUDA development lane
**Branch**: `dev-crisp-asr`

### Summary

Implemented and verified the ignored-local CTranslate2 CUDA development lane. Added opt-in CUDA 12.8/SM 8.6 build support with cuDNN disabled, explicit CPU INT8 and CUDA device-0 FP16 execution, fail-closed pre-ready errors, driver-based GPU/module attestation, paired 1-cold/3-warm evidence and deterministic publication. RTX 3070 evidence reached development-gpu-ready with GPU/CPU warmed RTF ratios 0.1090 and 0.1313. Updated ASR/Tauri specs and parent T07/T08 handoff; archived T07 without changing release routing or packaging.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `9645704` | (see git log) |
| `5b90d83` | (see git log) |
| `ad3482e` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
