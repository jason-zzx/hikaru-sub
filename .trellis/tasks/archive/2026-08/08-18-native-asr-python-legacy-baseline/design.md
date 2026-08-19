# 模型级 Python legacy 基线设计

## 1. Design Boundary

本任务新增一条资格比较边界，不改变 ASR 推理实现：

```text
validated WAV+ASS truth
        |
        +-- Python legacy baseline: current sidecar, explicit model identity, short/medium/long-v2
        |
        +-- Native candidate: explicit mapped identity, same cases
        |
        +-- shared T01 metrics
        |
        +-- subtitle-quality relative comparison
        +-- existing absolute performance/resource/engineering gates
```

Python 输出永远不能生成或修补 benchmark reference。它只作为与 native 候选的同模型字幕质量比较输入。

## 2. Identity Manifest

新增一个 tracked、去敏的模型 identity manifest，作为后续比较的唯一配对入口。每个条目包含：

- `logicalModelIdentity`：稳定的产品模型 identity；
- `family`：`whisper`、`kotoba`、`parakeet`、`qwen3` 或 `reazonspeech`；
- `python.engine`、`python.model`、Python artifact/revision/hash 和 companion；
- `native.engine`、`native.backend`、native artifact/model role、revision/hash 和 companion；
- `mappingRule`：解释跨格式配对，例如 Python Hugging Face/NeMo 模型与 native GGUF/CT2 snapshot 的同模型关系；
- `requiredCases`：固定为 `short-v1`、`medium-v1`、`long-v2`；
- `qualityGate`：`whisper-anchor`、`engine-model` 或 `whisper-family-unlock-only`；
- `comparisonProfile`：当前 Python legacy 参数和运行身份的稳定键。

当前逻辑条目：

| Family | Python identity | Native identity | Baseline policy |
|---|---|---|---|
| Whisper | `faster-whisper/large-v2` | CT2 `large-v2` | anchor |
| Whisper | `faster-whisper/large-v3` | CT2 `large-v3` | anchor |
| Whisper | `faster-whisper/{tiny,base,small,medium,large-v3-turbo}` | CT2 same model | family unlock after both anchors |
| Kotoba | `kotoba-tech/kotoba-whisper-v2.0-faster` | CT2 same model | full model gate |
| Parakeet | `nvidia/parakeet-tdt_ctc-0.6b-ja` | `parakeet-tdt-0.6b-ja-q8_0.gguf` | full model gate |
| Qwen3 | `Qwen/Qwen3-ASR-1.7B` + ForcedAligner `0.6B` | Qwen3 ASR/aligner GGUF pair | full model gate |
| ReazonSpeech | `reazon-research/reazonspeech-nemo-v2` | `reazonspeech-nemo-v2-q8_0.gguf` | full model gate |

The five non-anchor Whisper models remain visible and may be released after the two anchor gates pass, but their release rows still need the existing identity, model readiness, protocol, path, cancellation/recovery, privacy, license, and non-quality absolute evidence. They do not acquire a quality baseline by borrowing `large-v2` or `large-v3` metrics.

## 3. Baseline Acquisition

Reuse `scripts/asr-benchmark.py` and the existing registry. Do not add a second engine registry or a separate CER implementation.

The canonical quality baseline profile is the current Python legacy configuration used by the existing benchmark reference path, with its device, compute type, VAD, chunking, long-mode, seed, history, and model-specific parameters explicitly recorded. The acquisition lane is CUDA (`python-legacy-cuda-v1`, switched from CPU by user decision on 2026-08-18): the runner uses `--device cuda` and each engine's production CUDA compute resolution (CT2 float16 / long-mode int8_float16, NeMo float32 + `model.cuda()`, Qwen3 bfloat16 on `cuda:0` with the ForcedAligner on the same dtype/device). This single CUDA profile is the only Python quality reference for both native CPU and native CUDA rows; performance/resource metrics never compare relatively and keep their existing absolute gates. CPU rows captured before the switch are invalid under this profile and remain only as ignored raw history. Any future differently-configured legacy profile receives a distinct `comparisonProfile` and is never merged with these rows.

For each required identity:

- run `1 cold + 3 warm` on short-v1;
- run at least one complete medium-v1 and one complete long-v2 attempt;
- preserve final refresh replacement semantics;
- record completed, failed, skipped, and invalid states using the existing result envelope;
- keep all raw results below the exact ignored task-local root;
- publish only sanitized aggregate metrics and identity hashes.

