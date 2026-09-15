"""Offline F1-F5/local-package evidence; never inference, publication or relabeling.

--freeze binds actual new package/test/replay files once. --check verifies those
bytes and replays the original P1/product publishers with their preserved source
root, not the changed worker/packager. Original evidence JSON is never rewritten.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import runpy
import shutil
import sys
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
LOCAL = REPO / 'native-asr/build/full-cli'
PACKAGE = LOCAL / 'shared-local-r1'
RAW_LOCK = LOCAL / 'fixes-evidence-lock.json'
OUTPUT = HERE / 'fixes-evidence.json'
CANDIDATE = HERE / 'shared-local-candidate-lock.json'
SOURCES = ['native-asr/src/full_cli.cpp', 'native-asr/tests/full_cli_watchdog.py',
           'native-asr/tests/fake_qwen_cli.cpp', 'native-asr/CMakeLists.txt',
           'native-asr/runtime/full-cli/package.py', 'scripts/verify-crispasr-runtime.mjs',
           'scripts/verify-crispasr-runtime.test.mjs', 'scripts/prepare-asr-resource.mjs',
           'src-tauri/build.rs', 'src-tauri/src/dependencies_crispasr.rs',
           'src-tauri/src/dependencies_crispasr_delivery.rs',
           'src/components/workflow/TranscribeView.tsx', 'src/components/workflow/TranscribeView.test.tsx',
           'tests/PortablePackage.test.ts', 'src-tauri/resources/native-asr-models.json']


def load(path):
    return json.loads(path.read_bytes())


def identity(path):
    with path.open('rb') as stream:
        return {'sizeBytes': path.stat().st_size, 'sha256': hashlib.file_digest(stream, 'sha256').hexdigest()}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def verify(path, expected):
    assert identity(path) == expected, 'identity drift: ' + path.name


def freeze():
    assert not RAW_LOCK.exists() and not CANDIDATE.exists(), 'fresh evidence required'
    shutil.copyfile(PACKAGE / 'crispasr-product-lock.json', CANDIDATE)
    files = list(LOCAL.glob('fixes-*.log')) + list(LOCAL.glob('fixes-ui-replay-*.json'))
    files += [LOCAL / 'fixes-pre-edit/sources.json', LOCAL / 'fixes-pre-edit/published-identities.json',
              LOCAL / 'fixes-build.cmd', LOCAL / 'fixes-package-audit.mjs', LOCAL / 'fixes-ui-replay.test.tsx',
              PACKAGE / 'crispasr-product-lock.json', PACKAGE / 'source-identities.json',
              PACKAGE / 'app-r2/audit.json']
    files += [PACKAGE / f'runtime-check-{mode}-adjacent/package-check.json' for mode in ['installed', 'portable']]
    RAW_LOCK.write_bytes(encoded({'files': {p.relative_to(LOCAL).as_posix(): identity(p) for p in sorted(files)},
        'sources': {p: identity(REPO / p) for p in SOURCES}, 'publisher': identity(Path(__file__))}))


def derive():
    frozen = load(RAW_LOCK)
    verify(Path(__file__), frozen['publisher'])
    for p, expected in frozen['files'].items(): verify(LOCAL / p, expected)
    for p, expected in frozen['sources'].items(): verify(REPO / p, expected)
    preserved = LOCAL / 'fixes-pre-edit'
    for p, expected in load(preserved / 'sources.json').items(): verify(preserved / 'repo' / p, expected)
    for p, expected in load(preserved / 'published-identities.json').items():
        if expected.get('absentAtTakeover'):
            assert not (REPO / p).exists(), 'historical absent archive changed'
        else:
            verify(REPO / p, expected)
    # Explicit historical source binding, never an automatic fallback on drift.
    # Runtime/model/raw paths stay original and are verified by both publishers.
    sys.path.insert(0, str(HERE))
    for name, function, output in [('p1_publish.py', 'derive', 'p1-evidence.json'),
                                    ('product_publish.py', 'publish', 'product-evidence.json')]:
        module = runpy.run_path(str(HERE / name), run_name='frozen_source_replay')
        fn = module[function]
        fn.__globals__['REPO'] = preserved / 'repo'
        assert encoded(fn()) == (HERE / output).read_bytes(), 'historical evidence changed'
    lock = load(PACKAGE / 'crispasr-product-lock.json')
    assert CANDIDATE.read_bytes() == (PACKAGE / 'crispasr-product-lock.json').read_bytes()
    assert lock['candidateId'] == 'shared-local-r1' and lock['externalStableAssetPublished'] is False
    acquisition = load(HERE / 'p1-acquisition-lock.json')
    p1 = load(LOCAL / 'parakeet-runtime-lock-r4.json')
    artifacts = {}
    for device in ['cpu', 'cuda']:
        artifact = lock[device]
        assert artifact['engines'] == ['qwen3-asr', 'parakeet']
        archive = REPO / artifact['archive']['path']
        verify(archive, {k: artifact['archive'][k] for k in ['sizeBytes', 'sha256']})
        prefix = artifact['archive']['root']
        with zipfile.ZipFile(archive) as z:
            assert sorted(z.namelist()) == sorted(prefix + p for p in
                [r['path'] for r in artifact['files']] + ['runtime-manifest.json', 'SHA256SUMS'])
            for row in artifact['files']:
                data = z.read(prefix + row['path'])
                assert len(data) == row['sizeBytes'] and hashlib.sha256(data).hexdigest() == row['sha256']
                assert Path(row['path']).suffix.lower() not in ['.gguf', '.bin', '.onnx', '.pt', '.nemo', '.safetensors']
            models = json.loads(z.read(prefix + 'licenses/MODEL-SOURCES.json'))
            assert models['weightsBundled'] is False and models['assets'][-1] == acquisition['model']
        for name, old in p1['devices'][device]['files'].items():
            new = next(row for row in artifact['files'] if row['path'] == name)
            assert {k: new[k] for k in old} == old, 'P1 CLI/DLL bytes changed'
        artifacts[device] = {'artifactId': artifact['artifactId'], 'archive': artifact['archive'],
                            'manifestSha256': artifact['manifestSha256'], 'fileCount': len(artifact['files']),
                            'worker': next(row for row in artifact['files'] if row['path'] == 'hikaru-asr-worker.exe')}
    audit = load(PACKAGE / 'app-r2/audit.json')
    for kind, name, budget in [('nsis', 'Hikaru Sub_0.4.1_x64-setup.exe', 80),
                               ('portable', 'Hikaru Sub_0.4.1_x64-portable.zip', 90)]:
        verify(PACKAGE / 'app-r2' / name, audit[kind])
        assert audit[kind]['sizeBytes'] <= budget * 1024 ** 2
    roots = {}
    for mode, row in audit['modes'].items():
        resources = Path(row['resources'])
        for p in resources.rglob('*'):
            if p.is_file(): assert p.suffix.lower() not in ['.gguf', '.bin', '.onnx', '.pt', '.nemo', '.safetensors', '.wav']
        for file in lock['cpu']['files']:
            verify(resources / 'native-asr/windows-x64/crispasr/cpu' / file['path'], {k: file[k] for k in ['sizeBytes', 'sha256']})
        roots[mode] = load(PACKAGE / f'runtime-check-{mode}-adjacent/package-check.json')
        assert all(roots[mode][k] for k in ['exactClosure', 'cudaComputeProbe', 'missingAndCorruptRejected', 'syntheticDeviceFailureIsolated', 'priorAssPreserved', 'managedRootAdjacent'])
        assert roots[mode]['manualInstallOrUi'] is False and roots[mode]['externalStableAssetPublished'] is False
    replays = [load(p) for p in sorted(LOCAL.glob('fixes-ui-replay-*.json'))]
    assert len(replays) == 6
    for row in replays:
        assert identity(LOCAL / row['run'] / 'host/snapshot.json')['sha256'] == row['snapshotSha256']
        assert row['exactDocumentRows'] and row['exactAssRows'] and row['modelInference'] is False
    checks = {'fixes-build-cpu-r2.log': r'100% tests passed, 0 tests failed out of 9',
              'fixes-build-cuda.log': r'100% tests passed, 0 tests failed out of 9',
              'fixes-pnpm-test-final-r2.log': r'Tests\s+893 passed',
              'fixes-cargo-full-final.log': r'test result: ok\. 299 passed; 0 failed; 3 ignored',
              'fixes-cargo-candidate-full.log': r'test result: ok\. 299 passed; 0 failed; 3 ignored',
              'fixes-pnpm-build.log': r'built in', 'fixes-release-local.log': r'created portable package:',
              'fixes-ui-replay.log': r'Tests\s+6 passed'}
    for name, pattern in checks.items():
        log = re.sub(r'\x1b\[[0-9;]*m', '', (LOCAL / name).read_text(encoding='utf-8', errors='replace'))
        assert re.search(pattern, log), 'validation output missing: ' + name
    parakeet = next(row for row in load(REPO / 'src-tauri/resources/native-asr-models.json')['models'] if row['engine'] == 'parakeet')
    assert parakeet['postMvpUnavailable'] is True
    return {'schemaVersion': 1, 'scope': 'F1-F5 local engineering fixes and shared candidate extraction/resolution; not task/release acceptance',
        'rawLock': identity(RAW_LOCK), 'candidateLock': identity(CANDIDATE), 'artifacts': artifacts,
        'applications': {k: audit[k] for k in ['nsis', 'portable']}, 'packageRootChecks': roots,
        'frontendRetainedOutputReplays': replays, 'passedLogChecks': list(checks),
        'originalP1AndProductEvidenceReproduced': True, 'publishedAuthorityUnchanged': True,
        'cliAndRuntimeDllBytesUnchanged': True, 'postMvpUnavailable': parakeet['postMvpUnavailable'],
        'limits': ['No new model inference; six original managed host successes retain their original source/worker scope.',
                   'New worker path tested with real-clock synthetic CLI, not a new hardware quality matrix.',
                   'CUDA probe is model-free; physical P1 evidence remains RTX 3070 only.',
                   'No manual installer/WebView interaction, external candidate distribution, model enablement or release decision.',
                   'Initial ordinary fixture/setup/test failures remain in the frozen log set; no historical failure was relabeled.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.freeze: freeze()
    result = encoded(derive())
    if args.check: assert OUTPUT.read_bytes() == result, 'evidence not reproducible'
    else: OUTPUT.write_bytes(result)
    print('PASS: frozen source/raw replay, unchanged P1 CLI/DLLs, candidate/package/notice closure and frontend output fidelity')
