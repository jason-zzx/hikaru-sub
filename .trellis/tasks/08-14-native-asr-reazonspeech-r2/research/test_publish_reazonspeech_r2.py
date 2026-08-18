#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import publish_reazonspeech_r2 as publisher
import run_reazonspeech_r2 as runner


class ReazonSpeechR2PublisherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        runner.prepare()

    def setUp(self) -> None:
        self.root = runner.LOCAL_ROOT / "publisher-tests" / next(tempfile._get_candidate_names())
        self.root.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def make_windows_junction(self, junction: Path, target: Path) -> None:
        created = subprocess.run(
            [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", "mklink", "/J", str(junction), str(target)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(created.returncode, 0, f"failed to create Windows junction: {created.stdout}{created.stderr}")

    def modules(self) -> list[dict[str, object]]:
        values = []
        for name, (size, digest) in runner.REQUIRED_LOADED_RUNTIME_IDENTITIES.items():
            values.append({"name": name, "rootRole": "runtime-bin", "relativePath": name, "identity": {"sizeBytes": size, "sha256": digest}})
        values.append({"name": "hikaru-asr-worker.exe", "rootRole": "runtime-bin", "relativePath": "hikaru-asr-worker.exe", "identity": {"sizeBytes": runner.STATIC_IDENTITIES["worker"][0], "sha256": runner.STATIC_IDENTITIES["worker"][1]}})
        for name, (size, digest) in runner.SYSTEM_MODULE_IDENTITIES.items():
            values.append({"name": name, "rootRole": "system32", "relativePath": name, "identity": {"sizeBytes": size, "sha256": digest}})
        return sorted(values, key=lambda item: str(item["name"]).lower())

    @staticmethod
    def event(value: dict[str, object], at_ms: float) -> dict[str, object]:
        wire = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        return {"atMs": at_ms, "lineSizeBytes": len(wire), "lineSha256": hashlib.sha256(wire).hexdigest(), "value": value}

    def refresh_protocol(self, row: dict[str, object]) -> None:
        events = row["protocolTrace"]["events"]
        refreshed = [self.event(item["value"], item["atMs"]) for item in events]
        stdout = b"".join(json.dumps(item["value"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode() + b"\n" for item in refreshed)
        row["protocolTrace"] = {"stdoutSizeBytes": len(stdout), "stdoutSha256": hashlib.sha256(stdout).hexdigest(), "events": refreshed}

    def refresh_stderr_trace(self, row: dict[str, object]) -> None:
        data = b"".join(runner.TRACE_PREFIX + json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode() + b"\n" for item in row["evidenceTrace"])
        path = self.root / row["stderr"]["relativePath"]
        path.write_bytes(data)
        row["stderr"].update(sizeBytes=len(data), sha256=hashlib.sha256(data).hexdigest())

    def raw(self, case_id: str, run_kind: str, repeat: int, *, failed: bool = False) -> dict[str, object]:
        name, audio_size, audio_hash, duration = runner.CASES[case_id]
        window_end = min(1000, duration)
        windows = [{"index": 0, "startSample": 0, "endSample": window_end * 16, "startMs": 0, "endMs": window_end, "durationMs": window_end, "overlapWithPreviousMs": 0}]
        request = {
            "protocolVersion": 1,
            "jobId": f"r2-{case_id}-{run_kind}-{repeat}",
            "engine": "reazonspeech-nemo",
            "backend": "crispasr",
            "audioPath": str((runner.AUDIO_ROOT / name).resolve()),
            "modelPaths": [{"role": "model", "path": str((runner.MODEL_ROOT / "reazonspeech-nemo-v2-q8_0.gguf").resolve())}],
            "device": "cuda",
            "language": "ja",
            "useVad": False,
        }
        events = [self.event({"event": "ready", "protocolVersion": 1, "backend": "crispasr", "device": "cuda", "durationMs": duration}, 10.0)]
        if failed:
            windows.append({"index": 1, "startSample": 2000 * 16, "endSample": 3000 * 16, "startMs": 2000, "endMs": 3000, "durationMs": 1000, "overlapWithPreviousMs": 0})
            events.append(self.event({"event": "error", "protocolVersion": 1, "code": "crispasr_result_invalid", "message": "failed"}, 20.0))
            final = []
            status = "validated-failed"
            return_code = 20
            progress = 0
            attempted = 1
            attempted_through = window_end
            scope = "partial-attempt" if window_end != duration else "full-case"
        else:
            events.append(self.event({"event": "progress", "protocolVersion": 1, "processedMs": window_end, "durationMs": duration}, 20.0))
            final = [{"startMs": 0, "endMs": min(500, window_end), "text": "x"}]
            events.append(self.event({"event": "segmentsReplace", "protocolVersion": 1, "segments": final}, 30.0))
            events.append(self.event({"event": "completed", "protocolVersion": 1, "durationMs": duration, "detectedLanguage": "ja"}, 31.0))
            status = "completed"
            return_code = 0
            progress = attempted = 1
            attempted_through = window_end
            scope = "full-case"
        stdout = b"".join(json.dumps(item["value"], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode() + b"\n" for item in events)
        text = b"".join(segment["text"].encode() for segment in final)
        source_hash = hashlib.sha256(text).hexdigest() if final else None
        trace = [
            {"schema": runner.TRACE_SCHEMA, "kind": "identity", "device": runner.EXPECTED_DEVICE, "deviceSelectionEnvironment": runner.DEVICE_SELECTION_ENVIRONMENT},
            {"schema": runner.TRACE_SCHEMA, "kind": "vad", "windows": [{"index": window["index"], "startMs": window["startMs"], "endMs": window["endMs"]} for window in windows]},
            {"schema": runner.TRACE_SCHEMA, "kind": "transcribeAttempt", "windowIndex": 0, "startMs": 0, "endMs": window_end},
        ]
        if failed:
            local_ms = min(100, window_end)
            trace.append({
                "schema": runner.TRACE_SCHEMA,
                "kind": "failure",
                "code": "crispasr_result_invalid",
                "stage": "transcribe",
                "attemptedTranscribeCalls": 1,
                "completedTranscribeCalls": 0,
                "attemptedThroughMs": window_end,
                "resultFailure": {
                    "subtype": "zero_duration_top_level_result",
                    "zeroBasedWindowIndex": 0,
                    "windowStartMs": 0,
                    "windowEndMs": window_end,
                    "localStartMs": local_ms,
                    "localEndMs": local_ms,
                    "segmentIndex": 0,
                    "resultTraceSha256": runner.result_trace_sha256(
                        0, local_ms, local_ms, window_end
                    ),
                },
            })
        else:
            segment_evidence = {"startMs": 0, "endMs": min(500, window_end), "textBytes": 1, "textSha256": source_hash}
            trace += [
                {"schema": runner.TRACE_SCHEMA, "kind": "sourceResult", "windowIndex": 0, "startMs": 0, "endMs": window_end, "sourceSegments": [segment_evidence]},
                {"schema": runner.TRACE_SCHEMA, "kind": "policy", "sourceTextBytes": 1, "sourceTextSha256": source_hash, "finalTextBytes": 1, "finalTextSha256": source_hash, "finalSegments": [segment_evidence]},
            ]
        stderr_bytes = b"".join(runner.TRACE_PREFIX + json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode() + b"\n" for item in trace)
        stderr = self.root / "formal" / "stderr" / case_id / f"{run_kind}-{repeat}.log"
        stderr.parent.mkdir(parents=True, exist_ok=True)
        stderr.write_bytes(stderr_bytes)
        return {
            "schema": runner.RAW_SCHEMA,
            "status": status,
            "candidateId": runner.CANDIDATE_ID,
            "caseId": case_id,
            "runKind": run_kind,
            "repeatIndex": repeat,
            "identity": {
                "inputLock": runner.identity(runner.INPUT_LOCK),
                "runner": runner.identity(Path(runner.__file__).resolve()),
                "worker": {"sizeBytes": runner.STATIC_IDENTITIES["worker"][0], "sha256": runner.STATIC_IDENTITIES["worker"][1]},
                "runtimeFiles": {key: {"sizeBytes": value[0], "sha256": value[1]} for key, value in sorted(runner.RUNTIME_IDENTITIES.items())},
                "model": {"sizeBytes": runner.STATIC_IDENTITIES["model"][0], "sha256": runner.STATIC_IDENTITIES["model"][1]},
                "vad": {"sizeBytes": runner.STATIC_IDENTITIES["vad"][0], "sha256": runner.STATIC_IDENTITIES["vad"][1]},
                "audio": {"sizeBytes": audio_size, "sha256": audio_hash},
                "manifest": {"sizeBytes": runner.STATIC_IDENTITIES["manifest"][0], "sha256": runner.STATIC_IDENTITIES["manifest"][1]},
                "comparator": {"sizeBytes": runner.STATIC_IDENTITIES["comparator"][0], "sha256": runner.STATIC_IDENTITIES["comparator"][1]},
                "protocolLimits": {"sizeBytes": runner.STATIC_IDENTITIES["protocolLimits"][0], "sha256": runner.STATIC_IDENTITIES["protocolLimits"][1]},
                "formalTools": runner.verify_tool_identities(),
                "sourceFiles": {key: {"sizeBytes": value[0], "sha256": value[1]} for key, value in sorted(runner.SOURCE_IDENTITIES.items())},
                "device": runner.EXPECTED_DEVICE,
                "deviceSelectionEnvironment": runner.DEVICE_SELECTION_ENVIRONMENT,
                "pathPolicy": {"policy": runner.PATH_POLICY, "orderedRootRoles": ["runtime-bin", "cuda-bin", "system32"], "orderedRoots": [str(root.resolve(strict=True)) for root in (runner.RUNTIME_ROOT, runner.CUDA_ROOT, runner.SYSTEM32)]},
                "loadedModules": self.modules(),
            },
            "algorithm": runner.ALGORITHM,
            "request": request,
            "requestSha256": hashlib.sha256(json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "durationMs": duration,
            "vadWindows": windows,
            "vadWindowsSha256": runner.canonical_hash(windows),
            "protocolTrace": {"stdoutSizeBytes": len(stdout), "stdoutSha256": hashlib.sha256(stdout).hexdigest(), "events": events},
            "evidenceTrace": trace,
            "shape": {"plannedVadWindows": len(windows), "completedTranscribeCalls": progress, "attemptedTranscribeCalls": attempted, "sourceSegmentsPerCompletedWindow": 1, "finalCueCount": len(final), "sourceShapeProvenance": "worker-backend-sanitized-source-result-trace-v1", "sourceTextSha256": source_hash, "finalTextSha256": source_hash},
            "finalSegments": final,
            "error": {"code": "crispasr_result_invalid", "message": "failed", "ready": True, "taxonomy": "candidate-caused-structured-failure", "stage": "transcribe"} if failed else None,
            "timings": {"processWallMs": 40.0, "readyAtMs": 10.0, "terminalAtMs": 31.0 if not failed else 20.0, "inferenceMs": 20.0 if not failed else 10.0, "rtfScope": scope, "attemptedThroughMs": attempted_through},
            "resources": {"method": "GetProcessMemoryInfo.PeakWorkingSetSize", "peakProcessRssBytes": 1_000_000, "moduleSampleCount": 2},
            "stderr": {"relativePath": stderr.relative_to(self.root).as_posix(), "sizeBytes": len(stderr_bytes), "sha256": hashlib.sha256(stderr_bytes).hexdigest(), "privacyPass": True},
            "returnCode": return_code,
        }

    def matrix(self) -> list[dict[str, object]]:
        return [self.raw(case_id, kind, repeat) for case_id, kind, repeat, _ in publisher.expected_paths()]

    def validate(self, row: dict[str, object]) -> dict[str, object]:
        with mock.patch.object(publisher, "LOCAL_ROOT", self.root), mock.patch.object(runner, "STDERR_ROOT", self.root / "formal" / "stderr"):
            return publisher.validate_attempt(row)

    def test_optional_provider_shared_is_staged_but_not_required_loaded(self) -> None:
        self.assertIn("onnxruntime_providers_shared.dll", runner.RUNTIME_IDENTITIES)
        self.assertNotIn("onnxruntime_providers_shared.dll", runner.REQUIRED_LOADED_RUNTIME_IDENTITIES)
        publisher.validate_modules(self.modules())

    def test_frozen_tool_identity_rejects_helper_drift(self) -> None:
        altered = self.root / "run_r2_oracle.py"
        altered.write_bytes(runner.ORACLE.read_bytes() + b"\n")
        paths = dict(runner.TOOL_PATHS)
        paths["research/run_r2_oracle.py"] = altered
        with mock.patch.object(runner, "TOOL_PATHS", paths), self.assertRaises(RuntimeError):
            runner.verify_tool_identities()

    def test_valid_attempt_and_mutations(self) -> None:
        base = self.raw("short-v1", "cold", 0)
        self.validate(base)
        mutations = {
            "worker": lambda value: value["identity"]["worker"].update(sha256="0" * 64),
            "algorithm": lambda value: value["algorithm"]["vad"].update(speechPadMs=0),
            "status": lambda value: value.update(status="validated-failed"),
            "progress": lambda value: value["protocolTrace"]["events"][1]["value"].update(processedMs=999),
            "event-order": lambda value: value["protocolTrace"]["events"].reverse(),
            "window-cap": lambda value: value["vadWindows"][0].update(endMs=12061, durationMs=12061, endSample=192976),
            "overlap": lambda value: value["vadWindows"].append({"index": 1, "startSample": 15000, "endSample": 31000, "startMs": 938, "endMs": 1938, "durationMs": 1000, "overlapWithPreviousMs": 63}),
            "partial-rtf": lambda value: value["timings"].update(rtfScope="partial-attempt"),
            "source-text": lambda value: value["shape"].update(sourceTextSha256="0" * 64),
            "promotion": lambda value: value.update(qualityDisposition="qualified"),
            "metrics": lambda value: value.update(metrics={"cer": 0}),
            "module": lambda value: value["identity"]["loadedModules"][0]["identity"].update(sha256="0" * 64),
            "module-duplicate-basename": lambda value: value["identity"]["loadedModules"].append(copy.deepcopy(value["identity"]["loadedModules"][0])),
            "path-root": lambda value: value["identity"]["pathPolicy"]["orderedRoots"].__setitem__(0, str(self.root)),
            "device-env": lambda value: value["identity"]["deviceSelectionEnvironment"].update(CUDA_VISIBLE_DEVICES="1"),
            "tool": lambda value: value["identity"]["formalTools"]["research/run_r2_oracle.py"].update(sha256="0" * 64),
            "stderr-traversal": lambda value: value["stderr"].update(relativePath="formal/stderr/../escape.log"),
            "request": lambda value: value["request"].update(useVad=True),
        }
        for name, mutate in mutations.items():
            value = copy.deepcopy(base)
            mutate(value)
            with self.subTest(name=name), self.assertRaises((publisher.EvidenceError, RuntimeError)):
                self.validate(value)

        coordinated = copy.deepcopy(base)
        final = coordinated["finalSegments"][0]
        final["text"] = "y"
        coordinated["protocolTrace"]["events"][2]["value"]["segments"][0]["text"] = "y"
        digest = hashlib.sha256(b"y").hexdigest()
        coordinated["evidenceTrace"][3]["sourceSegments"][0].update(textSha256=digest)
        coordinated["evidenceTrace"][4].update(sourceTextSha256=digest, finalTextSha256=digest)
        coordinated["evidenceTrace"][4]["finalSegments"][0].update(textSha256=digest)
        coordinated["shape"].update(sourceTextSha256=digest, finalTextSha256=digest)
        self.refresh_protocol(coordinated)
        with self.assertRaises(publisher.EvidenceError):
            self.validate(coordinated)

    def test_failed_attempt_and_partial_scope(self) -> None:
        row = self.raw("long-v2", "measured", 0, failed=True)
        self.validate(row)
        for name, mutate in (
            (
                "subtype",
                lambda detail: detail.update(subtype="different_result_invalid_subtype"),
            ),
            (
                "window-range",
                lambda detail: detail.update(windowStartMs=detail["windowStartMs"] + 1),
            ),
            (
                "local-timing",
                lambda detail: detail.update(localStartMs=detail["localStartMs"] - 1),
            ),
            (
                "trace-hash",
                lambda detail: detail.update(resultTraceSha256="0" * 64),
            ),
        ):
            mutated = copy.deepcopy(row)
            mutate(mutated["evidenceTrace"][-1]["resultFailure"])
            self.refresh_stderr_trace(mutated)
            with self.subTest(name=name), self.assertRaises(publisher.EvidenceError):
                self.validate(mutated)

        forged = copy.deepcopy(row)
        detail = forged["evidenceTrace"][-1]["resultFailure"]
        detail["localStartMs"] -= 1
        detail["resultTraceSha256"] = runner.result_trace_sha256(
            detail["segmentIndex"],
            detail["localStartMs"],
            detail["localEndMs"],
            detail["windowEndMs"] - detail["windowStartMs"],
        )
        self.refresh_stderr_trace(forged)
        with self.assertRaises(publisher.EvidenceError):
            self.validate(forged)

        row["timings"]["rtfScope"] = "full-case"
        with self.assertRaises(publisher.EvidenceError):
            self.validate(row)

    def test_real_long_v2_float_endpoints_use_one_canonical_ms_grid(self) -> None:
        windows = [
            {"index": 0, "startSample": 510_970 * 16, "endSample": 522_930 * 16, "startMs": 510_970, "endMs": 522_930, "durationMs": 11_960, "overlapWithPreviousMs": 0},
            {"index": 1, "startSample": 522_870 * 16, "endSample": 533_630 * 16, "startMs": 522_870, "endMs": 533_630, "durationMs": 10_760, "overlapWithPreviousMs": 60},
        ]
        row = {"caseId": "long-v2", "vadWindows": windows, "vadWindowsSha256": runner.canonical_hash(windows)}
        publisher.validate_windows(row)

        direct_float_samples = copy.deepcopy(row)
        direct_float_samples["vadWindows"][0]["endSample"] += 1
        direct_float_samples["vadWindowsSha256"] = runner.canonical_hash(direct_float_samples["vadWindows"])
        with self.assertRaises(publisher.EvidenceError):
            publisher.validate_windows(direct_float_samples)

        overlap_61 = copy.deepcopy(row)
        overlap_61["vadWindows"][0].update(endMs=522_931, endSample=522_931 * 16, durationMs=11_961)
        overlap_61["vadWindowsSha256"] = runner.canonical_hash(overlap_61["vadWindows"])
        with self.assertRaises(publisher.EvidenceError):
            publisher.validate_windows(overlap_61)

        duration_12_061 = copy.deepcopy(row)
        duration_12_061["vadWindows"][0].update(startMs=510_869, startSample=510_869 * 16, durationMs=12_061)
        duration_12_061["vadWindowsSha256"] = runner.canonical_hash(duration_12_061["vadWindows"])
        with self.assertRaises(publisher.EvidenceError):
            publisher.validate_windows(duration_12_061)

    def test_failure_taxonomy_and_vad_zero_call_scope(self) -> None:
        vad = self.raw("long-v2", "measured", 0, failed=True)
        vad["protocolTrace"]["events"][-1]["value"]["code"] = "crispasr_vad_no_result"
        vad["error"].update(code="crispasr_vad_no_result", stage="vad")
        vad["evidenceTrace"] = [
            vad["evidenceTrace"][0],
            {"schema": runner.TRACE_SCHEMA, "kind": "failure", "code": "crispasr_vad_no_result", "stage": "vad", "attemptedTranscribeCalls": 0, "completedTranscribeCalls": 0, "attemptedThroughMs": 0},
        ]
        vad["shape"].update(attemptedTranscribeCalls=0)
        vad["timings"].update(attemptedThroughMs=0)
        self.refresh_protocol(vad)
        self.refresh_stderr_trace(vad)
        self.validate(vad)

        for code in ("worker_abnormal_exit", "invalid_request"):
            invalid = copy.deepcopy(vad)
            invalid["protocolTrace"]["events"][-1]["value"]["code"] = code
            invalid["error"].update(code=code)
            invalid["evidenceTrace"][-1]["code"] = code
            self.refresh_protocol(invalid)
            self.refresh_stderr_trace(invalid)
            with self.subTest(code=code), self.assertRaises(publisher.EvidenceError):
                self.validate(invalid)

        nonzero = copy.deepcopy(vad)
        nonzero["evidenceTrace"].insert(1, {"schema": runner.TRACE_SCHEMA, "kind": "transcribeAttempt", "windowIndex": 0, "startMs": 0, "endMs": nonzero["vadWindows"][0]["endMs"]})
        nonzero["evidenceTrace"][-1].update(attemptedTranscribeCalls=1, attemptedThroughMs=nonzero["vadWindows"][0]["endMs"])
        nonzero["shape"].update(attemptedTranscribeCalls=1)
        nonzero["timings"].update(attemptedThroughMs=nonzero["vadWindows"][0]["endMs"])
        self.refresh_stderr_trace(nonzero)
        with self.assertRaises(publisher.EvidenceError):
            self.validate(nonzero)

    def test_mixed_short_roles_remain_valid_failed_evidence(self) -> None:
        rows = [self.raw("short-v1", "cold", 0, failed=True)] + [self.raw("short-v1", "warm", repeat) for repeat in (1, 2, 3)]
        with mock.patch.object(publisher, "LOCAL_ROOT", self.root), mock.patch.object(runner, "STDERR_ROOT", self.root / "formal" / "stderr"):
            validated = [publisher.validate_attempt(row) for row in rows]
            benchmark = publisher.load_benchmark()
            cases = {case["id"]: case for case in benchmark.validate_manifest(runner.MANIFEST, runner.REPO_ROOT / ".asr-benchmark")["cases"]}
            summary = publisher.case_summary(benchmark, cases["short-v1"], validated)
        self.assertEqual(summary["status"], "validated-failed")
        self.assertEqual(summary["sampleCounts"]["completed"], 3)
        self.assertEqual(summary["sampleCounts"]["failed"], 1)

    def test_relative_selection_and_anti_regression(self) -> None:
        safe_gates = {
            "timelineErrorsZero": True,
            "cueCodePointsAtMost96": True,
            "cueDurationAtMost15000Ms": True,
            "cueStartsOrderedAndAudioBounded": True,
            "cueAdjacentOverlapAtMost60Ms": True,
            "paddedWindowAtMost12060Ms": True,
            "adjacentNativePaddingOverlapAtMost60Ms": True,
            "oneCallAndCuePerVadWindow": True,
            "sourceResultsMatchFinalCues": True,
            "textConservation": True,
            "oneAtomicReplacement": True,
            "replacementWithinProtocol": True,
        }
        cases = [
            {"caseId": "short-v1", "status": "completed", "measurements": {"maximumSampleCer": 0.23, "maximumSemanticSpeechGapsAtLeast1500Ms": 1, "maximumTimelineErrors": 0}, "gates": copy.deepcopy(safe_gates)},
            {"caseId": "medium-v1", "status": "completed", "measurements": {"maximumSampleCer": 0.29, "maximumSemanticSpeechGapsAtLeast1500Ms": 19, "maximumTimelineErrors": 0}, "gates": copy.deepcopy(safe_gates)},
            {
                "caseId": "long-v2",
                "status": "validated-failed",
                "errorCode": "crispasr_result_invalid",
                "failures": [{
                    "errorCode": "crispasr_result_invalid",
                    "resultFailure": publisher.published_result_failure(
                        publisher.R2_REVIEWED_LONG_FAILURE
                    ),
                }],
            },
        ]
        selection, reasons, regressions = publisher.relative_decision(cases)
        self.assertEqual(selection, "better-than-r1")
        self.assertIn("medium-v1_cer_reduction", reasons)
        self.assertFalse(regressions)
        non_safety_failure = copy.deepcopy(cases)
        non_safety_failure[0] = {"caseId": "short-v1", "status": "validated-failed", "errorCode": "crispasr_transcribe_failed"}
        selection, reasons, regressions = publisher.relative_decision(non_safety_failure)
        self.assertEqual(selection, "better-than-r1")
        self.assertIn("medium-v1_cer_reduction", reasons)
        self.assertFalse(regressions)
        cases[0]["measurements"].update(maximumSampleCer=0.30, maximumSemanticSpeechGapsAtLeast1500Ms=2)
        selection, _, regressions = publisher.relative_decision(cases)
        self.assertEqual(selection, "no-material-improvement")
        self.assertIn("short-v1_cer_and_gap_regression", regressions)
        for gate in ("cueCodePointsAtMost96", "cueDurationAtMost15000Ms"):
            capped = copy.deepcopy(cases)
            capped[0]["measurements"].update(maximumSampleCer=0.10, maximumSemanticSpeechGapsAtLeast1500Ms=0)
            capped[2] = {"caseId": "long-v2", "status": "completed", "measurements": {}, "gates": copy.deepcopy(safe_gates)}
            capped[0]["gates"][gate] = False
            capped[0]["cues"] = {
                "maximumCodePoints": 97 if gate == "cueCodePointsAtMost96" else 96,
                "maximumDurationMs": 15_001 if gate == "cueDurationAtMost15000Ms" else 15_000,
            }
            selection, reasons, regressions = publisher.relative_decision(capped)
            self.assertEqual(selection, "no-material-improvement", gate)
            self.assertFalse(reasons, gate)
            self.assertIn("short-v1_new_evidence_timeline_protocol_text_or_cue_failure", regressions, gate)

    def test_only_new_relative_safety_failures_block_medium_improvement(self) -> None:
        expected_codes = frozenset({
            "crispasr_vad_result_invalid",
            "crispasr_result_invalid",
            "crispasr_window_invalid",
            "parakeet_family_invalid_input",
            "parakeet_family_empty_output",
            "parakeet_family_text_conservation",
            "parakeet_family_cue_limit",
            "invalid_segment",
            "invalid_segment_order",
            "replacement_too_large",
            "event_line_too_large",
        })
        self.assertEqual(publisher.RELATIVE_SAFETY_FAILURE_CODES, expected_codes)
        safe_gates = {
            "timelineErrorsZero": True,
            "cueCodePointsAtMost96": True,
            "cueDurationAtMost15000Ms": True,
            "cueStartsOrderedAndAudioBounded": True,
            "cueAdjacentOverlapAtMost60Ms": True,
            "paddedWindowAtMost12060Ms": True,
            "adjacentNativePaddingOverlapAtMost60Ms": True,
            "oneCallAndCuePerVadWindow": True,
            "sourceResultsMatchFinalCues": True,
            "textConservation": True,
            "oneAtomicReplacement": True,
            "replacementWithinProtocol": True,
        }
        for code in sorted(expected_codes):
            cases = [
                {"caseId": "short-v1", "status": "completed", "measurements": {"maximumSampleCer": 0.23, "maximumSemanticSpeechGapsAtLeast1500Ms": 1}, "gates": copy.deepcopy(safe_gates)},
                {"caseId": "medium-v1", "status": "completed", "measurements": {"maximumSampleCer": 0.29, "maximumSemanticSpeechGapsAtLeast1500Ms": 19}, "gates": copy.deepcopy(safe_gates)},
                {"caseId": "long-v2", "status": "validated-failed", "errorCode": code},
            ]
            selection, reasons, regressions = publisher.relative_decision(cases)
            with self.subTest(code=code):
                self.assertEqual(selection, "no-material-improvement")
                self.assertFalse(reasons)
                self.assertIn(
                    "long-v2_new_evidence_timeline_protocol_text_or_cue_failure",
                    regressions,
                )

        reviewed = [
            {"caseId": "short-v1", "status": "completed", "measurements": {"maximumSampleCer": 0.23, "maximumSemanticSpeechGapsAtLeast1500Ms": 1}, "gates": copy.deepcopy(safe_gates)},
            {"caseId": "medium-v1", "status": "completed", "measurements": {"maximumSampleCer": 0.29, "maximumSemanticSpeechGapsAtLeast1500Ms": 19}, "gates": copy.deepcopy(safe_gates)},
            {
                "caseId": "long-v2",
                "status": "validated-failed",
                "errorCode": "crispasr_result_invalid",
                "failures": [{
                    "errorCode": "crispasr_result_invalid",
                    "resultFailure": publisher.published_result_failure(
                        publisher.R2_REVIEWED_LONG_FAILURE
                    ),
                }],
            },
        ]
        selection, reasons, regressions = publisher.relative_decision(reviewed)
        self.assertEqual(selection, "better-than-r1")
        self.assertIn("medium-v1_cer_reduction", reasons)
        self.assertFalse(regressions)

        for field, value in (
            ("subtype", "different_result_invalid_subtype"),
            ("windowStartMs", 763_591),
            ("localStartMs", 2_159),
            ("resultTraceSha256", "0" * 64),
            ("fingerprintSha256", "0" * 64),
        ):
            mutated = copy.deepcopy(reviewed)
            mutated[2]["failures"][0]["resultFailure"][field] = value
            selection, reasons, regressions = publisher.relative_decision(mutated)
            with self.subTest(result_failure_field=field):
                self.assertEqual(selection, "no-material-improvement")
                self.assertFalse(reasons)
                self.assertIn(
                    "long-v2_new_evidence_timeline_protocol_text_or_cue_failure",
                    regressions,
                )

    def test_publication_is_deterministic_and_rejects_result_mutation(self) -> None:
        raw_root = self.root / "formal" / "raw"
        entries = []
        for row in self.matrix():
            path = raw_root / row["caseId"] / f"{row['runKind']}-{row['repeatIndex']}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(row, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
            entries.append({"caseId": row["caseId"], "runKind": row["runKind"], "repeatIndex": row["repeatIndex"], "relativeRawPath": path.relative_to(self.root).as_posix(), "sizeBytes": path.stat().st_size, "sha256": runner.sha256(path)})
        index = self.root / "r2-raw-index.json"
        index.write_text(json.dumps({"schema": runner.INDEX_SCHEMA, "frozen": True, "candidateId": runner.CANDIDATE_ID, "entries": entries}), encoding="utf-8")
        outputs = (self.root / "evidence" / "reazonspeech-r2.json", self.root / "reazonspeech-r2-report.md", self.root / "reazonspeech-r2-handoff.md")
        patches = (
            mock.patch.object(publisher, "LOCAL_ROOT", self.root),
            mock.patch.object(publisher, "RESEARCH_ROOT", self.root),
            mock.patch.object(publisher, "RAW_ROOT", raw_root),
            mock.patch.object(runner, "LOCAL_ROOT", self.root),
            mock.patch.object(runner, "RAW_ROOT", raw_root),
            mock.patch.object(runner, "STDERR_ROOT", self.root / "formal" / "stderr"),
        )
        for patch in patches:
            patch.start()
        try:
            first = publisher.publish(index, *outputs)
            first_bytes = tuple(path.read_bytes() for path in outputs)
            second = publisher.publish(index, *outputs)
            self.assertEqual(first_bytes, tuple(path.read_bytes() for path in outputs))
            self.assertEqual(first, second)
        finally:
            for patch in reversed(patches):
                patch.stop()
        for mutate in (
            lambda value: value.update(qualityDisposition="qualified"),
            lambda value: value.update(relativeSelection="better-than-r1"),
            lambda value: value["r1Authority"]["relativeThresholds"].update(cerAbsoluteReductionMin=0),
            lambda value: value["cases"][0]["measurements"].update(maximumSampleCer=0),
            lambda value: value.update(rawIndexSha256="0" * 64),
        ):
            changed = copy.deepcopy(first)
            mutate(changed)
            with self.assertRaises(publisher.EvidenceError):
                publisher.validate_generated(changed, first)

    def test_reparse_escape_is_rejected(self) -> None:
        row = self.raw("short-v1", "cold", 0)
        original = runner._is_reparse
        with mock.patch.object(runner, "_is_reparse", side_effect=lambda path: path.name.lower() == "stderr" or original(path)):
            with self.assertRaises(RuntimeError):
                self.validate(row)

    def test_nested_reparse_components_reject_raw_stderr_staging_and_index_paths(self) -> None:
        source = self.root / "source.bin"
        source.write_bytes(b"source")
        cases = (
            ("raw", lambda: runner.atomic_json(self.root / "formal" / "raw" / "nested" / "row.json", {})),
            ("stderr", lambda: runner.require_private_path(self.root / "formal" / "stderr" / "nested" / "row.log", self.root / "formal" / "stderr", "stderr")),
            ("staging", lambda: runner.hardlink_or_copy(source, self.root / "formal" / "models" / "nested" / "model.bin")),
            ("index", lambda: publisher.atomic_bytes(self.root / "nested" / "r2-raw-index.json", b"{}\n")),
        )
        patches = (
            mock.patch.object(runner, "RAW_ROOT", self.root / "formal" / "raw"),
            mock.patch.object(runner, "FORMAL_ROOT", self.root / "formal"),
            mock.patch.object(publisher, "RESEARCH_ROOT", self.root),
            mock.patch.object(runner, "_is_reparse", side_effect=lambda path: path.name.lower() == "nested"),
        )
        for patch in patches:
            patch.start()
        try:
            for role, action in cases:
                with self.subTest(role=role), self.assertRaisesRegex(RuntimeError, "reparse point"):
                    action()
        finally:
            for patch in reversed(patches):
                patch.stop()

    def test_containment_accepts_ordinary_anchor_and_nonexistent_targets(self) -> None:
        anchor = Path(self.root.anchor)
        runner.require_contained(anchor / f"hikaru-r2-missing-{next(tempfile._get_candidate_names())}", anchor, "anchor target")
        ordinary_root = self.root / "ordinary-root"
        ordinary_root.mkdir()
        runner.require_contained(ordinary_root / "missing" / "row.json", ordinary_root, "missing target")

    @unittest.skipUnless(os.name == "nt", "Windows directory junctions are unsupported on this platform")
    def test_windows_root_junction_cannot_redirect_ignored_raw_write(self) -> None:
        outside = Path(tempfile.mkdtemp(prefix="hikaru-r2-root-junction-outside-"))
        junction = self.root / "root-junction"
        target = junction / "escape.json"
        self.make_windows_junction(junction, outside)
        try:
            with mock.patch.object(runner, "RAW_ROOT", junction), self.assertRaisesRegex(RuntimeError, "reparse point"):
                runner.atomic_json(target, {"mustNotEscape": True})
            self.assertFalse((outside / "escape.json").exists())
        finally:
            if os.path.lexists(junction):
                os.rmdir(junction)
            shutil.rmtree(outside, ignore_errors=True)

    @unittest.skipUnless(os.name == "nt", "Windows directory junctions are unsupported on this platform")
    def test_windows_descendant_junction_cannot_redirect_ignored_raw_write(self) -> None:
        raw_root = self.root / "descendant-junction-test" / "raw"
        raw_root.mkdir(parents=True)
        outside = Path(tempfile.mkdtemp(prefix="hikaru-r2-descendant-junction-outside-"))
        junction = raw_root / "nested"
        target = junction / "escape.json"
        ignored = subprocess.run(["git", "check-ignore", "-q", str(target)], cwd=runner.REPO_ROOT, check=False)
        self.assertEqual(ignored.returncode, 0, "lexical raw path must be ignored before the junction exists")
        self.make_windows_junction(junction, outside)
        try:
            with mock.patch.object(runner, "RAW_ROOT", raw_root), self.assertRaisesRegex(RuntimeError, "reparse point"):
                runner.atomic_json(target, {"mustNotEscape": True})
            self.assertFalse((outside / "escape.json").exists())
        finally:
            if os.path.lexists(junction):
                os.rmdir(junction)
            shutil.rmtree(outside, ignore_errors=True)

    @unittest.skipUnless(os.name == "nt", "Windows directory junctions are unsupported on this platform")
    def test_windows_approved_root_below_junctioned_ancestor_is_rejected(self) -> None:
        junction_parent = self.root / "ancestor-junction-test"
        junction_parent.mkdir()
        outside = Path(tempfile.mkdtemp(prefix="hikaru-r2-ancestor-junction-outside-"))
        (outside / "approved").mkdir()
        junction = junction_parent / "linked"
        approved_root = junction / "approved"
        target = approved_root / "escape.json"
        self.make_windows_junction(junction, outside)
        try:
            self.assertFalse(runner._is_reparse(approved_root), "approved root must be an ordinary directory below the junction")
            with mock.patch.object(runner, "RAW_ROOT", approved_root), self.assertRaisesRegex(RuntimeError, "reparse point"):
                runner.atomic_json(target, {"mustNotEscape": True})
            self.assertFalse((outside / "approved" / "escape.json").exists())
        finally:
            if os.path.lexists(junction):
                os.rmdir(junction)
            shutil.rmtree(outside, ignore_errors=True)

    def test_index_rejects_raw_hash_path_and_role_mutations(self) -> None:
        raw_root = self.root / "formal" / "raw"
        entries = []
        rows = self.matrix()
        for row in rows:
            path = raw_root / row["caseId"] / f"{row['runKind']}-{row['repeatIndex']}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(row, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
            entries.append({"caseId": row["caseId"], "runKind": row["runKind"], "repeatIndex": row["repeatIndex"], "relativeRawPath": path.relative_to(self.root).as_posix(), "sizeBytes": path.stat().st_size, "sha256": runner.sha256(path)})
        index = self.root / "r2-raw-index.json"
        base = {"schema": runner.INDEX_SCHEMA, "frozen": True, "candidateId": runner.CANDIDATE_ID, "entries": entries}
        patches = (
            mock.patch.object(publisher, "LOCAL_ROOT", self.root),
            mock.patch.object(publisher, "RESEARCH_ROOT", self.root),
            mock.patch.object(publisher, "RAW_ROOT", raw_root),
            mock.patch.object(runner, "LOCAL_ROOT", self.root),
            mock.patch.object(runner, "RAW_ROOT", raw_root),
            mock.patch.object(runner, "STDERR_ROOT", self.root / "formal" / "stderr"),
        )
        for patch in patches:
            patch.start()
        try:
            index.write_text(json.dumps(base), encoding="utf-8")
            publisher.load_index(index)
            mutations = (
                lambda value: value["entries"][0].update(sha256="0" * 64),
                lambda value: value["entries"][0].update(relativeRawPath="../escape.json"),
                lambda value: value["entries"].pop(),
                lambda value: value["entries"][0].update(repeatIndex=99),
                lambda value: value["entries"].reverse(),
            )
            for mutate in mutations:
                changed = copy.deepcopy(base)
                mutate(changed)
                index.write_text(json.dumps(changed), encoding="utf-8")
                with self.assertRaises((publisher.EvidenceError, RuntimeError)):
                    publisher.load_index(index)
        finally:
            for patch in reversed(patches):
                patch.stop()

    def test_active_and_archive_private_roots_are_ignored(self) -> None:
        for path in (
            ".trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/probe.json",
            ".trellis/tasks/archive/2099-01/08-14-native-asr-reazonspeech-r2/research/local/probe.json",
        ):
            result = __import__("subprocess").run(["git", "check-ignore", "-q", path], cwd=runner.REPO_ROOT)
            self.assertEqual(result.returncode, 0, path)


if __name__ == "__main__":
    unittest.main()
