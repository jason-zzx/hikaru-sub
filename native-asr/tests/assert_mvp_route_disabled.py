import json
import subprocess
import sys


def run(request: dict) -> tuple[int, dict]:
    process = subprocess.run(
        [sys.argv[1]],
        input=json.dumps(request, ensure_ascii=True) + "\n",
        text=True,
        capture_output=True,
        timeout=20,
    )
    try:
        event = json.loads(process.stdout.strip())
    except json.JSONDecodeError as error:
        raise SystemExit(f"invalid worker output: {error}") from error
    return process.returncode, event


base = {
    "protocolVersion": 1,
    "jobId": "release-route-contract",
    "modelPaths": [{"role": "model", "path": r"C:\missing-model"}],
    "device": "cpu",
    "language": "ja",
    "audioPath": r"C:\missing.wav",
    "outputAssPath": r"C:\output.ass",
    "useVad": False,
}

kotoba = {
    **base,
    "engine": "kotoba-faster-whisper",
    "backend": "ctranslate2",
}
exit_code, event = run(kotoba)
if exit_code != 20 or event.get("code") != "model_not_ready":
    raise SystemExit(f"Kotoba release route is unavailable: exit={exit_code} event={event}")

kotoba_vad = {**kotoba, "jobId": "release-route-kotoba-vad", "useVad": True}
exit_code, event = run(kotoba_vad)
if exit_code != 20 or event.get("code") != "kotoba_vad_not_qualified":
    raise SystemExit(f"unexpected Kotoba VAD result: exit={exit_code} event={event}")

unsupported = {
    **base,
    "jobId": "release-route-unsupported",
    "engine": "parakeet",
    "backend": "crispasr",
}
exit_code, event = run(unsupported)
if exit_code != 2 or event.get("code") != "route_not_implemented":
    raise SystemExit(f"unexpected unsupported-route result: exit={exit_code} event={event}")
