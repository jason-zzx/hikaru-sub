# Native ASR Release-First Roadmap Design

## Summary

本设计把 Native ASR 迁移拆成两个阶段：

1. **Native MVP**：交付一条安全、可运行、无需 Python 的 Windows x64 CPU 路线。
2. **Post-MVP expansion**：继续字幕质量优化、多模型、多引擎和 GPU pack。

首版推荐复用现有 `faster-whisper / large-v3` Candidate A 和稳定 worker seam。历史质量 evidence 不改写，但 Python legacy 非回退、large-v2 双 anchor 和 GPU-only qualification 不再决定首版能否发布。

## First-Principles Decision

用户真正需要发布的是：

> 用户安装 Hikaru Sub 后，不配置 Python，也能下载一个受管模型并完成本地日语转录。

要满足这一点，首版必须具备 worker、host、model delivery、CPU runtime、settings/UI 和 packaging；并不需要同时证明五个引擎、两个 Whisper anchor、两种 GPU pack 和所有 subtitle-quality parity。

因此最短可靠路线是只产品化已经具备完整执行证据的一条 CT2 路线，并把其余工作从 release gate 改为独立 follow-up。

## Target Topology

```text
archived worker/host/CT2 Candidate A
            |
            +-> T12 MVP model identity/download/readiness (large-v3 first)
            |
            +-> T13 final bundled CPU runtime artifact
                       |
             T16 CPU runtime/settings backend
                       |
             T17 Native MVP frontend UX
                       |
             T18 integration + release cutover

post-MVP:
  first P1: Faster-Whisper model expansion
    tiny / base / small / medium / large-v2 / large-v3-turbo
  then:
    T08R Kotoba quality
    T11 Qwen3 + ForcedAligner
    Parakeet/Reazon revisions
    T14/T15 CUDA/Vulkan packs and qualification
```

## MVP Qualification Boundary

### Blocking

- Native model and runtime load successfully from managed paths.
- Worker emits valid protocol and completes representative short/medium/long runs without crash.
- Final output is non-empty, valid UTF-8, time-ordered, positive duration and bounded by audio.
- Cancel/recovery/abnormal-exit behavior remains correct.
- Model download is pinned, hashed and atomic.
- Installed/portable layouts and offline cached-model transcription work.
- Package contains no Python runtime/venv and no model weights.
- License, attribution, privacy and path containment checks pass.

### Diagnostic only for MVP

- CER, S/D/I and comparison to `python-legacy-cuda-v1`.
- semantic-gap counts that do not represent empty/corrupt/invalid output.
- subtitle segmentation polish and model-relative timing quality.
- GPU RTF and CPU-vs-GPU comparison.

A functional defect can still block release even if categorized through a quality metric. The distinction is whether the output is unsafe/unusable versus merely worse than Python legacy.

## Candidate A Interpretation

Archived Candidate A remains historically `stop-revise` under the quality-first policy. The new parent planning may reference the same frozen identity as:

```text
MVP disposition: mvp-eligible-with-known-quality-limitations
Historical quality disposition: stop-revise (unchanged)
```

This is a policy change, not an evidence rewrite. It avoids another discovery/candidate loop while retaining transparent known limitations.

## Child Task Changes

### T12 Model Manager

- MVP required: exact large-v3 CT2 artifact identity, official/China source, size/hash/license, atomic install/readiness, legacy CT2 reuse where valid.
- Post-MVP: remaining CT2/GGUF/Qwen companion catalog.
- Interface should remain extensible through the manifest already required; no separate MVP-only downloader architecture.

### T13 CPU Runtime Package

- Becomes final Native MVP CPU runtime artifact owner rather than provisional-only.
- Builds only capabilities required for large-v3 CT2 plus stable protocol/host integration.
- CrispASR and rejected optional candidates are excluded from the first artifact; any shared DLL must be justified as an explicit CTranslate2 MVP runtime dependency.
- T18 verifies and consumes T13's attested artifact instead of rebuilding it from optional engine identities.

### T16 Runtime/Settings

- Depends on T12 + T13, not T15.
- Exposes bundled CPU runtime and per-model MVP availability.
- Ignores legacy Python paths and removes production Python dependency probing.

### T17 Frontend

- Shows large-v3 as Native available.
- Keeps other existing models visible with an explicit post-MVP/unavailable explanation.
- Removes production Python setup copy and preserves existing job/ASS flow.

### T18 Release

- Integrates T12/T13/T16/T17.
- Uses known quality metrics as release notes/diagnostics, not parity gates.
- Cuts over only the MVP route and removes Python from packaged dependencies.

### First Post-MVP Task

`08-26-native-asr-whisper-model-expansion` is P1 and starts immediately after T18. It adds exact model delivery/readiness, functional smoke and T16/T17 availability for `tiny`, `base`, `small`, `medium`, `large-v2` and `large-v3-turbo`, while reusing the released CT2 CPU architecture and keeping Python parity diagnostic.

### Later Deferred Tasks

T08R, T11, Parakeet/Reazon follow-ups and T14/T15 retain their existing technical goals but follow the Faster-Whisper expansion unless the user reprioritizes again. Their failure cannot revoke any released Faster-Whisper route.

## Compatibility

- React command names and `AsrJobSnapshot` remain stable.
- Existing engine/model IDs remain stable.
- Unsupported Native models remain visible; no silent Python fallback.
- Python legacy remains in source for one release cycle as developer comparison/rollback evidence, but is not packaged.
- Model/runtime paths remain under existing installed/portable managed roots.

## Rollout And Rollback

1. Ship only the frozen large-v3 CPU route.
2. Keep a per-route availability switch so the Native route can be disabled in a patch without destructive model/settings migration.
3. Preserve source-level Python legacy for diagnosis during one stable release cycle.
4. The first post-MVP P1 task expands the remaining six Faster-Whisper models on the released CT2 CPU route.
5. Later engine/GPU routes are added independently; one failed model or GPU pack cannot block or remove another released route.

## Trade-offs

- **Accepted:** first Native subtitles may be measurably worse than Python legacy.
- **Accepted:** first release supports fewer Native models/engines than the UI catalog.
- **Avoided:** another open-ended quality-discovery loop before users receive any Native release.
- **Preserved:** safety, correctness at process/path/protocol boundaries, transparency of known limitations and future expansion seams.
