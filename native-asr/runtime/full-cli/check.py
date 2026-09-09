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
    print('PASS: real upstream writer multibyte/BPE isolation, invalid actual text, fallback, truncation, interval/type/text/device mutations')
    check_vad_failure(source, out)
    check_audio_failure(source, out / 'audio-reader')


if __name__ == '__main__':
    main()
