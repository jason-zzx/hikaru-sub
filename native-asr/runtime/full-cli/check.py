"""Small exact-source output/VAD regressions plus boundary mutation checks."""
import argparse
import copy
import json
from pathlib import Path
import subprocess

from validate import validate
from vad_failure_check import check_vad_failure
from audio_failure_check import check_audio_failure


def rejected(raw, stderr):
    try:
        validate(raw, 2000, stderr, 'cpu')
    except (ValueError, KeyError, TypeError):
        return
    raise AssertionError('invalid output accepted')


def check_consumed_fields(parsed, stderr, device, backend):
    def accepted(value):
        validate(json.dumps(value).encode(), 2000, stderr, device, backend=backend)
    def invalid(value):
        try:
            accepted(value)
        except (ValueError, KeyError, TypeError):
            return
        raise AssertionError('invalid consumed text/timestamp accepted')
    for code in list(range(32)) + [127]:
        bad = copy.deepcopy(parsed)
        bad['displaySegments'][0]['text'] += chr(code)
        bad['transcription'][0]['text'] += chr(code)  # conservation still holds
        invalid(bad)
        bad = copy.deepcopy(parsed)
        bad['transcription'][0]['words'][0]['text'] += chr(code)
        invalid(bad)
    for start, end in [(-9999, 99999999), (0, 2001), (100, 99), (False, 2000), (0, 2.5)]:
        bad = copy.deepcopy(parsed)
        bad['transcription'][0]['offsets'] = {'from': start, 'to': end}
        invalid(bad)
    for start, end in [(-50, -100), (-1, 10), (50, 49), (0, 201), (True, 100), (0, 2.5)]:
        bad = copy.deepcopy(parsed)
        word = bad['transcription'][0]['words'][0]
        word.update(t0=start, t1=end, offsets={'from': start * 10, 'to': end * 10})
        invalid(bad)
    for value in [False, 0.0, 1]:  # bool/float compare equal to int in Python
        bad = copy.deepcopy(parsed)
        bad['transcription'][0]['words'][0]['offsets']['from'] = value
        invalid(bad)
    legal = copy.deepcopy(parsed)
    legal['unusedMetadata'] = '\0'
    legal['transcription'][0]['words'][0].update(t0=100, t1=100, offsets={'from': 1000, 'to': 1000})
    accepted(legal)  # escaped metadata NUL and legal zero-duration raw anchor
    legal['displaySegments'][0]['text'] += '\x85'
    legal['transcription'][0]['text'] += '\x85'
    accepted(legal)  # Native policy is C0/DEL, not a blanket Unicode control ban


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).resolve().parent
    # Developer-prompt cl + real upstream output translation unit, no fake writer.
    command = ['cl', '/nologo', '/std:c++17', '/EHsc', '/utf-8', '/O2', '/Gy',
               '/I' + str(source / 'examples/cli'), '/I' + str(source / 'examples'),
               '/I' + str(source / 'src'), '/I' + str(source / 'include'),
               '/I' + str(source / 'ggml/include'), str(here / 'output_test.cpp'),
               str(source / 'examples/cli/crispasr_output.cpp'), '/Fe:' + str(out / 'output_test.exe'),
               '/link', '/OPT:REF']
    subprocess.run(command, cwd=out, check=True)
    subprocess.run([str(out / 'output_test.exe'), str(out)], check=True)
    stderr = (b'hikaru_vad: device=cpu chunks=1 completed=1\n' + b''.join(
        b'hikaru_graph: role=' + role + b' device=cpu nodes=1 other=0\n'
        for role in [b'asr', b'aligner', b'lazy-audio']))
    raw = (out / 'good.json').read_bytes()
    parsed = json.loads(raw)
    assert parsed['transcription'][0]['text'] == '日本語。次。'
    assert all('tokens' not in row for row in parsed['transcription'])
    validate(raw, 2000, stderr, 'cpu')
    check_consumed_fields(parsed, stderr, 'cpu', 'qwen3')
    for name in ['diagnostic.json', 'invalid-text.json', 'fallback.json']:
        rejected((out / name).read_bytes(), stderr)
    rejected(raw[:-2], stderr)
    for field, value in [('startMs', -1), ('endMs', 0), ('endMs', 2001),
                         ('endMs', 1.5), ('startMs', True), ('text', 'changed')]:
        bad = copy.deepcopy(parsed)
        bad['displaySegments'][0][field] = value
        rejected(json.dumps(bad).encode(), stderr)
    bad = copy.deepcopy(parsed)
    bad['transcription'][0]['words'][0]['text'] = chr(0xD800)
    rejected(json.dumps(bad).encode(), stderr)
    rejected(raw, stderr.replace(b'role=aligner', b'role=unknown'))
    rejected(raw, stderr.replace(b'device=cpu nodes=', b'device=cuda nodes='))
    from parakeet_smoke import Progress, verify_loaded_runtime
    fixture_identity = {'sizeBytes': 1, 'sha256': 'fixture'}
    verify_loaded_runtime({str(out / 'VCOMP140.DLL'): fixture_identity}, out,
                          {'vcomp140.dll': fixture_identity})
    for modules in [{str(out / 'VCOMP140.DLL'): {}},
                    {str(out / 'foreign' / 'VCOMP140.DLL'): fixture_identity}]:
        try:
            verify_loaded_runtime(modules, out, {'vcomp140.dll': fixture_identity})
        except ValueError:
            pass
        else:
            raise AssertionError('foreign/drifted module accepted')
    progress = Progress()
    assert progress.advance(b'hikaru_stage: parakeet_model_loaded\r\n')
    assert not progress.advance(b'hikaru_stage: parakeet_model_loaded\n')
    assert progress.advance(b'hikaru_vad: device=cpu chunks=3 completed=1\n')
    assert progress.advance(b'hikaru_graph: role=parakeet-encoder device=cpu nodes=2 other=0\n')
    assert not progress.advance(b'hikaru_graph: role=parakeet-joint device=cpu nodes=3 other=0\n')
    assert progress.advance(b'hikaru_slice: completed=1 total=2\n')
    assert not progress.advance(b'busy stderr\n')
    assert not progress.advance(b'hikaru_slice: completed=1 total=2\n')
    assert progress.advance(b'hikaru_slice: completed=2 total=2\n')
    para = copy.deepcopy(parsed)
    para['crispasr']['backend'] = 'parakeet'
    para_raw = json.dumps(para).encode()
    for device in ['cpu', 'cuda']:
        roles = ['parakeet-encoder'] + (['parakeet-predictor', 'parakeet-joint'] if device == 'cuda' else [])
        proof = b'hikaru_vad: device=cpu chunks=1 completed=1\n' + ''.join(
            f'hikaru_graph: role={role} device={device} nodes=1 other=0\n' for role in roles).encode()
        proof += f'hikaru_tdt: decoder={device} host_projection=cpu frames=10 steps=3 completed=1\n'.encode()
        validate(para_raw, 2000, proof, device, backend='parakeet')
        check_consumed_fields(para, proof, device, 'parakeet')
        for bad_raw, bad_proof in [(raw, proof), (para_raw, stderr), (para_raw + b'\0junk', proof),
                                   (para_raw, proof.replace(b'completed=1', b'completed=0')),
                                   (para_raw, proof.replace(b'other=0', b'other=1')),
                                   (para_raw, proof + b'parakeet: failed to alloc encoder graph\n'),
                                   (para_raw, proof + b'crispasr[parakeet]: single-pass encode failed') ]:
            try:
                validate(bad_raw, 2000, bad_proof, device, backend='parakeet')
            except (ValueError, KeyError, TypeError):
                pass
            else:
                raise AssertionError('invalid Parakeet evidence accepted')
    print('PASS: actual writer, Qwen/Parakeet device/output mutations, monotonic watchdog progress')
    check_vad_failure(source, out)
    check_audio_failure(source, out / 'audio-reader')
    from encoder_failure_check import check_encoder_failure
    check_encoder_failure(source, out / 'encoder-fault')


if __name__ == '__main__':
    main()
