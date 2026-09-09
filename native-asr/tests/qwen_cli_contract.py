"""Deterministic application worker boundary. No model inference or references."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import wave

worker = Path(sys.argv[1]).resolve()
limits = json.loads((Path(__file__).resolve().parents[1] / 'protocol-v1-limits.json').read_text())
# Exact bytes (including ASCII/ideographic whitespace), order and member envelopes.
merged = {
    'zero-middle': [(0, 800, ' A  日本　'), (1000, 1500, ' B ')],
    'zero-trailing': [(0, 800, ' A  日本　')],
    'zero-leading': [(100, 800, ' A  日本　')],
    'zero-leading-consecutive': [(100, 800, ' A  日本　 B ')],
    'zero-consecutive': [(0, 900, ' A  日本　 B ')],
    'backward-cascade': [(100, 2600, ' A  日本　 B 終 ')],
    'zero-cascade': [(100, 1500, ' A  日本　 B ')],
    'ordinary-overlap': [(0, 1500, ' A '), (500, 1000, ' 日本　')],
    'equal-starts': [(100, 1500, ' A '), (100, 500, ' 日本　')],
    'merged-text-limit': [(0, 2000, 'x' * (limits['maxTextBytes'] // 2) + 'y' * (limits['maxTextBytes'] // 2))],
}
invalid_members = [
    'all-zero-same', 'all-zero-distinct', 'member-negative-duration', 'member-negative-start',
    'member-negative-end', 'member-out-of-audio', 'member-zero-out-of-audio', 'member-float',
    'member-bool', 'member-unsigned-overflow', 'member-missing', 'member-text-type',
    'member-text-empty', 'member-text-whitespace', 'member-text-control', 'member-text-nul',
    'member-text-oversize', 'merged-text-overflow', 'count-overflow', 'unhelpful-words',
    'word-negative', 'word-type', 'word-text-empty', 'fallback-type',
]
cases_run = 0
with tempfile.TemporaryDirectory(prefix='hikaru-qwen-') as temp:
    root = Path(temp) / '中文 路径'
    root.mkdir()
    audio = root / 'audio.wav'
    with wave.open(str(audio), 'wb') as out:
        out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        out.writeframes(b'\0' * 96000)
    for name in ['success', 'silence', 'bad-json', 'half-file', 'nonzero', 'after-output-nonzero',
                 'no-words', 'fallback', 'empty', 'duplicate', 'unicode-invalid', 'utf8-invalid',
                 'nul-suffix', 'nul-garbage', 'nul-invalid-utf8', 'nul-nested-value',
                 'nul-nested-key', 'nul-nested-token', 'trailing-whitespace', 'oversize', 'text-loss', 'zero-duration', 'out-of-audio', 'wrong-type',
                 'wrong-units', 'unordered', 'no-graph', 'wrong-device', 'missing-vad', 'alternate-audio',
                 'escaped-nul-unused', *merged, *invalid_members]:
        work = root / 'asr-jobs' / (name + '-cli')
        work.mkdir(parents=True)
        models = []
        for role in ['model', 'aligner', 'vad']:
            path = root / (role + '.bin')
            path.write_text(name, encoding='utf8')
            if name != 'missing-vad' or role != 'vad':
                models.append({'role': role, 'path': str(path)})
        if name == 'alternate-audio':
            alternate = root / '別の 音声.wav'
            audio.rename(alternate)
            audio = alternate
            for row in models:
                row['path'] = chr(92) * 2 + '?' + chr(92) + row['path']
        audio_arg = (chr(92) * 2 + '?' + chr(92) + str(audio)) if name == 'alternate-audio' else str(audio)
        request = {'protocolVersion': 1, 'jobId': name, 'engine': 'qwen3-asr', 'backend': 'crispasr',
                   'modelPaths': models, 'audioPath': audio_arg, 'device': 'cpu', 'language': 'ja', 'useVad': True}
        run = subprocess.run([str(worker)], input=(json.dumps(request) + '\n').encode(),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        events = [json.loads(line) for line in run.stdout.splitlines()]
        assert not run.stderr, (name, 'worker diagnostics leaked')
        good = name in ('success', 'silence', 'alternate-audio', 'trailing-whitespace', 'escaped-nul-unused') or name in merged
        assert run.returncode == (0 if good else 20), (name, run.returncode, events)
        assert [e['event'] for e in events] == (['ready', 'segmentsReplace', 'completed'] if good
               else ['error'] if name == 'missing-vad' else ['ready', 'error']), (name, events)
        if good:
            expected = merged.get(name, [] if name == 'silence' else [(0, 1000, '合成テスト。')])
            assert events[1]['segments'] == [dict(startMs=a, endMs=b, text=s) for a, b, s in expected], name
        else:
            assert not any(e['event'] in ('segmentsReplace', 'completed') for e in events)
        assert b'private' not in run.stdout and b'sensitive' not in run.stdout
        cases_run += 1
        print(name + ': passed')
print(f'{cases_run} application worker cases passed')
