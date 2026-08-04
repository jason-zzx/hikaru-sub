# T06 Candidate B Implementation Lock

## Decision

**Candidate B planning is converged and implementation-gated.** The only authorized native executor is the official Microsoft ONNX Runtime `1.28.0` Windows x64 CPU release ZIP. Candidate B is exactly ordinary `faster-whisper` `v1.2.1` Silero V6 behavior applied before the already selected timestamp-driven/no-history/beam-1 CT2 decode. It is not the batched-transcription `160ms` silence / `30s` maximum-speech path, current Hikaru Python VAD settings, Silero V4, or a second fallback ladder.

This lock authorizes a later minimal implementation review; it does not implement VAD, qualify a route, start another model, change Release/default routing, or activate T07. Candidate A, the CPU RTF diagnosis, beam selection, selected short/medium, and selected long identities remain immutable historical evidence sets.

## Activation Basis

The accepted selected CPU candidate used lock SHA-256 `0be239a83640c65f740f169da6c37a1141d3e92140d829243787671f9f410083` and passed large-v3 long-v1 CER `0.2653`, CPU inference RTF `0.550`, peak RSS `3.43 GB`, and timeline errors `0`, but failed the hard gate with `7` confirmed speech gaps `>=1500ms`. This is the failure class Candidate B is allowed to address. Large-v2 and all other product models remain `blocked-not-run` until Candidate B passes every large-v3 short/medium/long gate under one new final identity.

## ONNX Runtime Executor Lock

### Official release authority

| Field | Locked identity |
|---|---|
| Project | Microsoft ONNX Runtime |
| Version/tag | `v1.28.0` |
| Tag/GIT commit | `da9b5e364c465de65c49d91e696cd6485270757f` |
| Artifact | `onnxruntime-win-x64-1.28.0.zip` |
| URL | `https://github.com/microsoft/onnxruntime/releases/download/v1.28.0/onnxruntime-win-x64-1.28.0.zip` |
| Bytes | `78,796,801` |
| SHA-256 | `abef733dacbe2f571547a7150b479b5cb9cc0df22f96c24983a42cadb1b4f8bc` |
| `VERSION_NUMBER` | 8 bytes; SHA-256 `b056072036db8b4f37fbdb84a6c45992ceea413fd481b7a0489288c0708f2fae`; content `1.28.0` |
| `GIT_COMMIT_ID` | 43 bytes; SHA-256 `c7b502512e05a29cca9fb4e220d5d847e67075173fdce3a125166fc60bfe4491`; content commit above |
| C API | `ORT_API_VERSION=28` |
| License | MIT |

The official release ZIP is the sole build/runtime input. The NuGet package is supplemental cross-channel identity evidence only and must not replace the ZIP: `Microsoft.ML.OnnxRuntime` `1.28.0`, URL `https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.28.0/microsoft.ml.onnxruntime.1.28.0.nupkg`, `139,145,017` bytes, SHA-256 `769d1d3ea8ab6cd69f737c9dd4d4462aa4ad0ccfa106eaf506efc40d7bead5db`. Its Windows x64 `onnxruntime.dll`, import libraries, providers-shared DLL, LICENSE, and notices are byte-identical to the official ZIP identities below.

### Required extracted files

Only the direct C++ CPU-session closure is authorized. Training, experimental, custom-op, provider-factory abstraction, PDB, and custom ORT build inputs are excluded.

