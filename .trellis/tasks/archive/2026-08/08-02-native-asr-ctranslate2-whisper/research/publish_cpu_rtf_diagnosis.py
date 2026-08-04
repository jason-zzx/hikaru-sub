#!/usr/bin/env python3
"""Publish sanitized deterministic T06 CPU RTF diagnostic evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

EXPECTED_RAW_SHA256 = "91389cf995b80ca03cd5f9f17603b256677ea4f456cadbe84e22ca3780ef04da"
EXPECTED_SOURCE_SHA256 = "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458"
EXPECTED_SLICE_SHA256 = "d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42"
EXPECTED_MODEL_ID = "Systran/faster-whisper-large-v3"
EXPECTED_MODEL_REVISION = "edaa852ec7e145841d8ffdb056a99866b5f0a478"
EXPECTED_MODEL_FILES = {
    "config.json": (2_394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
    "model.bin": (3_087_284_237, "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"),
    "preprocessor_config.json": (340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
    "tokenizer.json": (2_480_617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
    "vocabulary.json": (1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
}
EXPECTED_RUNTIME_DLLS = {
    "ctranslate2.dll": (22_417_408, "e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59"),
    "hikaru_asr_tokenizer.dll": (2_137_088, "892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d"),
}
EXPECTED_CELLS = {
    "A": {"config": {"seek": "fixed-30s", "history": "off", "beamSize": 5}, "windows": 4},
    "B": {"config": {"seek": "timestamp-driven", "history": "off", "beamSize": 5}, "windows": 5},
    "C": {"config": {"seek": "timestamp-driven", "history": "full-official", "beamSize": 5}, "windows": 5},
    "D": {"config": {"seek": "timestamp-driven", "history": "full-official", "beamSize": 1}, "windows": 5},
}
WINDOW_FIELDS = {
    "windowOffsetMs",
    "sourceWindowDurationMs",
    "modelWindowDurationMs",
    "seekFramesBefore",
    "seekFramesAfter",
    "sourceOverlapMs",
    "promptTokenCount",
    "historyTokenCountBefore",
    "historyTokenCountAfter",
    "prefixForwardTokenCount",
    "generatedTokenCount",
    "featureMs",
    "generateMs",
    "generationCallCount",
    "fallbackCallCount",
    "parseStatus",
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def percent_change(after: float, before: float) -> float:
    if before == 0:
        raise ValueError("diagnostic baseline is zero")
    return (after / before - 1.0) * 100.0


def validate_file_entries(entries: list[dict], expected: dict[str, tuple[int, str]], label: str) -> None:
    files = {entry.get("name"): entry for entry in entries}
    if len(entries) != len(files) or set(files) != set(expected):
        raise ValueError(f"{label} file set mismatch")
    for name, (size, sha256) in expected.items():
        if files[name].get("sizeBytes") != size or files[name].get("sha256") != sha256:
            raise ValueError(f"{label} identity mismatch: {name}")


def validate(raw: dict) -> dict[str, dict]:
    if raw.get("kind") != "hikaru-ct2-whisper-cpu-rtf-diagnostic":
        raise ValueError("unexpected diagnostic kind")
    if raw.get("status") != "completed" or raw.get("qualificationEligible") is not False:
        raise ValueError("diagnostic status/eligibility mismatch")
    source = raw.get("source", {})
    if source.get("caseId") != "medium-v1-first-120s-diagnostic":
        raise ValueError("diagnostic source case mismatch")
    if source.get("authoritativeWavSha256") != EXPECTED_SOURCE_SHA256:
        raise ValueError("authoritative source identity mismatch")
    if source.get("sliceDurationMs") != 120_000:
        raise ValueError("diagnostic slice must be exactly 120 seconds")
    if source.get("sliceSha256") != EXPECTED_SLICE_SHA256:
        raise ValueError("diagnostic first-120s slice identity mismatch")
    model = raw.get("model", {})
    if model.get("id") != EXPECTED_MODEL_ID or model.get("revision") != EXPECTED_MODEL_REVISION:
        raise ValueError("diagnostic model identity mismatch")
    validate_file_entries(model.get("files", []), EXPECTED_MODEL_FILES, "diagnostic model")

    runtime = raw.get("runtime", {})
    if (
        runtime.get("device") != "cpu"
        or runtime.get("computeType") != "int8"
        or runtime.get("ctranslate2Version") != "4.8.0"
        or runtime.get("oneDnnVersion") != "3.1.1"
        or runtime.get("oneDnnLinkage") != "static"
        or runtime.get("openMpRuntime") != "COMP"
    ):
        raise ValueError("diagnostic runtime config mismatch")
    executable = runtime.get("measurementExecutable", {})
    if executable.get("sizeBytes", 0) <= 0 or not re.fullmatch(
        r"[0-9a-f]{64}", executable.get("sha256", "")
    ):
        raise ValueError("diagnostic executable identity is missing")
    validate_file_entries(runtime.get("requiredDlls", []), EXPECTED_RUNTIME_DLLS, "diagnostic runtime")
    if not runtime.get("cpuModel") or runtime.get("logicalCores", 0) <= 0:
        raise ValueError("diagnostic CPU identity is incomplete")
    isa = runtime.get("availableIsa", {})
    if set(isa) != {"sse2", "avx", "avx2", "fma", "avx512f"} or any(
        not isinstance(value, bool) for value in isa.values()
    ):
        raise ValueError("diagnostic ISA capability inventory is invalid")
    modules = {module.get("name", "").lower(): module for module in runtime.get("loadedModules", [])}
    if len(modules) != len(runtime.get("loadedModules", [])):
        raise ValueError("diagnostic loaded-module inventory has duplicate names")
    if "vcomp140.dll" not in modules or "ctranslate2.dll" not in modules:
        raise ValueError("diagnostic OpenMP/CTranslate2 loaded-module attestation is incomplete")
    if any("dnnl" in name for name in modules):
        raise ValueError("static oneDNN build unexpectedly loaded a oneDNN DLL")
    if {
        key: (value.get("sizeBytes"), value.get("sha256"))
        for key, value in modules.items()
        if key == "ctranslate2.dll"
    } != {"ctranslate2.dll": EXPECTED_RUNTIME_DLLS["ctranslate2.dll"]}:
        raise ValueError("loaded CTranslate2 module differs from the required DLL identity")

    raw_cells = raw.get("cells", [])
    cells = {cell.get("id"): cell for cell in raw_cells}
    if len(raw_cells) != len(cells) or set(cells) != set(EXPECTED_CELLS):
        raise ValueError("diagnostic cells must be exactly A/B/C/D")
    thread_identities = set()
    for cell_id, expected in EXPECTED_CELLS.items():
        cell = cells[cell_id]
        if cell.get("config") != expected["config"]:
            raise ValueError(f"diagnostic cell {cell_id} config mismatch")
        if cell.get("status") != "completed" or cell.get("failureCode") is not None:
            raise ValueError(f"diagnostic cell {cell_id} did not complete")
        warmup = cell.get("warmup", {})
        if warmup.get("excludedFromComparison") is not True:
            raise ValueError(f"diagnostic cell {cell_id} warmup is not explicitly excluded")
        if warmup.get("windowCount") != expected["windows"]:
            raise ValueError(f"diagnostic cell {cell_id} warmup window count mismatch")
        for field in ("wallMs", "featureMs", "modelGenerateMs", "inferenceMs"):
            value = warmup.get(field, 0)
            if value <= 0 or value > 600_000:
                raise ValueError(f"diagnostic cell {cell_id} warmup {field} is unbounded/incomplete")
        if "windows" in warmup or "timings" in warmup:
            raise ValueError(f"diagnostic cell {cell_id} warmup retained comparison payload")
        timings = cell.get("timings", {})
        if timings.get("inferenceRtf", 0) <= 0 or timings.get("modelGenerateMs", 0) <= 0:
            raise ValueError(f"diagnostic cell {cell_id} timing is incomplete")
        expected_rtf = timings.get("inferenceMs", 0) / 120_000
        if abs(timings.get("inferenceRtf", 0) - expected_rtf) > 1e-12:
            raise ValueError(f"diagnostic cell {cell_id} inference RTF denominator mismatch")
        if timings.get("featureMs", 0) + timings.get("modelGenerateMs", 0) > timings.get("inferenceMs", 0):
            raise ValueError(f"diagnostic cell {cell_id} component timing exceeds inference time")
        windows = cell.get("windows", [])
        if not windows:
            raise ValueError(f"diagnostic cell {cell_id} has no windows")
        totals = cell.get("totals", {})
        sums = {
            "generatedTokenCount": sum(int(window["generatedTokenCount"]) for window in windows),
            "prefixForwardTokenCount": sum(int(window["prefixForwardTokenCount"]) for window in windows),
            "sourceOverlapMs": sum(int(window["sourceOverlapMs"]) for window in windows),
            "generationCallCount": sum(int(window["generationCallCount"]) for window in windows),
            "fallbackCallCount": sum(int(window["fallbackCallCount"]) for window in windows),
        }
        if totals.get("windowCount") != len(windows) or len(windows) != expected["windows"]:
            raise ValueError(f"diagnostic cell {cell_id} window count mismatch")
        if not re.fullmatch(r"[0-9a-f]{64}", totals.get("firstWindowTraceSha256", "")):
            raise ValueError(f"diagnostic cell {cell_id} first-window trace identity is missing")
        previous_seek_after = 0
        for window in windows:
            missing = WINDOW_FIELDS - set(window)
            if missing:
                raise ValueError(f"diagnostic cell {cell_id} window fields missing: {sorted(missing)}")
            if window["modelWindowDurationMs"] != 30_000:
                raise ValueError(f"diagnostic cell {cell_id} model window drift")
            if window["sourceWindowDurationMs"] <= 0 or window["windowOffsetMs"] >= 120_000:
                raise ValueError(f"diagnostic cell {cell_id} emitted a zero/extra source window")
            if window["generationCallCount"] != 1 or window["fallbackCallCount"] != 0:
                raise ValueError(f"diagnostic cell {cell_id} changed generation/fallback count")
            seek_before = int(window["seekFramesBefore"])
            seek_after = int(window["seekFramesAfter"])
            if seek_before != previous_seek_after or window["windowOffsetMs"] != seek_before * 10:
                raise ValueError(f"diagnostic cell {cell_id} seek/window chain mismatch")
            expected_source_ms = min(30_000, 120_000 - window["windowOffsetMs"])
            if window["sourceWindowDurationMs"] != expected_source_ms:
                raise ValueError(f"diagnostic cell {cell_id} source-window duration mismatch")
            if not seek_before < seek_after <= 12_000:
                raise ValueError(f"diagnostic cell {cell_id} seek did not advance within the 120s slice")
            expected_overlap = max(0, expected_source_ms - (seek_after - seek_before) * 10)
            if window["sourceOverlapMs"] != expected_overlap:
                raise ValueError(f"diagnostic cell {cell_id} overlap accounting mismatch")
            if expected["config"]["seek"] == "fixed-30s" and seek_after - seek_before != 3_000:
                raise ValueError(f"diagnostic cell {cell_id} fixed seek drift")
            history_before = int(window["historyTokenCountBefore"])
            if expected["config"]["history"] == "off":
                if history_before != 0 or window["historyTokenCountAfter"] != 0:
                    raise ValueError(f"diagnostic cell {cell_id} no-history control retained history")
                expected_prompt = 3
            else:
                expected_prompt = 3 if history_before == 0 else min(history_before, 223) + 4
            if window["promptTokenCount"] != expected_prompt:
                raise ValueError(f"diagnostic cell {cell_id} prompt/history accounting mismatch")
            if window["prefixForwardTokenCount"] != expected_prompt - 1:
                raise ValueError(f"diagnostic cell {cell_id} prefix-forward accounting mismatch")
            previous_seek_after = seek_after
        if previous_seek_after != 12_000:
            raise ValueError(f"diagnostic cell {cell_id} did not terminate exactly at 120s")
        for key, value in sums.items():
            if totals.get(key) != value:
                raise ValueError(f"diagnostic cell {cell_id} {key} mismatch")
        if warmup.get("generatedTokenCount") != totals.get("generatedTokenCount"):
            raise ValueError(f"diagnostic cell {cell_id} warmup/measured token trace drift")
        threads = cell.get("threads", {})
        thread_identities.add(
            (threads.get("resolvedIntraThreads"), threads.get("resolvedInterThreads"))
        )
    if len(thread_identities) != 1 or any(
        value in (None, 0) for value in next(iter(thread_identities))
    ):
        raise ValueError("diagnostic thread identity differs between cells")
    comparable = [cells[cell_id]["windows"][0] for cell_id in "ABC"]
    for field in (
        "windowOffsetMs",
        "sourceWindowDurationMs",
        "modelWindowDurationMs",
        "seekFramesBefore",
        "promptTokenCount",
        "historyTokenCountBefore",
        "generatedTokenCount",
        "sha256",
    ):
        if len({window[field] for window in comparable}) != 1:
            raise ValueError(f"A/B/C first-window comparable field differs: {field}")
    return cells


def read_onednn_info(path: Path | None) -> list[str]:
    if path is None:
        return []
    data = path.read_bytes()
    if len(data) > 65_536:
        raise ValueError("oneDNN diagnostic log exceeds the bounded size")
    text = data.decode("utf-8", errors="replace")
    info = []
    for line in text.splitlines():
        if not line.startswith("onednn_verbose,info"):
            continue
        if re.search(r"[A-Za-z]:[\\/]|/Users/|\\Users\\", line):
            raise ValueError("oneDNN info unexpectedly contains an absolute path")
        info.append(line.strip())
    return sorted(set(info))


def warmup_row(cell: dict) -> str:
    warmup = cell["warmup"]
    return (
        f"| {cell['id']} | `{warmup['wallMs']:.1f}` | `{warmup['inferenceMs']:.1f}` | "
        f"`{warmup['modelGenerateMs']:.1f}` | {warmup['windowCount']} | yes |"
    )


def cell_row(cell: dict) -> str:
    timings = cell["timings"]
    totals = cell["totals"]
    return (
        f"| {cell['id']} | {cell['config']['seek']} | {cell['config']['history']} | "
        f"{cell['config']['beamSize']} | `{timings['inferenceRtf']:.3f}` | "
        f"`{timings['modelGenerateMs']:.1f}` | {totals['windowCount']} | "
        f"{totals['generatedTokenCount']} | {totals['prefixForwardTokenCount']} | "
        f"{totals['sourceOverlapMs']} |"
    )


def conclusion(cells: dict[str, dict]) -> tuple[str, list[str]]:
    a = cells["A"]["timings"]["inferenceRtf"]
    b = cells["B"]["timings"]["inferenceRtf"]
    c = cells["C"]["timings"]["inferenceRtf"]
    d = cells["D"]["timings"]["inferenceRtf"]
    seek_delta = percent_change(b, a)
    history_delta = percent_change(c, b)
    beam_delta = percent_change(d, c)
    facts = [
        f"A→B seek-only RTF change: `{seek_delta:+.1f}%`.",
        f"B→C full-history RTF change: `{history_delta:+.1f}%`.",
        f"C→D beam-5-to-1 RTF change: `{beam_delta:+.1f}%`.",
    ]
    if a <= 1.0 and b <= 1.0:
        decision = (
            "The no-history controls remain below the frozen CPU RTF ceiling, so this matrix "
            "does not support an inherent CTranslate2/large-v3 CPU ceiling on this machine."
        )
        if history_delta >= 15.0:
            decision += " Full previous-text history is a confirmed dominant regression factor."
        if d <= c * 0.9:
            decision += " Beam size 5 materially increases total cost in the full-history configuration."
    else:
        decision = (
            "At least one no-history control remains above the CPU RTF ceiling. The primary "
            "matrix is insufficient to declare an inherent ceiling; return_scores and a bounded "
            "thread sweep are required before a GPU-required decision."
        )
    return decision, facts


def render(
    raw: dict,
    cells: dict[str, dict],
    onednn_info: list[str],
    publisher_sha256: str,
) -> str:
    decision, facts = conclusion(cells)
    runtime = raw["runtime"]
    threads = cells["A"]["threads"]
    modules = runtime.get("loadedModules", [])
    module_text = ", ".join(module["name"] for module in modules) or "none observed"
    info_text = "\n".join(f"- `{line}`" for line in onednn_info) or "- No bounded oneDNN info line was captured."
    warmup_rows = "\n".join(warmup_row(cells[cell_id]) for cell_id in "ABCD")
    rows = "\n".join(cell_row(cells[cell_id]) for cell_id in "ABCD")
    comparable_trace = cells["A"]["totals"]["firstWindowTraceSha256"]
    c_totals = cells["C"]["totals"]
    d_totals = cells["D"]["totals"]
    runtime_dlls = {item["name"]: item for item in runtime["requiredDlls"]}
    return f"""# T06 CPU RTF Root-Cause Diagnostic

