"""Offline shared dependency evidence, using the existing hash-bound publisher pattern.

--freeze records retained inputs once; --check reproduces the sanitized summary.
No download, model execution, package creation or historical evidence rewriting.
"""
import argparse
from pathlib import Path

from fixes_publish import HERE, LOCAL, REPO, encoded, identity, load, verify

RAW = LOCAL / 'dependency-final'
LOCK = RAW / 'evidence-lock.json'
OUTPUT = HERE / 'dependency-evidence.json'
SOURCES = [
    'native-asr/runtime/crispasr-product-lock.json',
    'native-asr/runtime/crispasr-product-lock-v1.json',
    'native-asr/runtime/full-cli/package.py',
    'native-asr/CMakeLists.txt', 'native-asr/src/full_cli.cpp',
    'native-asr/src/qwen_cli.cpp', 'native-asr/src/parakeet_cli.cpp',
    'native-asr/src/main.cpp', 'native-asr/src/protocol.cpp',
    'scripts/prepare-asr-resource.mjs', 'scripts/verify-crispasr-runtime.mjs',
    'scripts/prepare-asr-resource.test.mjs', 'scripts/verify-crispasr-runtime.test.mjs',
    'tests/PortablePackage.test.ts', 'src-tauri/build.rs',
    'src-tauri/src/dependencies.rs', 'src-tauri/src/dependencies_crispasr.rs',
    'src-tauri/src/dependencies_crispasr_delivery.rs',
    'src-tauri/src/asr.rs', 'src-tauri/src/asr_models.rs', 'src-tauri/src/asr_worker.rs',
    'src-tauri/resources/native-asr-models.json',
    'src-tauri/resources/runtime-dependency-sources.json',
]
FILES = [
    'release-before.json', 'release-after.json', 'download-results.json',
    'official-download.zip', 'china-download.zip', 'app/audit.json',
    'official-installation/package-check.json', 'china-installation/package-check.json',
    'build.cmd', 'build-cpu.log', 'build-cuda.log', 'build-cpu-r2.log', 'build-cuda-r2.log',
    'package.log', 'verify-local.log', 'upload.log', 'official-download.log', 'china-download.log',
    'cargo-full.log', 'pnpm-test.log', 'pnpm-test-r2.log', 'release-local.log',
    'official-installation.log', 'china-installation.log',
]


def freeze():
    assert not LOCK.exists(), 'fresh evidence required'
    LOCK.write_bytes(encoded({
        'publisher': identity(Path(__file__)),
        'helper': identity(HERE / 'fixes_publish.py'),
        'sources': {name: identity(REPO / name) for name in SOURCES},
        'files': {name: identity(RAW / name) for name in FILES},
        'app': identity(REPO / '.local/parakeet-final/hikaru-sub.exe'),
        'oldApp': identity(REPO / '.local/parakeet-app/hikaru-sub.exe'),
    }))