| File | Bytes | SHA-256 | Use |
|---|---:|---|---|
| `include/cpu_provider_factory.h` | 416 | `e2f658eeace78d79a8df82f233dcdeea135db498a77766156054bfc0d1d06c21` | explicitly append CPU EP with arena disabled |
| `include/onnxruntime_c_api.h` | 403,673 | `e3a01cdb382b2ba52267bf8a1a40d60b1197a1bac4da55667fe4d84e244f589a` | C API v28 |
| `include/onnxruntime_cxx_api.h` | 172,735 | `0765fc56924999b06b4c01f665d8fbd368582fed7a856a22ce1ed686a73e8be2` | header-only C++ wrapper |
| `include/onnxruntime_cxx_inline.h` | 161,868 | `e6c0478ab86467cfb4ac8694df3081ad1d42585c16f024d107638fb197e92f4a` | C++ wrapper implementation |
| `include/onnxruntime_ep_c_api.h` | 156,087 | `612dd6c3b5c7fa8f936fe07e1d8da4dc4727890011305b4f67279b132aa1c8e0` | required include closure |
| `include/onnxruntime_error_code.h` | 2,873 | `6690bf0df3f7a7a9c4f38597dc3232042e432b48ea166cb5672f72a49d32b742` | required include closure |
| `include/onnxruntime_float16.h` | 18,528 | `9b45e1bc0fe19d9d53f272b168f5cab616e26eb00136c3a1b78f394c9b1b6757` | required C++ include closure |
| `lib/onnxruntime.lib` | 2,124 | `b9fc3cd678257d88a111b0773ede4bfceaf0fe95daab4379f2b2b37348a68781` | sole link import library |
| `lib/onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` | CPU inference runtime |
| `lib/onnxruntime_providers_shared.dll` | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` | ship beside runtime DLL |
| `LICENSE` | 1,094 | `c250d6278f0b47a6439fb7592b08b58a55eb9f535aa49a1db63211c3f982b674` | MIT license |
| `ThirdPartyNotices.txt` | 331,175 | `fb0af774b4d7cffc5b9d046f2aaeade2f37df2f80abf8033c95dfffcc77a8866` | required notices |

`onnxruntime_providers_shared.lib` exists in the archive (`2,314` bytes, SHA-256 `8f8ee251580eabd4374c11f59df8b4bfe397b638a78f0f438df68442e95030a7`) but is not linked by this plan. PDBs and the other shipped headers are not product inputs.

### Windows runtime dependencies

`dumpbin /dependents` on the locked binaries records:

- VC runtime: `MSVCP140.dll`, `MSVCP140_1.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, and Universal CRT API-set DLLs for heap/runtime/stdio/string/convert/time/filesystem/math/locale;
- Windows system: `KERNEL32.dll`, `ADVAPI32.dll`, `dbghelp.dll`, `SETUPAPI.dll`, `dxgi.dll`, and `api-ms-win-core-path-l1-1-0.dll`;
- providers-shared directly imports `VCRUNTIME140.dll`, the UCRT runtime API set, and `KERNEL32.dll`.

T13 must satisfy the VC Redistributable dependency using the existing runtime packaging policy; these DLLs are not copied from the development machine or counted as new Candidate B payload here.

### Conditional packaging impact

Measured from the verified official ZIP and exact pinned VAD/licenses:

| Boundary | Bytes | Meaning |
|---|---:|---|
| Official ZIP download | `78,796,801` | development/source acquisition only |
| Entire extracted official SDK | `425,937,115` | includes PDBs; never the product payload |
| Minimal compile inputs | `918,304` | seven headers plus `onnxruntime.lib`; build-time only |
| Conditional installed runtime set | `17,411,263` | two ORT DLLs, pinned VAD model, ORT license/notices, faster-whisper LICENSE, Silero v6.0 LICENSE |
| Deterministic Deflate level-9 runtime ZIP | `6,903,308` | planning packaging estimate; SHA-256 `3ee9dabfca53a340aa64a4a5ce321ee59541cef79cf53a9e72d88f90f1f6f831` |

T13 packages these ORT/VAD inputs only if Candidate B is retained after the large-v3 gate. No PDB, NuGet package, header, import library, model weight other than the pinned VAD asset, or second executor enters the release payload.

## Silero V6 Attribution And Asset Relationship

### Behavior and distributed asset authority

| Input | Identity | License role |
|---|---|---|
| faster-whisper VAD behavior | `faster_whisper/vad.py`, v1.2.1 commit `65882eee9f5cdbeeb2d877f1131d48cf241b327d`, 12,543 bytes, SHA-256 `37a9c774aefdd3162d936b896c8dcf5571b2ed938d65bffecfd631770049a18d` | maintained implementation lock; MIT |
| faster-whisper audio scaling | `faster_whisper/audio.py` at the same commit, 3,506 bytes, SHA-256 `60a1d8638f718cbf6d245aed3e5a5aa61c1f822a0b0fe9b48a7c928d47c23909` | exact PCM16 conversion evidence; MIT |
| faster-whisper LICENSE | 1,064 bytes, SHA-256 `af6798135e729f8aa6c853936d037dfdea449734d26b8ea6a89805fca758c0d5` | MIT |
| selected VAD model | faster-whisper `assets/silero_vad_v6.onnx` at the same commit, 1,245,151 bytes, SHA-256 `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` | remains the only Candidate B model asset |
| upstream attribution | `snakers4/silero-vad` tag `v6.0`, commit `fba061dc5559f696e62171e9a0741782b0fdc23c` | MIT |
| upstream LICENSE | 1,075 bytes, SHA-256 `2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b` | ship attribution if Candidate B is retained |

