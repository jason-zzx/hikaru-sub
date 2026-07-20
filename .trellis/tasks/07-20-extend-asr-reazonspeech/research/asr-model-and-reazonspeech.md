# ASR model and ReazonSpeech research

Research date: 2026-07-20

## Decision summary

- Add the faster-whisper model under the short name `large-v3-turbo`. The existing
  `faster-whisper>=1.1.1` requirement already recognizes this alias, so no dependency
  change is required for this part.
- Add ReazonSpeech as a separate engine id, recommended as `reazonspeech-nemo` with
  the sole model id `reazon-research/reazonspeech-nemo-v2`.
- Reuse the existing optional NeMo/PyTorch stack. The official ReazonSpeech helper
  package requires `nemo_toolkit[asr]>=2.6.1`; Hikaru Sub currently pins NeMo 2.7.3
  for Parakeet and torch/torchaudio >=2.6.0, so the heavy dependencies are compatible.
- Prefer a local engine adapter on top of NeMo over installing the official helper
  package from GitHub at runtime. The helper is not available from the configured
  package index and its official installation path is source-based; a direct GitHub
  dependency would bypass the app's official/China pip source selection. The adapter
  only needs the model-specific hypothesis-to-segment decoding and can keep model
  downloads on `HF_HOME`/`HF_ENDPOINT`.
- Product decision still needed: native whole-audio inference preserves the model's
  long-form design but provides only coarse/best-effort cancellation and no incremental
  progress; shared chunking/VAD improves responsiveness but changes inference context.

## faster-whisper large-v3-turbo

### Model name and compatibility

The upstream faster-whisper model registry in both v1.1.0 and v1.1.1 contains:

```python
"large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
"turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
```

Hikaru Sub already requires `faster-whisper>=1.1.1`, and its engine resolves short
names through `faster_whisper.utils._MODELS`. The frontend should therefore add
`large-v3-turbo`, not a new full repository id. Existing fallback repo construction is
not expected to run when the installed engine is available.

The converted model contains the same files already accepted by
`FasterWhisperEngine`: `config.json`, `model.bin`, `tokenizer.json`,
`preprocessor_config.json`, and `vocabulary.json`. No new cache readiness rule is
needed.

### Sources

- faster-whisper v1.1.1 registry:
  https://github.com/SYSTRAN/faster-whisper/blob/v1.1.1/faster_whisper/utils.py
- Current upstream registry:
  https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py
- Converted model card (MIT):
  https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo
- Original OpenAI model:
  https://huggingface.co/openai/whisper-large-v3-turbo

## ReazonSpeech NeMo v2

### Model facts

- Model id: `reazon-research/reazonspeech-nemo-v2`.
- Artifact: `reazonspeech-nemo-v2.nemo` (the model repository contains one NeMo
  weight file plus its README).
- Repository size reported by the Hugging Face API: about 2.48 GB.
- Architecture: 619M-parameter subword RNN-T with FastConformer/Longformer encoder.
- Language: Japanese.
- The official model card says it supports long-form clips up to several hours.
- Model and upstream helper code are Apache-2.0.

Sources:

- Model card:
  https://huggingface.co/reazon-research/reazonspeech-nemo-v2
- Hugging Face model metadata:
  https://huggingface.co/api/models/reazon-research/reazonspeech-nemo-v2
- Upstream repository:
  https://github.com/reazon-research/reazonspeech

### Official helper API

The upstream source package is named `reazonspeech-nemo-asr`, version 3.0.0. Its
`pyproject.toml` declares:

```toml
dependencies = [
  "numpy",
  "librosa",
  "soundfile",
  "torch",
  "nemo_toolkit[asr] >= 2.6.1",
]
```

Official usage is:

```python
from reazonspeech.nemo.asr import load_model, transcribe, audio_from_path
model = load_model()
audio = audio_from_path("speech.wav")
result = transcribe(model, audio)
```

`load_model(device)` selects CPU or CUDA and calls
`EncDecRNNTBPEModel.from_pretrained(..., map_location=device)`. `transcribe` submits
one complete waveform with `return_hypotheses=True`. The helper decodes the RNN-T
hypothesis into:

- full text;
- subword point timestamps;
- subtitle-ready segments with `start_seconds`, `end_seconds`, and `text`.

Its timestamp decoder applies model-specific constants (`0.08` seconds per step,
`0.5` seconds input padding) and punctuation/pause segmentation. This is more precise
for this model than treating the output as generic NeMo char timestamps.

Primary source files:

- Package metadata:
  https://github.com/reazon-research/reazonspeech/blob/master/pkg/nemo-asr/pyproject.toml
- Loader and inference:
  https://github.com/reazon-research/reazonspeech/blob/master/pkg/nemo-asr/src/transcribe.py