def derive():
    frozen = load(LOCK)
    verify(Path(__file__), frozen['publisher'])
    verify(HERE / 'fixes_publish.py', frozen['helper'])
    for name, row in frozen['sources'].items(): verify(REPO / name, row)
    for name, row in frozen['files'].items(): verify(RAW / name, row)
    for name, key in [('parakeet-final', 'app'), ('parakeet-app', 'oldApp')]:
        verify(REPO / '.local' / name / 'hikaru-sub.exe', frozen[key])
    product = load(REPO / SOURCES[0])
    previous = load(RAW / 'pre-edit' / SOURCES[0])
    assert (REPO / SOURCES[1]).read_bytes() == (RAW / 'pre-edit' / SOURCES[0]).read_bytes()
    assert product['externalStableAssetPublished'] and product['productEnablementAllowed']
    before, after = load(RAW / 'release-before.json'), load(RAW / 'release-after.json')
    for old in before['assets']:
        assert old == next(row for row in after['assets'] if row['id'] == old['id'])
    asset = next(row for row in after['assets'] if row['name'].endswith('cuda-shared-v2.zip'))
    downloads = load(RAW / 'download-results.json')
    assert [row['profile'] for row in downloads] == ['official', 'china']
    profiles = load(REPO / SOURCES[-1])['platforms']['windows-x64']
    for row in downloads:
        assert row['verified'] and row['exitCode'] == 0
        assert row['sizeBytes'] == asset['size'] == product['cuda']['archive']['sizeBytes']
        assert 'sha256:' + row['sha256'] == asset['digest']
        source = profiles[row['profile']]['crispasrCuda']
        assert all(source[k] == row[k] for k in ['url', 'sizeBytes', 'sha256'])
    assert downloads[0]['url'] == asset['url']
    assert downloads[1]['url'] == 'https://ghfast.top/' + asset['url']
    p1 = load(LOCAL / 'parakeet-runtime-lock-r4.json')
    for device in ['cpu', 'cuda']:
        artifact = product[device]
        assert artifact['engines'] == ['qwen3-asr', 'parakeet']
        verify(REPO / artifact['archive']['path'], {k: artifact['archive'][k] for k in ['sizeBytes', 'sha256']})
        current = {row['path']: {k: row[k] for k in ['sizeBytes', 'sha256']} for row in artifact['files']}
        for name, row in p1['devices'][device]['files'].items(): assert current[name] == row
    app = (REPO / '.local/parakeet-final/hikaru-sub.exe').read_bytes()
    assert (REPO / SOURCES[0]).read_bytes() in app
    assert (REPO / 'src-tauri/resources/native-asr-models.json').read_bytes() in app
    assert frozen['oldApp']['sha256'] == 'b516277031322220fb4188bfba4c1be07b87400ff3cefcde0c64fbccbf366788'
    audit = load(RAW / 'app/audit.json')
    for name, limit, suffix in [('nsis', 80, '*-setup.exe'), ('portable', 90, '*-portable.zip')]:
        assert audit[name]['sizeBytes'] <= limit * 1024 ** 2
        verify(next((RAW / 'app').glob(suffix)), audit[name])
    assert all(row['ct2FilesUnchanged'] == 19 for row in audit['modes'].values())
    checks = {name: load(RAW / (name + '-installation/package-check.json')) for name in ['official', 'china']}
    for row in checks.values():
        assert all(row[key] for key in ['exactClosure', 'cudaComputeProbe', 'missingAndCorruptRejected',
            'managedRootAdjacent', 'syntheticDeviceFailureIsolated', 'priorAssPreserved',
            'externalStableAssetPublished', 'downloadAvailable', 'bothEnginesAuthorized'])
        assert not row['manualInstallOrUi']
    for name, text in [('build-cpu-r2.log', '100% tests passed, 0 tests failed out of 9'),
                       ('build-cuda-r2.log', '100% tests passed, 0 tests failed out of 9'),
                       ('cargo-full.log', '301 passed; 0 failed; 3 ignored'),
                       ('pnpm-test-r2.log', '893 passed'),
                       ('release-local.log', 'created portable package:')]:
        assert text in (RAW / name).read_text(encoding='utf-8', errors='replace'), name
    return {
        'schemaVersion': 1, 'scope': 'shared dependency publication and default local distribution; independent review pending',
        'rawLock': identity(LOCK), 'productLock': identity(REPO / SOURCES[0]),
        'rollbackLock': identity(REPO / SOURCES[1]), 'oldCudaArchive': previous['cuda']['archive'],
        'asset': {k: asset[k] for k in ['id', 'name', 'url', 'size', 'digest']},
        'downloads': downloads, 'app': frozen['app'], 'oldPreFixApp': frozen['oldApp'],
        'packages': {k: audit[k] for k in ['nsis', 'portable']}, 'installationChecks': checks,
        'modelRuns': 0, 'unchangedP1CliAndDlls': True, 'ct2FilesUnchangedPerPackage': 19,
        'limits': ['No new application release, manual installation/uninstallation or fresh inference/UI claim.',
                   'New local app contains no model weights; exact F16 and required CPU Silero remain on-demand.',
                   'Six retained host and two UI proofs retain their original source/runtime identities.',
                   'Long/expanded-relative audio paths, deep CLI roots and cross-volume deep-work remain unsupported.',
                   'Physical CUDA inference evidence remains RTX 3070 only; probe is model-free.',
                   'Initial command-line no-op and stale resource fixture failure are retained separately from successful checks.'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.freeze: freeze()
    result = encoded(derive())
    if args.check: assert OUTPUT.read_bytes() == result, 'evidence drift'
    else: OUTPUT.write_bytes(result)
    print('shared dependency evidence verified; modelRuns=0')