The immutable upstream `v6.0` repository assets were obtained and compared:

| Upstream tag asset | Bytes | SHA-256 | Relationship to selected asset |
|---|---:|---|---|
| `src/silero_vad/data/silero_vad.onnx` | 2,327,524 | `597d30b3ec076608d059477bb14cfeffdf951bf5cae370d38f65d33bbfe82004` | different bytes/hash/schema |
| `src/silero_vad/data/silero_vad_16k_op15.onnx` | 1,289,603 | `794ed8a51d4f37faf0555383aa34dbaeeb83e3031a1df1e0351c457e1142bd3e` | different bytes/hash/schema |
| `src/silero_vad/data/silero_vad_half.onnx` | 1,280,395 | `1e0b195ad4806595ef4466f419d16fca7e4afcfc6669b8c0b5f76ea87547c769` | different bytes/hash/schema |

Therefore the selected faster-whisper asset is **not byte-identical to any ONNX asset tracked at upstream Silero tag v6.0**. Upstream assets expose `input/state/sr` or `input/state`; the selected faster-whisper asset exposes the batched `input/h/c` contract below. The upstream tag and MIT LICENSE establish attribution, not a replacement asset or a byte-identity claim. No immutable upstream release download matching `4cbf549b...` was found, so the already pinned faster-whisper asset remains authoritative.

## Exact Candidate B Algorithm

### Fixed configuration

Candidate B extends the selected CPU config; all CT2 decode values remain exactly timestamp-driven, `conditionOnPreviousText=false`, beam `1`, CPU `int8`, language `ja`, and the existing no-speech/timestamp/provenance behavior. The only added stage is this frozen VAD configuration:

```json
{"algorithm":"candidate-b-faster-whisper-v1.2.1-silero-v6","contextSamples":64,"encoderBatchRows":10000,"maxSpeechDurationSeconds":null,"minSilenceDurationMs":2000,"minSpeechDurationMs":0,"negativeThreshold":0.35,"sampleRate":16000,"speechPadMs":400,"threshold":0.5,"windowSamples":512}
```

`maxSpeechDurationSeconds:null` means ordinary faster-whisper's infinite/disabled maximum, not 30 seconds. No corpus-specific knob, request-specific override, current Hikaru `3000ms` silence setting, BatchedInferencePipeline `160ms` silence setting, or hidden fallback is allowed in the qualification identity.

### PCM and probability inference

1. Accept only the already verified mono 16 kHz signed PCM16 source. Convert each sample to float32 with exact division by `32768.0`; `-32768 -> -1.0` and `32767 -> 0.999969482421875`.
2. Tail-pad with zeros by `512 - (sampleCount % 512)` samples. This intentionally appends a full 512-sample zero frame when the source length is already divisible by 512, matching the pinned implementation.
3. Reshape to rows of 512 samples. Prepend 64 context samples to every row: the first row receives zeros; every later row receives the preceding row's final 64 source/padded samples. Each model row is therefore 576 float32 values.
4. Initialize `h` and `c` once per source file as zeros with shape `[1,1,128]`. Run rows in order in calls of at most 10,000 rows, carrying returned `hn`/`cn` into the next call. Do not reset recurrent state between 512-sample rows or 10,000-row calls.
5. ORT session options are inter-op threads `1`, intra-op threads `1`, CPU memory arena disabled, log severity `4`, explicitly appended CPU EP with arena `0`, and no custom ops.

Locked model schema under ORT 1.28.0:

| Direction | Name | Type | Shape |
|---|---|---|---|
| input | `input` | `tensor(float)` | `[-1,576]` (`seq_len`, 576) |
| input | `h` | `tensor(float)` | `[1,1,128]` |
| input | `c` | `tensor(float)` | `[1,1,128]` |
| output | `speech_probs` | `tensor(float)` | `[-1]` |
| output | `hn` | `tensor(float)` | `[1,1,128]` |
| output | `cn` | `tensor(float)` | `[1,1,128]` |

### Threshold, interval, padding, and merge semantics