A missing dependency/model or a load/environment failure is not a quality baseline. It is a named `unavailable`/`not-run` disposition and blocks only that model's relative quality qualification.

## 4. Comparison Contract

Add a small model-level comparison adapter around the existing benchmark result schema. It must validate both rows against the identity manifest before comparing.

### 4.1 Subtitle quality gates

For the same `logicalModelIdentity × case × comparisonProfile`, native subtitle quality must be no worse than Python legacy. The `python-legacy-cuda-v1` baseline pairs with both native CPU and native CUDA rows (quality fields only):

- normalized CER and its S/D/I counts as the text-quality result;
- empty-text result;
- confirmed semantic speech-gap count and duration;
- Qwen ForcedAligner timing median/P95 when both rows have eligible ForcedAligner provenance.

The following remain structural/engineering hard gates and are never relaxed by Python comparison: invalid/out-of-bounds timeline, negative or reversed/zero-duration cues, invalid UTF-8, text conservation, subtitle/protocol legality, complete matrix coverage, and all process, path, privacy, license, resource, cancellation and recovery contracts.

The publisher reports baseline value, native value, delta, comparison direction, provenance, and pass/fail for every relative quality field. No case average can hide a regression.

To keep the new gate from recreating the old absolute quality gate, the Python row is the quality reference for the listed subtitle-quality fields. T01 absolute CER `<=0.35`, semantic-gap zero and Qwen absolute timing limits no longer decide native subtitle quality after this handoff; they remain recorded diagnostics and are not silently changed in historical reports. Structural hard gates remain absolute.

If a required quality baseline row is invalid, missing, or identity-drifted, the native row is `baseline-incomplete` and unqualified. A Python candidate-caused complete structured failure is a valid baseline state only when its trace is complete and identity-bound; native completion can be reported as relative improvement, not as a reason to accept missing Python evidence.

### 4.2 Existing non-quality gates

The following continue unchanged from T01 and the parent task:

- CPU inference RTF `<=1.0`;
- accelerated GPU inference RTF `<=0.5` where applicable;
- short cold process wall `<=120s`;
- CTranslate2 peak RSS `<=6 GiB` and CrispASR peak RSS `<=12 GiB`;
- required sample count, complete matrix/attempt rules, identity attestation and truthful partial/full coverage;
- protocol, stdout/stderr, cancellation/reap, recovery, path containment, model hash, runtime/module/PATH, privacy and license contracts;
- package and runtime size limits and device pack rules.

Python performance/RSS values may be printed as diagnostic context but do not become relative gates and cannot weaken any absolute native limit.

## 5. Release Dispositions

The comparator emits independent dimensions:

```text
subtitleQualityDisposition:
  qualified | stop-revise | baseline-incomplete | unscored

nonQualityDisposition:
  qualified | stop-revise | unsupported-for-native-release | invalid-evidence

whisperFamilyDisposition:
  qualified | blocked | baseline-incomplete | stop-revise
```

For a non-Whisper model, native release eligibility requires its own subtitle-quality comparison plus existing structural, non-quality and engineering gates. A Python row with malformed or incomplete structural output does not authorize a malformed native output.

For Whisper:

1. `large-v2` and `large-v3` each complete the full matrix.
2. Each passes subtitle-quality non-regression against its own Python rows.
3. Each passes existing non-quality and engineering hard gates.
4. Only then does `whisperFamilyDisposition=qualified` unlock the other Whisper models for release qualification.
5. The unlocked models do not need independent Python subtitle-quality parity, but they cannot bypass model/package/identity and existing non-quality engineering gates.

One anchor's success cannot substitute for the other anchor. One non-anchor model's failure does not revoke the family gate unless it violates a shared runtime or security contract.

## 6. Downstream Document Changes

During implementation, update:

- parent `prd.md`, `design.md`, and `implement.md` to replace the global absolute subtitle-quality rule with the model-level baseline and Whisper family unlock rule;
- `.trellis/spec/asr/quality-guidelines.md` to make the new comparison contract durable while retaining absolute non-quality and security rules;
- future/unarchived task descriptions for T11/T14/T15/T18 and any task that still says Python is never a relative gate;
- this task's generated baseline handoff and context manifests.

Archived T01/T06/T08/T10/T10R evidence remains immutable. The new handoff points to historical reports where needed and records supersession without rewriting their disposition.

## 7. Rollback

This task has no production code or routing change. Rollback means removing the new comparison handoff and restoring the previous planning language in unstarted downstream artifacts. Historical benchmark evidence and Python sidecar behavior are untouched.
