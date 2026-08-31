import json
import subprocess
import sys


def run(args: list[str], request: dict | None = None) -> tuple[int, dict]:
    process = subprocess.run(
        [sys.argv[1], *args],
        input=None if request is None else json.dumps(request, ensure_ascii=True) + "\n",
        text=True,
        capture_output=True,
        timeout=20,
    )
    lines = process.stdout.splitlines()
    if len(lines) != 1:
        raise SystemExit(f"expected one bounded JSON object, got {len(lines)} lines")
    try:
        payload = json.loads(lines[0])
    except json.JSONDecodeError as error:
        raise SystemExit(f"invalid worker output: {error}") from error
    if not isinstance(payload, dict):
        raise SystemExit("worker output must be a JSON object")
    return process.returncode, payload


exit_code, probe = run(["--probe-cuda"])
if probe.get("available") is True:
    required = {
        "deviceIndex",
        "deviceName",
        "visibleDeviceCount",
        "computeCapability",
        "computeType",
        "driverVersion",
        "supportEvidence",
    }
    if exit_code != 0 or not required.issubset(probe):
        raise SystemExit(f"invalid successful CUDA probe: exit={exit_code} payload={probe}")
else:
    allowed_errors = {
        "cuda_runtime_failed",
        "cuda_device_unavailable",
        "cuda_compute_type_unsupported",
        "cuda_architecture_unsupported",
    }
    if exit_code != 20 or probe.get("code") not in allowed_errors:
        raise SystemExit(f"invalid unavailable CUDA probe: exit={exit_code} payload={probe}")

base = {
    "protocolVersion": 1,
    "jobId": "cuda-release-route-contract",
    "engine": "faster-whisper",
    "backend": "ctranslate2",
    "modelPaths": [{"role": "model", "path": r"C:\missing-model"}],
    "device": "cpu",
    "language": "ja",
    "audioPath": r"C:\missing.wav",
    "outputAssPath": r"C:\output.ass",
    "useVad": False,
}
exit_code, event = run([], base)
if exit_code != 2 or event.get("code") != "runtime_device_mismatch":
    raise SystemExit(f"CUDA release runtime accepted CPU: exit={exit_code} event={event}")

unsupported = {
    **base,
    "jobId": "cuda-release-unsupported",
    "engine": "parakeet",
    "backend": "crispasr",
    "device": "cuda",
}
exit_code, event = run([], unsupported)
if exit_code != 2 or event.get("code") != "route_not_implemented":
    raise SystemExit(f"unexpected unsupported route result: exit={exit_code} event={event}")