- Start speech when probability is `>=0.5`.
- End-state silence requires probability `<0.35`, where `0.35 = max(0.5 - 0.15, 0.01)`. Values in `[0.35,0.5)` do not start speech and do not terminate already-triggered speech.
- Minimum retained speech duration is `0ms`; the pinned strict comparison retains only positive-duration intervals.
- Maximum speech duration is disabled/infinite. The `98ms` possible-end bookkeeping from the source remains behaviorally inert unless a finite maximum is introduced, which this lock forbids.
- End a triggered interval after `2000ms` of qualifying silence, using the first below-negative-threshold sample as the unpadded end.
- If speech remains triggered at EOF and its positive duration passes the minimum, end at the original, unpadded source sample count.
- Apply `400ms` (`6400` samples) padding. First start is bounded at `0`; last end is bounded at the original source length. For adjacent intervals with an unpadded silence gap `<800ms`, split that gap in half between the preceding end and following start; otherwise pad both sides by 400ms. Final intervals are ordered, non-overlapping, positive, and bounded to `[0, originalSampleCount]`.

### Silence compression, timestamp restoration, and progress

- Concatenate the retained padded speech intervals in source order into one compressed float32 stream. Ordinary faster-whisper uses unbounded `collect_chunks` here; do not impose the batched 30-second maximum-speech/chunk policy. CT2 still consumes its existing padded 30-second model windows over the compressed stream.
- Preserve for every compressed interval its original `[startSample,endSample)`, cumulative removed silence, and compressed end sample. Empty VAD output is an observable zero-speech result; do not rerun Candidate A.
- Restore each CT2 segment start/end using the pinned `SpeechTimestampsMap`: choose the compressed interval by `int(timeSeconds * 16000)` and right-bisect compressed ends, except an end exactly equal to a compressed interval end remains in that interval; add cumulative removed silence; round to two decimal seconds; then convert to protocol milliseconds. Retain raw compressed timestamps and restored source timestamps in ignored evidence.
- Apply the existing source-duration validation after restoration: non-empty ordered segments only, start at/after source end fails, and an otherwise legal raw end may be explicitly bounded to verified WAV end with provenance. No reference-derived timing/text, average allocation, hole repair, or giant-segment workaround is allowed.
- Decode progress is the restored original-source endpoint corresponding to confirmed compressed seek, clamped to verified source duration and monotonic. Skipped silence may advance source progress only when the following compressed boundary is confirmed; the final terminal progress is exactly source duration. Never report compressed duration or padded 30-second model duration as source progress.

### Cancellation and failure

- Check cancellation before ORT session/model creation, before and after each at-most-10,000-row ORT call, before each CT2 window, after each CT2 generation, and before completion. A single ORT or CT2 call remains process-cancellable through T05 process-tree termination.
- Missing/hash-mismatched VAD assets, ORT session creation failure, schema/type/shape mismatch, non-finite probability/state, ORT run failure, invalid intervals, or timestamp-restoration failure terminate the worker with a stable structured error where the process is alive. ORT load failure before worker startup remains a T05 abnormal-exit failure. In every case Candidate A is **not** silently retried.
- No `segmentsReplace` is introduced merely by VAD. Use it only if final restored/deduplicated output actually revises segments already emitted; the minimal implementation may defer segment emission until source-restored segments are final.

## Minimal Implementation Boundary

The later code change is deliberately narrow:

1. Link the locked official ORT import library and load the two locked DLLs beside the existing production worker.
2. Add one direct ORT session and the frozen VAD/interval/timestamp-map logic inside the existing CTranslate2 backend. Do not add an executor interface, provider factory, second backend, custom ORT build, Python/sidecar call, protocol field, downloader, readiness marker, or configurable fallback.
3. Resolve the exact VAD asset as a runtime companion beside the worker for T06 development and conditional T13 packaging; do not add a protocol model role.
4. Add CTest goldens that compare native probabilities, interval timestamps, tail-padding/context/state carry, and compressed-to-source restoration against the pinned faster-whisper source/model. Include schema/hash rejection and an ORT failure case proving no Candidate A fallback.
5. Rebuild and freeze a **new** final executable/DLL/VAD/config/tool identity. Historical Candidate A/diagnosis/selection/selected evidence remains unchanged.
6. Rerun only large-v3 short (1 cold + 3 warm), medium (one measured), and long-v1 (one measured) through the T01 comparator. Stop immediately if any CER/RTF/cold/RSS/timeline/gap/subtitle gate fails. Start large-v2 and the remaining five models only after all three large-v3 cases pass under the same new identity.
7. T13 packages ORT/VAD only if Candidate B is retained. A failed Candidate B leaves ORT/VAD out of the CPU package.

## Planning Preflight Evidence

All downloads, extraction, source clones, model bytes, tools, and outputs are below the canonical ignored T06 `research/local/candidate-b/` root. Tracked evidence records relative identities only.

