"""Prepare a fresh, verified full upstream source tree; never edit cached sources."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import posixpath

REPO = Path(__file__).resolve().parents[3]
LOCAL = REPO / 'native-asr/build/full-cli'
LOCK = Path(__file__).resolve().with_name('upstream-engineering-baseline-lock.json')
C2PA = {
    'url': 'https://codeload.github.com/CrispStrobe/c2pa-audio/tar.gz/e40329b83f16f67bb5ddc7bb13ae18de0a9376fc',
    'sizeBytes': 256595,
    'sha256': '6387e20dbbc34f46645f98a7b25d39ca7caf8aa44e8d0b7df5c6105194b1f952',
}


def verify(path, identity):
    if path.stat().st_size != identity['sizeBytes']:
        raise ValueError('size mismatch')
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != identity['sha256']:
        raise ValueError('hash mismatch')


def extract(archive, destination):
    # Extract regular source files only, stripping the single archive root.
    with tarfile.open(archive) as tar:
        roots = {m.name.split('/')[0] for m in tar.getmembers()}
        if len(roots) != 1:
            raise ValueError('archive root mismatch')
        for member in tar.getmembers():
            parts = Path(member.name).parts[1:]
            if not parts:
                continue
            if any(p in ('.', '..') or ':' in p or '\\' in p for p in parts):
                raise ValueError('unsafe archive path')
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tar.extractfile(member).read())
            elif member.issym():
                linked = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
                if linked.split('/')[0] not in roots or not tar.getmember(linked).isfile():
                    raise ValueError('unsafe source link')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tar.extractfile(linked).read())
            else:
                raise ValueError('non-regular source member')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--c2pa-archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    destination.relative_to(LOCAL.resolve())
    if destination.exists():
        raise ValueError('fresh output directory required')
    subprocess.run(['git', 'check-ignore', '--quiet', str(destination)], cwd=REPO, check=True)
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    for archive, identity in [(args.cache / 'source.tar.gz', lock['source']['archive']),
                              (args.cache / 'ggml.tar.gz', lock['source']['submodules'][0]['archive']),
                              (args.c2pa_archive, C2PA)]:
        verify(archive, identity)
    extract(args.cache / 'source.tar.gz', destination)
    extract(args.cache / 'ggml.tar.gz', destination / 'ggml')
    extract(args.c2pa_archive, destination / 'third_party/c2pa-audio')
    print('Verified source archives, GGML, c2pa-audio; fresh full tree prepared.')


if __name__ == '__main__':
    main()
