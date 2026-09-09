"""Validate same-run display output only. No reference subtitles or quality scores."""
import json
from pathlib import Path
import re

LIMITS = json.loads((Path(__file__).resolve().parents[2] / 'protocol-v1-limits.json').read_text())


def require(condition, code):
    if not condition:
        raise ValueError(code)


def validate(raw, duration_ms, stderr, device, silence=False):
    require(len(raw) <= LIMITS['maxEventLineBytes'], 'json_size')
    def unique(pairs):
        obj = {}
        for k, v in pairs:
            require(k not in obj, 'duplicate_key')
            obj[k] = v
        return obj
    def invalid_constant(value):
        raise ValueError('nonfinite_json')
    result = json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=unique,
                        parse_constant=invalid_constant)
    # JSON escapes can hide unpaired surrogates even when the document bytes
    # themselves are UTF-8. Validate every string, including nested word text.
    json.dumps(result, ensure_ascii=False).encode('utf-8', errors='strict')
    require(result['crispasr']['backend'] == 'qwen3', 'backend')
    require(result['displayFallback'] is False, 'display_fallback')
    require(result['vadSilence'] is silence, 'silence_state')
    display = result['displaySegments']
    source = result['transcription']
    require(type(display) is list and type(source) is list, 'segments_type')
    require(len(display) <= LIMITS['maxReplacementSegments'], 'segments_limit')
    compact = lambda text: ''.join(text.split())  # whitespace formatting only; no normalization/punctuation removal
    all_text = []
    previous = -1
    for seg in display:
        require(type(seg['startMs']) is int and type(seg['endMs']) is int, 'integer_ms')
        require(0 <= seg['startMs'] < seg['endMs'] <= duration_ms, 'interval')
        require(seg['startMs'] >= previous, 'ordering')
        previous = seg['startMs']
        require(type(seg['text']) is str and bool(compact(seg['text'])), 'text')
        require(len(seg['text'].encode('utf-8')) <= LIMITS['maxTextBytes'], 'text_limit')
        all_text.append(seg['text'])
    require(compact(''.join(all_text)) == compact(''.join(s['text'] for s in source)), 'text_conservation')
    require(not source and not display if silence else bool(source) and bool(display), 'empty_state')
    if not silence:
        require(all(s.get('words') for s in source if compact(s['text'])), 'missing_words')
        for seg in source:
            for word in seg.get('words', []):
                require(type(word['t0']) is int and type(word['t1']) is int, 'word_type')
                require(word['offsets'] == {'from': word['t0'] * 10, 'to': word['t1'] * 10}, 'word_units')
    require(b'hikaru_error:' not in stderr, 'device_error')
    require(re.search(rb'hikaru_vad: device=cpu chunks=[1-9][0-9]* completed=1', stderr), 'vad_execution')
    roles = set()
    for role, selected, nodes, other in re.findall(rb'hikaru_graph: role=(\S+) device=(\S+) nodes=(\d+) other=(\d+)', stderr):
        require(selected.decode() == device and int(nodes) > 0 and int(other) == 0, 'execution_device')
        roles.add(role.decode())
    if not silence:
        require(roles == {'asr', 'aligner', 'lazy-audio'}, 'missing_graph_roles')
    if device == 'cpu':
        require(b'ggml_cuda_init:' not in stderr, 'cpu_initialized_cuda')
    return {'displayCount': len(display), 'sourceCount': len(source), 'graphRoles': sorted(roles),
            'vadCpu': True, 'utf8': True, 'integerMs': True, 'positiveBoundedIntervals': True,
            'textConserved': True, 'silence': silence}