| Local planning input/output | Bytes | SHA-256 |
|---|---:|---|
| ORT official ZIP | 78,796,801 | `abef733dacbe2f571547a7150b479b5cb9cc0df22f96c24983a42cadb1b4f8bc` |
| exact faster-whisper VAD model | 1,245,151 | `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` |
| preflight C++ source | 6,561 | `d49ce5b99f732b170328fd55516c358b38aa2d44e89b411572ad12b3c28e2dd1` |
| preflight command | 1,244 | `fad577fc293ef898f53f70418bc31d6d52d5da10f49e19dcbcdb5f6487a649be` |
| deterministic `/Brepro` preflight executable | 277,504 | `1eb74273774a1cc85dae228904348c24b46a3d907cbee3a1c3789c8b7f0a2e4a` |
| MSVC `cl.exe` | 682,568 | `f3b4b9300225963f98c580f253b231a312bf4b516d3a497d652a72bce9a7a21c` |
| MSVC `link.exe` | 3,422,280 | `195625614a2c4e64bab5b6273ea40caed080147627517c1bb5fff6d7571d359d` |
| MSVC `dumpbin.exe` | 22,584 | `bba79feb128ddb6ba9029cea60dd99be97c5144ed309f8e3a9f37faccb09517c` |
| sanitized preflight result | 485 | `dbcb81dc6800aaddb51f7ca82a7938ff66cd398b0a90265d387c995a32235877` |
| preflight stderr | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Toolchain: MSVC compiler `19.50.35722.0`, linker/dumpbin `14.50.35722.0`, Windows x64 Release; the preflight links with `/Brepro` and reproduced the same executable SHA-256 across two rebuilds. The smoke explicitly selected `CPUExecutionProvider`, registered no custom ops, loaded the exact model under ORT runtime `1.28.0` / API `28`, verified the schema above, and completed one zero-input stateful inference:

```text
zeroInputProbability=0.0238286257
zeroInputHnSum=5.9900574
zeroInputCnSum=10.5416021
result=pass
```

The global runtime provider inventory also reported `AzureExecutionProvider,CPUExecutionProvider`; only CPU was appended to this session. No ASR inference or authoritative corpus audio was used.

## Validation And Reproduction Commands

Run from the repository root in a Windows x64 MSVC developer environment:

```powershell
$root = ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b"
$ortUrl = "https://github.com/microsoft/onnxruntime/releases/download/v1.28.0/onnxruntime-win-x64-1.28.0.zip"
Invoke-WebRequest $ortUrl -OutFile "$root/downloads/onnxruntime-win-x64-1.28.0.zip"
(Get-Item "$root/downloads/onnxruntime-win-x64-1.28.0.zip").Length
(Get-FileHash "$root/downloads/onnxruntime-win-x64-1.28.0.zip" -Algorithm SHA256).Hash.ToLowerInvariant()
Expand-Archive "$root/downloads/onnxruntime-win-x64-1.28.0.zip" "$root/extracted" -Force

Copy-Item "asr-service/.venv/Lib/site-packages/faster_whisper/assets/silero_vad_v6.onnx" "$root/model/silero_vad_v6.onnx" -Force
(Get-FileHash "$root/model/silero_vad_v6.onnx" -Algorithm SHA256).Hash.ToLowerInvariant()

git clone --depth 1 --branch v6.0 https://github.com/snakers4/silero-vad.git "$root/sources/silero-vad-v6.0"
git -C "$root/sources/silero-vad-v6.0" rev-parse HEAD

& "$root/preflight/run-preflight.cmd"
Get-Content "$root/preflight/result.txt"
```

Required checks before Candidate B implementation:

```powershell
python ./.trellis/scripts/task.py validate .trellis/tasks/08-02-native-asr-ctranslate2-whisper
git check-ignore -v .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/preflight/result.txt
git diff --check
git diff --cached --name-only
```

The implementation iteration must add the focused CTest golden, rebuild, freeze the new runtime/config identity, then run only large-v3 short/medium/long commands recorded in the revised final candidate lock. No model-backed command is authorized by this planning document itself.

## Rollback

Delete only `.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/` and any later ignored Candidate B build/raw outputs. Retain all selected Candidate A evidence, T04/T05 infrastructure, and the Python legacy/default route. Do not modify user models, caches, projects, T07, or release packaging. If Candidate B fails any large-v3 gate, remove ORT/VAD from the T13 package input and return the route to `stop-revise`; never fall back silently inside the worker.
