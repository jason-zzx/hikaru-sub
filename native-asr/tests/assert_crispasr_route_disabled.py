import json
import subprocess
import sys

request = {
    "protocolVersion": 1,
    "jobId": "crispasr-disabled",
    "engine": "reazonspeech-nemo",
    "backend": "crispasr",
    "modelPaths": [{"role": "model", "path": r"C:\model.gguf"}],
    "device": "cpu",
    "language": "ja",
    "audioPath": r"C:\audio.wav",
    "outputAssPath": r"C:\output.ass",
    "useVad": False,
}
process = subprocess.run(
    [sys.argv[1]],
    input=json.dumps(request, ensure_ascii=True) + "\n",
    text=True,
    capture_output=True,
    timeout=20,
)
if process.returncode != 2:
    raise SystemExit(f"unexpected exit: {process.returncode}")
try:
    event = json.loads(process.stdout.strip())
except json.JSONDecodeError as error:
    raise SystemExit(f"invalid worker output: {error}") from error
if event.get("code") != "route_not_implemented":
    raise SystemExit(f"unexpected worker event: {event}")
