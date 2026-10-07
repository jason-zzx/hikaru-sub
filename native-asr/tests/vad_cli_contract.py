"""Model-free second-caller contract: real launcher, synthetic CLI export."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import wave

helper, cli = map(lambda p: Path(p).resolve(), sys.argv[1:])
with tempfile.TemporaryDirectory(prefix='hikaru-vad-中文-') as tmp:
    root = Path(tmp)
    audio = root / 'audio.wav'
    with wave.open(str(audio), 'wb') as out:
        out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        out.writeframes(bytes(48000 * 2))
    vad = root / 'vad.bin'
    for scenario in ['success', 'silence', 'parameters', 'compute-failure', 'half-file',
                     'no-progress', 'no-completion', 'cpu-cuda', 'stall-progress', 'slow-success']:
        vad.write_text(scenario)
        work = root / 'asr-jobs' / (scenario + '-cli')
        work.mkdir(parents=True)
        request = dict(protocolVersion=1, jobId=scenario, engine='faster-whisper', backend='ctranslate2',
                       modelPaths=[dict(role='model', path=str(root / 'no-asr-weights')),
                                   dict(role='vad', path=str(vad))],
                       audioPath=str(audio), device='cuda', language='ja', useVad=True, vadCliPath=str(cli))
        if scenario == 'parameters':
            request['vadConfig'] = dict(threshold=0.73, minSilenceDurationMs=321)
        started = time.monotonic()
        result = subprocess.run([str(helper), '--detect'], input=json.dumps(request), text=True,
                                capture_output=True, timeout=140 if scenario in ('stall-progress', 'slow-success') else 15)
        elapsed = time.monotonic() - started
        if scenario == 'stall-progress':
            assert 120 <= elapsed < 135 and result.stderr.count('1/2') == 1, (elapsed, result.stderr)
        if scenario == 'slow-success':
            assert 125 <= elapsed < 140, elapsed
            assert result.stderr.splitlines() == ['1/2', '2/2'], result.stderr
        if scenario in ('success', 'silence', 'parameters', 'slow-success'):
            assert result.returncode == 0, scenario
            assert json.loads(result.stdout) == ([] if scenario == 'silence' else [[7, 16007], [32007, 48000]])
        else:
            assert result.returncode != 0 and not result.stdout, scenario
print('10 standalone VAD launcher fixtures passed, including real-clock stall and advancing progress')
