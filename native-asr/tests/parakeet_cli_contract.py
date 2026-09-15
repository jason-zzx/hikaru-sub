"""Synthetic full CLI worker cases; no model execution or production switch."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

worker = Path(sys.argv[1]).resolve()
good = ['success', 'silence', 'escaped-nul-unused', 'trailing-whitespace', 'raw-zero-overlap',
        'ordinary-overlap', 'equal-starts', 'alternate-audio']
bad = ['bad-json', 'half-file', 'nonzero', 'after-output-nonzero', 'no-words', 'fallback',
       'empty', 'duplicate', 'unicode-invalid', 'utf8-invalid', 'nul-suffix', 'nul-garbage',
       'nul-invalid-utf8', 'nul-nested-value', 'nul-nested-key', 'nul-nested-token', 'oversize',
       'text-loss', 'zero-duration', 'out-of-audio', 'wrong-type', 'wrong-units', 'unordered',
       'no-graph', 'wrong-device', 'no-tdt', 'wrong-tdt', 'wrong-backend', 'cpu-cuda-init',
       'zero-leading', 'zero-middle', 'zero-trailing', 'zero-consecutive', 'backward-cascade',
       'all-zero-distinct', 'member-text-control', 'member-text-nul', 'member-text-oversize',
       'source-control', 'word-control', 'source-reversed', 'source-bool', 'source-outside',
       'word-outside', 'word-negative', 'word-type', 'fallback-type', 'count-overflow',
       'missing-vad', 'aligner-role', 'missing-model-file', 'missing-work', 'occupied-work',
       'vad-disabled', 'custom-vad', 'vulkan', 'invalid-audio', 'traversal-job']
cases = 0
with tempfile.TemporaryDirectory(prefix='hikaru-parakeet-') as temp:
    root = Path(temp) / '中文 路径'
    root.mkdir()
    for device in ['cpu', 'cuda']:
        for scenario in good + bad:
            if device == 'cuda' and scenario == 'cpu-cuda-init':
                continue
            job = f'{device}-{scenario}'
            audio = root / '音声.wav'
            with wave.open(str(audio), 'wb') as out:
                out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                out.writeframes(b'\0' * 96000)
            work = root / 'asr-jobs' / (job + '-cli')
            if scenario != 'missing-work':
                work.mkdir(parents=True)
            models = []
            for role in ['model', 'vad']:
                path = root / (role + '.bin')
                path.write_text(scenario, encoding='utf8')
                models.append({'role': role, 'path': str(path)})
            request = dict(protocolVersion=1, jobId=job, engine='parakeet', backend='crispasr',
                           modelPaths=models, audioPath=str(audio), device=device, language='ja', useVad=True)
            if scenario == 'missing-vad': models.pop()
            if scenario == 'aligner-role': models[1]['role'] = 'aligner'
            if scenario == 'missing-model-file': Path(models[0]['path']).unlink()
            if scenario == 'occupied-work': (work / 'untrusted').write_text('x')
            if scenario == 'vad-disabled': request['useVad'] = False
            if scenario == 'custom-vad': request['vadConfig'] = {'threshold': 0.5}
            if scenario == 'vulkan': request['device'] = 'vulkan'
            if scenario == 'invalid-audio': audio.write_bytes(b'invalid')
            if scenario == 'traversal-job': request['jobId'] = '../escape'
            if scenario == 'alternate-audio':
                request['audioPath'] = '\\\\?\\' + str(audio)
                for row in models: row['path'] = '\\\\?\\' + row['path']
            env = dict(os.environ, CRISPASR_PARAKEET_DECODER='ctc', HIKARU_QWEN_DEVICE='cuda')
            run = subprocess.run([str(worker)], input=(json.dumps(request) + '\n').encode(),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=10)
            events = [json.loads(line) for line in run.stdout.splitlines()]
            assert not run.stderr, (job, 'raw diagnostics leaked')
            success = scenario in good
            assert (run.returncode == 0) == success, (job, run.returncode, events)
            if success:
                assert [row['event'] for row in events] == ['ready', 'segmentsReplace', 'completed'], job
                rows = events[1]['segments']
                assert bool(rows) != (scenario == 'silence'), job
                if scenario in ['success', 'raw-zero-overlap', 'escaped-nul-unused', 'alternate-audio']:
                    assert rows == [dict(startMs=0, endMs=1000, text='合成テスト。')], job
            else:
                assert events[-1]['event'] == 'error', (job, events)
                assert not any(row['event'] in ['segmentsReplace', 'completed'] for row in events), job
            assert b'private' not in run.stdout and b'sensitive' not in run.stdout
            cases += 1
print(f'{cases} Parakeet worker cases passed (synthetic CPU/CUDA markers, not device proof)')
