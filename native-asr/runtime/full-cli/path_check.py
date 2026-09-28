"""Offline path regression; no models, network, compilation or CLI execution."""
from pathlib import Path
import runpy
import json
import subprocess
import sys
import tempfile


def main():
    import prepare
    import smoke

    here = Path(__file__).resolve().parent
    producer = runpy.run_path(str(here / 'package.py'))
    assert producer['LOCK'] == prepare.LOCK == here / 'upstream-engineering-baseline-lock.json'
    assert smoke.LOCAL == prepare.LOCAL == prepare.REPO / 'native-asr/build/full-cli'
    for name in ('prepare.py', 'package.py', 'smoke.py'):
        text = (here / name).read_text(encoding='utf-8')
        assert '.trellis/tasks/' not in text and 'research/local/' not in text, name
        if name != 'smoke.py':
            assert 'LOCK.read_text(' in text, name
    for path in (
        'native-asr/build/full-cli/offline-check/result.json',
        '.trellis/tasks/08-20-native-asr-qwen3-aligner/research/local/offline-check.json',
        '.trellis/tasks/archive/2099-01/08-20-native-asr-qwen3-aligner/research/local/offline-check.json',
    ):
        subprocess.run(['git', 'check-ignore', '--quiet', path], cwd=prepare.REPO, check=True)

    with tempfile.TemporaryDirectory(prefix='qwen-full-cli-path-') as temporary:
        root = Path(temporary).resolve()
        copied = root / 'native-asr/runtime/full-cli'
        copied.mkdir(parents=True)
        (root / 'native-asr/protocol-v1-limits.json').write_bytes(
            (prepare.REPO / 'native-asr/protocol-v1-limits.json').read_bytes())
        for name in ('prepare.py', 'package.py', 'smoke.py', 'validate.py', prepare.LOCK.name):
            (copied / name).write_bytes((here / name).read_bytes())
        # Whitespace in an internal lock is not an identity change.
        copied_lock = copied / prepare.LOCK.name
        copied_lock.write_text(json.dumps(json.loads(copied_lock.read_text(encoding='utf-8')), indent=4), encoding='utf-8')
        with (copied / 'smoke.py').open('a', encoding='utf-8') as script:
            script.write('\n# Local edits do not require a new evidence lock.\n')
        # No .trellis tree at all: neither active nor archived task can supply inputs.
        code = r'''
import json, runpy, sys
from pathlib import Path
from unittest.mock import patch
root = Path.cwd()
here = root / 'native-asr/runtime/full-cli'
# Preserve the existing repository-root runpy caller, without a sys.path workaround.
producer = runpy.run_path(str(here / 'package.py'))
sys.path.insert(0, str(here))
import prepare, smoke
assert not (root / '.trellis').exists()
assert producer['ROOT'] == prepare.REPO == root
assert producer['LOCK'] == prepare.LOCK == here / 'upstream-engineering-baseline-lock.json'
assert smoke.LOCAL == prepare.LOCAL == root / 'native-asr/build/full-cli'
prepare.LOCAL.mkdir(parents=True)
locked = json.loads(prepare.LOCK.read_text(encoding='utf-8'))
class ReachedVerifiedInput(Exception):
    pass

def attempt(output, expected):
    argv = ['prepare.py', '--cache', str(root / 'cache'), '--c2pa-archive', str(root / 'c2pa.tar.gz'), '--output', str(output)]
    with patch.object(sys, 'argv', argv), patch.object(prepare.subprocess, 'run') as git, patch.object(prepare, 'verify', side_effect=ReachedVerifiedInput) as verify, patch.object(prepare, 'extract') as extract:
        try:
            prepare.main()
        except expected:
            pass
        else:
            raise AssertionError('expected boundary not reached')
        extract.assert_not_called()
        if expected is ReachedVerifiedInput:
            verify.assert_called_once_with(root / 'cache/source.tar.gz', locked['source']['archive'])
            git.assert_called_once_with(['git', 'check-ignore', '--quiet', str(output.resolve())], cwd=root, check=True)
        else:
            git.assert_not_called()
            verify.assert_not_called()
        assert not output.exists() or output == prepare.LOCAL

attempt(prepare.LOCAL / 'fresh', ReachedVerifiedInput)
for output in (root / 'outside', prepare.LOCAL / '../escape', root / 'native-asr/build/full-cli-sibling/fresh', prepare.LOCAL):
    attempt(output, ValueError)
print('PASS: task-absent imports/runpy and fresh/escape/sibling/existing output boundaries')
'''
        subprocess.run([sys.executable, '-B', '-c', code], cwd=root, check=True, timeout=20)
        for name in ('prepare.py', 'package.py', 'smoke.py'):
            result = subprocess.run([sys.executable, '-B', str(copied / name), '--help'], cwd=root,
                                    capture_output=True, text=True, check=True, timeout=10)
            assert 'usage:' in result.stdout and '--help' in result.stdout, name
    print('PASS: shared consumers, ignored active/archive/scratch, task-absent help, fresh/escape path checks')


if __name__ == '__main__':
    main()