- Timestamp/segment decoder:
  https://github.com/reazon-research/reazonspeech/blob/master/pkg/nemo-asr/src/decode.py
- Result types:
  https://github.com/reazon-research/reazonspeech/blob/master/pkg/nemo-asr/src/interface.py

### Package availability and Windows/Python check

- The configured `pip index` reported no published `reazonspeech-nemo-asr`
  distribution. The official README documents cloning the repository and installing
  `pkg/nemo-asr`.
- A source archive pinned to upstream commit
  `2d4d4762e7ee294ac8e47a177ac2e9b0e8d0d43f` built successfully on local Windows
  with Python 3.11.15 as a `py3-none-any` wheel. This establishes that the helper
  source itself is portable; it does not prove every NeMo/CUDA runtime combination.
- Direct archive installation would still depend on GitHub availability and would not
  be redirected by the app's pip mirror settings. For managed installs, avoiding this
  runtime source is safer.
- CPU and CUDA are both explicit official paths. Actual performance and GPU memory
  usage need model-backed validation; the 619M model is expected to be slow on CPU.

### Reuse versus new dependencies

Existing reusable pieces:

- `nemo_toolkit[asr]==2.7.3`, `torch>=2.6.0`, `torchaudio>=2.6.0` from the Parakeet
  CPU/CUDA profiles;
- `huggingface_hub>=0.23.0`, managed `HF_HOME`, and optional `HF_ENDPOINT` mirror;
- model download job/progress infrastructure;
- `engines.chunking` audio duration, WAV slicing, overlap merge, and Japanese subtitle
  assembly helpers if chunked inference is selected;
- lazy dependency detection and CPU/CUDA setup profile selection.

New engine-specific behavior:

- availability should identify both NeMo/Torch and the ReazonSpeech adapter capability;
- cache readiness should look for `reazonspeech-nemo-v2.nemo` in the exact HF repo;
- load should use `EncDecRNNTBPEModel` and honor `cpu`, `cuda`, and `auto`;
- inference must convert model-specific RNN-T subword timestamps into `AsrSegment`;
- diagnostics and user-facing errors should name ReazonSpeech, not Parakeet.

Recommended dependency shape:

- keep a separately named ReazonSpeech CPU/CUDA setup profile for accurate UI and
  engine validation;
- have those profiles reuse a shared NeMo requirement set rather than duplicate NeMo
  and Torch pins;
- do not install the upstream helper package unless a reliable package source is added;
  keep the small model-specific decode in the adapter and retain Apache attribution in
  `THIRD_PARTY_NOTICES.md`.

### Long-audio, progress, and cancellation trade-off

Native path:

- Pass the complete 16 kHz waveform to the official model behavior.
- Preserves its several-hour long-form context and official segmentation.
- The NeMo call is blocking and has no cancellation/progress callback. Hikaru Sub can
  check cancellation before and after the call, but cannot promptly interrupt it.

Chunked/VAD path:

- Reuse Hikaru Sub's WAV chunk planning and merge helpers.
- Provides progress and cancellation between chunks and bounds memory.
- Changes model context and requires overlap/dedup behavior; using the current 45-second
  Parakeet default would largely discard ReazonSpeech's long-form advantage.

A hybrid is possible: native whole-audio by default, shared VAD/chunking only when the
user enables VAD. It preserves the advertised default while offering a responsive mode,
but introduces two inference paths and therefore more tests.

## Local integration surface

Likely files/contracts, based on current code:

- `src/constants/asr.ts` and tests: engine/model options and `large-v3-turbo`.
- `src/constants/asrSetup.ts`, `src/types/index.ts`, and tests: dependency profile.
- `SettingsTranscriptionPanel.tsx` / `TranscribeView.tsx`: engine-specific descriptions
  and any VAD visibility decision.
- `asr-service/engines/registry.py`: register engine.
- New `asr-service/engines/reazonspeech_nemo.py` and focused tests.
- Reusable/new requirements files plus `scripts/setup-asr.sh`.
- `src-tauri/src/asr_setup.rs`: profile requirements, source handling, validation, and
  tests.
- Keep `src-tauri/resources/asr-service/` synchronized with the development tree.
- Update `README.md`, `asr-service/README.md`, and `THIRD_PARTY_NOTICES.md`.

## Validation gaps

- The ReazonSpeech model was not downloaded or run during planning; exact CPU speed,
  CUDA memory use, NeMo 2.7.3 runtime behavior, and timestamp output require a real
  model-backed smoke test.
- Windows source-wheel build succeeded, but optional NeMo dependencies can still expose
  Windows-specific failures.
- China mirror availability for the 2.48 GB model should be tested through
  `HF_ENDPOINT=https://hf-mirror.com` before claiming support.
