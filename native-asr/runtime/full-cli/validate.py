"""Validate same-run display output only. No reference subtitles or quality scores."""
import json
from pathlib import Path
import re

LIMITS = json.loads((Path(__file__).resolve().parents[2] / 'protocol-v1-limits.json').read_text())


def require(condition, code):
    if not condition:
        raise ValueError(code)


def validate(raw, duration_ms, stderr, device, silence=False, backend='qwen3'):
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
    require(backend in ('qwen3', 'parakeet', 'reazonspeech'), 'backend')
    expected_backend = 'parakeet' if backend == 'reazonspeech' else backend
    require(result['crispasr']['backend'] == expected_backend, 'backend')
    require(result['displayFallback'] is False, 'display_fallback')
    require(result['vadSilence'] is silence, 'silence_state')
    display = result['displaySegments']
    source = result['transcription']
    require(type(display) is list and type(source) is list, 'segments_type')
    require(len(display) <= LIMITS['maxReplacementSegments'], 'segments_limit')
    compact = lambda text: ''.join(text.split())  # whitespace formatting only; no normalization/punctuation removal
    def subtitle_text(text):
        require(type(text) is str, 'text_type')
        # Same C0/DEL policy as Native protocol.cpp; unused JSON metadata is not
        # subtitle text and may legally contain an escaped NUL.
        require(not any(ord(c) < 0x20 or ord(c) == 0x7f for c in text), 'text_control')
        return text
    def source_interval(offsets):
        start, end = offsets['from'], offsets['to']
        require(type(start) is int and type(end) is int, 'source_integer_ms')
        # Raw anchors may have zero duration/overlap; positive ordered DISPLAY
        # rows remain mandatory. Do not repair or impose word non-overlap.
        require(0 <= start <= end <= duration_ms, 'source_interval')
    all_text = []
    previous = -1
    for seg in display:
        require(type(seg['startMs']) is int and type(seg['endMs']) is int, 'integer_ms')
        require(0 <= seg['startMs'] < seg['endMs'] <= duration_ms, 'interval')
        require(seg['startMs'] >= previous, 'ordering')
        previous = seg['startMs']
        require(bool(compact(subtitle_text(seg['text']))), 'text')
        require(len(seg['text'].encode('utf-8')) <= LIMITS['maxTextBytes'], 'text_limit')
        all_text.append(seg['text'])
    source_text = []
    for seg in source:
        source_text.append(subtitle_text(seg['text']))
        source_interval(seg['offsets'])
        words = seg.get('words', [])
        require(type(words) is list and (not compact(seg['text']) or bool(words)), 'missing_words')
        for word in words:
            subtitle_text(word['text'])
            require(type(word['t0']) is int and type(word['t1']) is int, 'word_type')
            source_interval(word['offsets'])
            require(word['offsets']['from'] == word['t0'] * 10 and word['offsets']['to'] == word['t1'] * 10,
                    'word_units')
    require(compact(''.join(all_text)) == compact(''.join(source_text)), 'text_conservation')
    require(not source and not display if silence else bool(source) and bool(display), 'empty_state')
    require(b'hikaru_error:' not in stderr, 'device_error')
    if backend in ('parakeet', 'reazonspeech'):
        require(not any(message in stderr for message in [b'parakeet: failed to alloc encoder graph',
                    b'crispasr[parakeet]: single-pass encode failed', b'parakeet: encoder graph compute failed']),
                'encoder_failure')
    require(re.search(rb'hikaru_vad: device=cpu chunks=[1-9][0-9]* completed=1', stderr), 'vad_execution')
    roles = set()
    for role, selected, nodes, other in re.findall(rb'hikaru_graph: role=(\S+) device=(\S+) nodes=(\d+) other=(\d+)', stderr):
        require(selected.decode() == device and int(nodes) > 0 and int(other) == 0, 'execution_device')
        roles.add(role.decode())
    if not silence:
        expected = ({'asr', 'aligner', 'lazy-audio'} if backend == 'qwen3' else
                    {'parakeet-encoder', 'parakeet-predictor', 'parakeet-joint'} if device == 'cuda' else
                    {'parakeet-encoder'})
        require(roles == expected, 'missing_graph_roles')
        if backend in ('parakeet', 'reazonspeech'):
            marker = b'hikaru_tdt' if backend == 'parakeet' else b'hikaru_rnnt'
            decodes = re.findall(marker + rb': decoder=(cpu|cuda) host_projection=cpu frames=([1-9][0-9]*) steps=([1-9][0-9]*) completed=1', stderr)
            require(decodes and all(row[0].decode() == device for row in decodes),
                    'tdt_execution' if backend == 'parakeet' else 'rnnt_execution')
    if device == 'cpu':
        require(b'ggml_cuda_init:' not in stderr, 'cpu_initialized_cuda')
    return {'displayCount': len(display), 'sourceCount': len(source), 'graphRoles': sorted(roles),
            'vadCpu': True, 'utf8': True, 'integerMs': True, 'positiveBoundedIntervals': True,
            'textConserved': True, 'silence': silence}
