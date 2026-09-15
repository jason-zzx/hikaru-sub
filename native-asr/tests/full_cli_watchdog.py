"""Actual worker clock/policy regression; synthetic CLI only, never model calls."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import wave


def check(case):
    engine, scenario = case
    with tempfile.TemporaryDirectory(prefix='hikaru-cli-watchdog-') as temp:
        root = Path(temp)
        audio = root / 'audio.wav'
        with wave.open(str(audio), 'wb') as out:
            out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            out.writeframes(b'\0' * 96000)
        (root / 'asr-jobs/watchdog-cli').mkdir(parents=True)
        models = []
        for role in (['model', 'vad'] if engine == 'parakeet' else ['model', 'aligner', 'vad']):
            path = root / (role + '.bin'); path.write_text(scenario)
            models.append(dict(role=role, path=str(path)))
        request = dict(protocolVersion=1, jobId='watchdog', engine=engine, backend='crispasr',
                       modelPaths=models, audioPath=str(audio), device='cpu', language='ja', useVad=True)
        start = time.monotonic()
        run = subprocess.run([sys.argv[1]], input=(json.dumps(request) + '\n').encode(),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=140)
        elapsed = time.monotonic() - start
        events = [json.loads(row) for row in run.stdout.splitlines()]
        assert not run.stderr
        if scenario == 'stall-progress':
            assert 120 <= elapsed < 135, elapsed
            assert run.returncode == 20
            assert [e['event'] for e in events] == ['ready', 'progress', 'error'], events
            assert events[1]['processedMs'] == 1500
            assert events[-1]['code'] == 'parakeet_cli_no_progress_timeout', events[-1]
        else:
            assert 125 <= elapsed < 140, elapsed
            assert run.returncode == 0 and events[-1]['event'] == 'completed', events
            progress = [e['processedMs'] for e in events if e['event'] == 'progress']
            # Qwen has no slice progress source; it must not acquire a false
            # 120s total-runtime limit. Parakeet advances real fixture slices.
            assert progress == ([1500, 3000] if engine == 'parakeet' else []), events
        return f'{engine}/{scenario}: {elapsed:.3f}s, expected terminal and progress'


# Only independent, model-free fixture processes overlap (not ASR inference).
with ThreadPoolExecutor(max_workers=3) as pool:
    for result in pool.map(check, [('parakeet', 'stall-progress'),
                                    ('parakeet', 'slow-success'), ('qwen3-asr', 'slow-success')]):
        print(result)
