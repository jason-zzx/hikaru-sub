"""Reproduce P1 acquisition metadata from pinned publisher bytes (stdlib, build-only).

freeze writes a metadata lock BEFORE weights are acquired; verify never relabels it.
Private evidence/weights stay in the existing ignored full-CLI scratch root.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import struct
import sys
import urllib.request

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'native-asr/runtime/full-cli'))
from prepare import LOCAL, LOCK, verify

REVISION = 'd9e3ba65a6579796389ea89e5939509ed257f972'
REPOSITORY = 'cstr/parakeet-tdt-0.6b-ja-GGUF'
FILE = 'parakeet-tdt-0.6b-ja.gguf'
WEIGHT = {'sizeBytes': 1246932800, 'sha256': '374eb0132eebaec4df77a9631cbbeb03790be48a4a517f6cc8e8bdb38fe9a584'}
OUT = LOCAL / 'acquisition'
DEST = Path(__file__).with_name('p1-acquisition-lock.json')


def identity(path):
    with path.open('rb') as stream:
        return {'sizeBytes': path.stat().st_size, 'sha256': hashlib.file_digest(stream, 'sha256').hexdigest()}


def gguf_metadata(path):
    with path.open('rb') as stream:
        def unpack(fmt):
            return struct.unpack('<' + fmt, stream.read(struct.calcsize('<' + fmt)))[0]
        def string():
            length = unpack('Q')
            assert length <= 1024 * 1024
            return stream.read(length).decode('utf-8', errors='strict')
        def value(kind):
            if kind == 8:
                return string()
            if kind == 9:
                element, count = unpack('I'), unpack('Q')
                assert count <= 1000000
                for _ in range(count):
                    value(element)
                return None  # never publish vocabulary/token arrays
            return unpack({0: 'B', 1: 'b', 2: 'H', 3: 'h', 4: 'I', 5: 'i', 6: 'f', 7: '?', 10: 'Q', 11: 'q', 12: 'd'}[kind])
        assert stream.read(4) == b'GGUF'
        version, tensors, count = unpack('I'), unpack('Q'), unpack('Q')
        assert version == 3 and tensors > 0 and count < 10000
        metadata = {}
        for _ in range(count):
            key = string()
            item = value(unpack('I'))
            if key.startswith('parakeet.') or key in ['general.architecture', 'general.file_type']:
                metadata[key] = item
        assert metadata['general.architecture'] == 'parakeet'
        tensor_types = {}
        for _ in range(tensors):
            string()  # tensor name is not evidence output
            dimensions = unpack('I')
            assert 0 < dimensions <= 4
            for _ in range(dimensions):
                assert unpack('Q') > 0
            kind, offset = unpack('I'), unpack('Q')
            assert kind in (0, 1), 'card-selected F16 must contain only F32/F16 tensors'
            assert offset < path.stat().st_size
            name = 'F32' if kind == 0 else 'F16'
            tensor_types[name] = tensor_types.get(name, 0) + 1
        return {'version': version, 'tensorCount': tensors, 'tensorTypes': tensor_types, 'metadata': metadata}


def frozen_metadata():
    api = json.loads((OUT / 'parakeet-api.json').read_bytes())
    assert api['id'] == REPOSITORY and api['sha'] == REVISION
    file = next(x for x in api['siblings'] if x['rfilename'] == FILE)
    assert file['size'] == file['lfs']['size'] == WEIGHT['sizeBytes']
    assert file['lfs']['sha256'] == WEIGHT['sha256']
    card = (OUT / 'parakeet-card.md').read_bytes()
    card_row = next(x for x in api['siblings'] if x['rfilename'] == 'README.md')
    assert hashlib.sha1(b'blob ' + str(len(card)).encode() + b'\0' + card).hexdigest() == card_row['blobId']
    assert b'license: cc-by-4.0' in card and b'base_model: nvidia/parakeet-tdt_ctc-0.6b-ja' in card
    assert b'## Recommended: F16' in card
    nvidia = json.loads((OUT / 'nvidia-api.json').read_bytes())
    original = (OUT / 'nvidia-card.md').read_bytes()
    original_row = next(x for x in nvidia['siblings'] if x['rfilename'] == 'README.md')
    assert nvidia['id'] == 'nvidia/parakeet-tdt_ctc-0.6b-ja'
    assert hashlib.sha1(b'blob ' + str(len(original)).encode() + b'\0' + original).hexdigest() == original_row['blobId']
    assert b'license: cc-by-4.0' in original
    baseline = json.loads(LOCK.read_bytes())
    vad = next(x for x in baseline['models'] if x['role'] == 'vad')
    return {
        'schemaVersion': 1,
        'purpose': 'P1 metadata acquisition lock; not production readiness or model execution proof',
        'sourceLock': {'path': LOCK.relative_to(REPO).as_posix(), **identity(LOCK)},
        'sourceCommit': baseline['source']['commit'],
        'model': {'logicalModel': nvidia['id'], 'repository': REPOSITORY, 'revision': REVISION,
                  'file': FILE, **WEIGHT, 'format': 'GGUF', 'publisherRepresentation': 'F16 matmul; F32 norms/biases/filterbank',
                  'decoder': 'upstream default TDT (greedy)', 'license': 'CC-BY-4.0',
                  'url': f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{FILE}',
                  'cardUrl': f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/README.md',
                  'originalCardUrl': f"https://huggingface.co/{nvidia['id']}/resolve/{nvidia['sha']}/README.md",
                  'attribution': 'Original Japanese Parakeet model: NVIDIA NeMo team; GGUF conversion: CrispStrobe/CrispASR.',
                  'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
                  'modificationNotice': 'Publisher declares NeMo-to-GGUF format conversion, F16/F32 representation, baked filterbank/window and zero depthwise biases where omitted; no training or fine-tuning.',
                  'converterCommit': None,
                  'provenanceLimit': 'Publisher card does not identify the converter commit or original checkpoint revision used; no reproduction or model-card benchmark claim is adopted.'},
        'vad': {key: vad[key] for key in ['logicalModel', 'repository', 'revision', 'file', 'url', 'licenseDeclaredByModelCard']}
               | {'role': 'vad', 'device': 'cpu', 'required': True, 'sizeBytes': vad['publicationSizeBytes'], 'sha256': vad['publicationSha256']},
        'metadataEvidence': {name: identity(OUT / name) for name in ['parakeet-api.json', 'parakeet-card.md', 'nvidia-api.json', 'nvidia-card.md']},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['freeze', 'download', 'verify', 'check'])
    args = parser.parse_args()
    subprocess.run(['git', 'check-ignore', '--quiet', str(OUT)], cwd=REPO, check=True)
    encoded = (json.dumps(frozen_metadata(), ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if args.mode == 'freeze':
        if DEST.exists() and DEST.read_bytes() != encoded:
            raise ValueError('existing acquisition lock differs')
        DEST.write_bytes(encoded)
    else:
        assert DEST.read_bytes() == encoded, 'metadata/lock drift'
    if args.mode in ['download', 'verify']:
        lock = json.loads(encoded)
        for row in [lock['model'], lock['vad']]:
            dest = OUT / row['file']
            if args.mode == 'download' and not dest.exists():
                partial = dest.with_suffix(dest.suffix + '.partial')
                start = partial.stat().st_size if partial.exists() else 0
                request = urllib.request.Request(row['url'], headers={'Range': f'bytes={start}-'} if start else {})
                with urllib.request.urlopen(request, timeout=60) as response:
                    if start and (response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {start}-')):
                        raise ValueError('resume response mismatch; partial preserved')
                    received = start
                    with partial.open('ab' if start else 'wb') as stream:
                        while chunk := response.read(1024 * 1024):
                            received += len(chunk)
                            if received > row['sizeBytes']:
                                raise ValueError('download exceeds locked size; bounded partial preserved')
                            stream.write(chunk)
                verify(partial, row)
                partial.rename(dest)
            verify(dest, row)
        (OUT / 'weights-verified.json').write_text(json.dumps({
            'files': {row['file']: identity(OUT / row['file']) for row in [lock['model'], lock['vad']]},
            'gguf': gguf_metadata(OUT / lock['model']['file']),
        }, indent=2) + '\n')
    print('PASS:', args.mode)


if __name__ == '__main__':
    main()
