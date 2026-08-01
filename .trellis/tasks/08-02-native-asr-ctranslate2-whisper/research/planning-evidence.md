# T06 Planning Evidence

## T02 Findings To Carry Forward

- CTranslate2 4.8.0 + oneDNN 3.1.1 Windows x64 CPU int8 is executable without Python/CUDA.
- T02 final matrix used one immutable executable/DLL/input-lock identity and legal token-derived timelines.
- CPU RTF/RSS were within frozen gates.
- The fixed-window candidate failed product quality: large-v3 short CER 0.3583; large-v3 medium/long had 10/71 confirmed gaps. Backend viability and algorithm qualification are separate.
- Source seek duration and padded 30-second model timestamp range are distinct; verified WAV-end bounds require raw provenance.
- Kotoba belongs to T07 even though T02 measured it.

## Current Product Facts

- `src/constants/asr.ts` exposes ordinary models: tiny, base, small, medium, large-v2, large-v3, large-v3-turbo.
- large-v3 is the current default.
- Current Python large-v2 Japanese >=600000ms path uses a private/forked V4/seed/session design. It remains a mandatory regression case but not implementation authority.
- T01 frozen gates are per model/case: CER <=0.35, CPU inference RTF <=1.0, short cold <=120s, CT2 RSS <=6 GiB, zero invalid/out-of-bounds timeline, zero confirmed gaps >=1500ms.
- Corpus-wide positive coverage still lacks low-volume.

## User Decisions

- large-v3 and large-v2 long-audio are hard native promotion gates.
- Every current model must be measured and classified.
- Failure of another non-default model does not block a qualified native faster-whisper route.
- T16 must still display all model identities. Qualification controls runnable/disabled status and explanation; release never silently falls back to Python.

## Algorithm Planning Decisions

- Promote only T02 primitives proven independently: WAV/mel/tokenizer/load/timestamp/provenance.
- Replace unconditional fixed non-overlap seek with one pinned authoritative timestamp-driven candidate.
- Stop if Candidate A passes; only then, if gaps remain, evaluate one pre-pinned maintained VAD/chunk candidate.
- Do not add multiple corpus-specific repair passes, reference-derived splits, synthetic timestamps or Python private-fork parity.
- Freeze one selected algorithm/config before running the seven-model matrix.

## Task Boundaries

- T04 owns protocol and test-only fake worker; T05 owns host/cancel/recovery; T06 creates the production `hikaru-asr-worker` entry/CMake target and first real route.
- T07 owns Kotoba/cache compatibility.
- T11 owns model manifest/download/readiness.
- T12 owns the reproducible CPU packaging pipeline/provisional artifact; T17 owns final CPU rebuild, attestation and release identity.
- T13/T14 own CUDA/Vulkan and accelerated RTF.
- T15/T16 own qualification metadata persistence and all-model-visible UI.

Before T06 starts, its manifests must be refreshed to T04/T05 final archived handoffs.