## Scope

This is a same-binary diagnostic on the deterministic first 120 seconds of authoritative `medium-v1`. It is **not qualification evidence** and contains no transcript, token IDs, media, or absolute paths. Every cell loads one backend, runs one bounded warmup pass that is explicitly excluded, then records a second measured pass. The prior Candidate A report remains a historical provisional baseline; any retained candidate requires a new lock and authoritative reruns.

## Runtime Identity

- Ignored raw evidence SHA-256: `{EXPECTED_RAW_SHA256}`
- Diagnostic publisher SHA-256: `{publisher_sha256}`
- Diagnostic slice SHA-256: `{raw['source']['sliceSha256']}` (verified local PCM is exactly the source WAV's first 120 seconds)
- Source WAV SHA-256: `{raw['source']['authoritativeWavSha256']}`
- Model: `{raw['model']['id']}` revision `{raw['model']['revision']}`; `model.bin` SHA-256 `{EXPECTED_MODEL_FILES['model.bin'][1]}`
- Measurement executable SHA-256: `{runtime['measurementExecutable']['sha256']}`
- CTranslate2 DLL SHA-256: `{runtime_dlls['ctranslate2.dll']['sha256']}`
- Tokenizer DLL SHA-256: `{runtime_dlls['hikaru_asr_tokenizer.dll']['sha256']}`
- CPU: `{runtime['cpuModel']}`; logical cores `{runtime['logicalCores']}`
- Resolved threads: intra `{threads['resolvedIntraThreads']}`, inter `{threads['resolvedInterThreads']}`
- CTranslate2 `{runtime['ctranslate2Version']}`, oneDNN `{runtime['oneDnnVersion']}` `{runtime['oneDnnLinkage']}`, OpenMP `{runtime['openMpRuntime']}`
- Loaded relevant modules: {module_text}
- Available ISA: `{json.dumps(runtime['availableIsa'], sort_keys=True, separators=(',', ':'))}`

Bounded oneDNN attestation:

{info_text}

## Excluded Warmups

| Cell | Warmup wall ms | Warmup inference ms | Warmup generate ms | Windows | Excluded from comparisons |
|---|---:|---:|---:|---:|---|
{warmup_rows}

## Four-Cell Measured Matrix

| Cell | Seek | History | Beam | Inference RTF | Generate ms | Windows | Generated tokens | Prefix-forward tokens | Overlap ms |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
{rows}

A/B/C first-window inputs, prompt/history counts, generated token count, and generated trace are equal; shared trace SHA-256: `{comparable_trace}`.

## Causal Comparison

{chr(10).join(f'- {fact}' for fact in facts)}

**Decision:** {decision}

D is not a product or qualification candidate merely because its RTF is below `1.0`: it generated {d_totals['generatedTokenCount']} tokens versus C's {c_totals['generatedTokenCount']} and reprocessed {d_totals['sourceOverlapMs']} ms versus C's {c_totals['sourceOverlapMs']} ms. Its changed output/seek behavior requires authoritative quality reruns before selection.

## Controls And Limitations

- The fixed execution order was A→B→C→D. Each cell had its own excluded warmup, and warmup/measured generated-token totals matched, but there is only one measured pass per cell. Thermal/order variance is therefore a residual diagnostic limitation, not qualification evidence.
- oneDNN `3.1.1` is a build-time pinned static library, so no oneDNN DLL can appear in the loaded-module inventory. No bounded oneDNN verbose info line was captured; CPUID records machine capability, not the ISA or primitive implementation actually dispatched by oneDNN.
- The causal result is still accepted for this checkpoint because all cells ran in one process with one executable and the same required DLL/model/slice identities. It does not establish a portable CPU ceiling or a product-quality result.
- This diagnostic executable is a separate post-Candidate-A identity. It does not rewrite `algorithm-lock.md`, re-identify the historical Candidate A short/medium evidence, or merge the earlier long timeout. Any selected candidate requires a new lock and fresh authoritative runs.

## Next Decision

- Do not run long-v1 or the seven-model matrix from this diagnostic identity.
- If A/B pass and history/beam is confirmed, select the smallest authoritative CPU candidate, create a new lock, and rerun the minimum authoritative short/medium cases before any long run.
- Only if the no-history controls remain above RTF `1.0` after required one-variable follow-ups may T06 publish a reviewed CPU ceiling and `gpu-required-pending` handoff to T07/T14/T15.
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--onednn-log", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if sha256_file(args.raw) != EXPECTED_RAW_SHA256:
        raise ValueError("diagnostic raw evidence identity mismatch")
    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    cells = validate(raw)
    report = render(
        raw,
        cells,
        read_onednn_info(args.onednn_log),
        sha256_file(Path(__file__)),
    )
    args.output.write_bytes(report.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
