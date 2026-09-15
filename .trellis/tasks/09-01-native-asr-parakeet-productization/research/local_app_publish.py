"""Offline retained local-app evidence. No app launch, inference, probe or publication.

--freeze anchors the retained UI/package/check files once; --check reproduces the
sanitized summary and exercises ASS-drift rejection. Historical runner outcomes
are not rewritten. The original runtime/model and prior publishers stay frozen.
"""
import argparse
from copy import deepcopy
import re
from pathlib import Path

from fixes_publish import HERE, LOCAL, REPO, encoded, identity, load, verify

RAW_LOCK = LOCAL / 'local-app-finalization-lock.json'
OUTPUT = HERE / 'local-app-evidence.json'
RUNS = ['local-app-ui-cpu', 'fresh-short-app-ui-cpu', 'fresh-short-app-ui-cuda']
LOGS = {
    'fixes-pnpm-test-final-r2.log': r'Tests\s+893 passed',
    'local-app-cargo-default-r2.log': r'test result: ok\. 301 passed; 0 failed; 3 ignored',
    'local-app-cargo-candidate.log': r'test result: ok\. 301 passed; 0 failed; 3 ignored',
    'local-app-release-local.log': r'created portable package:',
}


def freeze():
    assert not RAW_LOCK.exists(), 'fresh evidence required'
    files = [p for name in RUNS for p in (LOCAL / name).iterdir() if p.is_file()]
    names = list(LOGS) + [
        'local-app-lock.json', 'local-app-run.py', 'local-app-ui.mjs',
        'fresh-short-app-lock.json', 'fresh-short-app-run.py', 'fresh-short-app-inputs.json',
        'fresh-short-app-cuda-lock.json', 'fresh-short-app-cuda-run.py', 'fresh-short-app-ui-cuda.mjs',
        'fresh-short-app-cuda-runner.log', 'fresh-short-app-cpu-runner.log',
        'fresh-cwd-proof.py', 'fresh-cwd-proof.json', 'fresh-retained-command-bindings.json',
        'fresh-resource-restoration.json', 'fresh-restore-resources.mjs', 'fresh-restore-resources.log',
        'finalization-safety.json', 'finalization-runtime-trees.json',
        'shared-local-r1/local-app-r1/inputs.json', 'shared-local-r1/crispasr-product-lock.json',
    ]
    files += [LOCAL / name for name in names]
    old_workspace = Path(load(LOCAL / RUNS[0] / 'session.json')['workspacePath'])
    files += list((old_workspace / 'asr-jobs').glob('*.json'))
    RAW_LOCK.write_bytes(encoded({
        'files': {p.relative_to(LOCAL).as_posix(): identity(p) for p in sorted(set(files))},
        'publisher': identity(Path(__file__)),
        'helpers': {'fixes_publish.py': identity(HERE / 'fixes_publish.py')},
    }))


def validate_ass(snapshot, ass):
    assert snapshot['status'] == 'completed' and snapshot['segmentCount'] == len(snapshot['segments']) == 9
    rows = [line[len('Dialogue:'):].lstrip().split(',', 9)
            for line in ass.splitlines() if line.startswith('Dialogue:')]
    assert len(rows) == len(snapshot['segments'])
    def stamp(ms):
        cs = ms // 10  # Frontend serializer truncates to ASS centiseconds.
        return f'{cs // 360000}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}'
    previous = -1
    for row, segment in zip(rows, snapshot['segments']):
        start, end, text = segment['startMs'], segment['endMs'], segment['text']
        assert type(start) is int and type(end) is int
        assert 0 <= start < end <= snapshot['durationMs'] and start >= previous and text.strip()
        assert row[1:3] == [stamp(start), stamp(end)]
        assert row[9] == text.replace('\r\n', '\n').replace('\n', '\\N')
        previous = start


def derive():
    frozen = load(RAW_LOCK)
    verify(Path(__file__), frozen['publisher'])
    for name, expected in frozen['helpers'].items(): verify(HERE / name, expected)
    for name, expected in frozen['files'].items(): verify(LOCAL / name, expected)
    inputs = load(LOCAL / 'fresh-short-app-inputs.json')
    app = Path(inputs['app'])
    candidate_path = Path(inputs['lock'])
    candidate = load(candidate_path)
    for name, input_path, ui, runner in [
        ('local-app-lock.json', LOCAL / 'shared-local-r1/local-app-r1/inputs.json', 'local-app-ui.mjs', 'local-app-run.py'),
        ('fresh-short-app-lock.json', LOCAL / 'fresh-short-app-inputs.json', 'local-app-ui.mjs', 'fresh-short-app-run.py'),
        ('fresh-short-app-cuda-lock.json', LOCAL / 'fresh-short-app-inputs.json', 'fresh-short-app-ui-cuda.mjs', 'fresh-short-app-cuda-run.py'),
    ]:
        binding = load(LOCAL / name)
        for path, key in [(input_path, 'inputs'), (Path(inputs['exe']), 'app'),
                          (candidate_path, 'runtimeLock'), (LOCAL / ui, 'ui'), (LOCAL / runner, 'runner')]:
            verify(path, binding[key])
        for path, row in binding['sources'].items(): verify(REPO / path, row)
    assert candidate['externalStableAssetPublished'] is False
    manifest_path = REPO / 'src-tauri/resources/native-asr-models.json'
    model = next(row for row in load(manifest_path)['models'] if row['engine'] == 'parakeet')
    assert model['model'] == 'nvidia/parakeet-tdt_ctc-0.6b-ja' and model['postMvpUnavailable'] is False
    exe = Path(inputs['exe']).read_bytes()
    assert candidate_path.read_bytes() in exe and manifest_path.read_bytes() in exe and (app / '.portable').is_file()
    for device, root in [('cpu', app / 'native-asr/windows-x64/crispasr/cpu'),
                         ('cuda', app / 'deps/asr-runtime/crispasr/cuda/current')]:
        assert candidate[device]['engines'] == ['qwen3-asr', 'parakeet']
        for row in candidate[device]['files']:
            verify(root / row['path'], {k: row[k] for k in ['sizeBytes', 'sha256']})
    for row, root in [(model['files'][0], app / 'deps/models/crispasr/parakeet' / model['model'] / model['revision']),
                      (model['requiredVad'], app / 'deps/models/shared/silero/vad' / model['requiredVad']['source']['revision'])]:
        verify(root / row['path'], {k: row[k] for k in ['sizeBytes', 'sha256']})
    for name, row in inputs['packages'].items():
        verify(LOCAL / 'shared-local-r1/local-app-r1' / name, row)
        assert row['sizeBytes'] <= (90 if name.endswith('.zip') else 80) * 1024 ** 2
    # Explicit old authority records; absence is not inferred from a missing file.
    for path, row in load(LOCAL / 'fixes-pre-edit/published-identities.json').items():
        if row.get('absentAtTakeover'): assert not (REPO / path).exists()
        else: verify(REPO / path, row)
    results = []
    for name, device in zip(RUNS[1:], ['cpu', 'cuda']):
        run = LOCAL / name
        summary, owner = load(run / 'summary.json'), load(run / 'ownership.json')
        validate_ass(load(run / 'snapshot.json'), (run / 'final.ass').read_text(encoding='utf-8'))
        assert identity(run / 'snapshot.json')['sha256'] == summary['snapshotSha256']
        assert identity(run / 'final.ass')['sha256'] == summary['assSha256']
        assert (run / 'final.ass').read_bytes() == (run / f'short-{device}.transcribed.ass').read_bytes()
        selection = load(run / 'selection.json')
        assert [row['text'] for row in selection] == ['parakeet', 'parakeet-tdt_ctc-0.6b-ja',
                                                        'CPU' if device == 'cpu' else 'CUDA（NVIDIA GPU）']
        assert not any(row['disabled'] for row in selection)
        assert load(run / 'model-status.json')['disposition'] == 'ready'
        engines = load(run / 'engine-list.json')['engines']
        engine = next(row for row in engines if row['name'] == 'parakeet')
        assert engine['available'] and all(row['available'] for row in engine['devices'])
        assert not next(row for row in engine['devices'] if row['device'] == 'cuda')['downloadRequired']
        assert owner['processExitConfirmed'] and owner['activeJobProcesses'] == 0
        assert load(run / 'process-before.json') == load(run / 'process-after.json') == []
        assert summary['status'] == 'passed' and summary['device'] == device
        if device == 'cpu':
            assert owner['state'] == 'terminated-unscored' and owner['failure'] == 'ValueError:child_process_remaining'
        else:
            completion = load(run / 'cuda-completion.json')
            assert completion['summary'] == summary and completion['attempt'] == owner['cudaAttempt']
            assert completion['recoveryOf'] is None and owner['outcome'] == 'exited-zero' and owner['state'] == 'reaped'
            for path, row in completion['evidence'].items(): verify(run / path, row)
            attempt = load(run / 'cuda-attempt.json')['binding']
            assert attempt['runtimeLock'] == identity(LOCAL / 'fresh-short-app-cuda-lock.json')
            assert attempt['app'] == inputs['exeIdentity'] and attempt['models'] == inputs['modelAndVad']
        results.append({'run': name, 'functional': summary, 'historicalRunner': {
            key: owner.get(key) for key in ['state', 'outcome', 'failure', 'exitCode', 'processExitConfirmed', 'activeJobProcesses']}})
    failed = load(LOCAL / RUNS[0] / 'ownership.json')
    assert failed['outcome'] == 'interrupted' and not (LOCAL / RUNS[0] / 'summary.json').exists()
    old_snapshots = [load(LOCAL / path) for path in frozen['files'] if '/asr-jobs/' in path and path.endswith('.json')]
    assert len(old_snapshots) == 1
    old = old_snapshots[0]
    assert old['status'] == 'failed' and old['segments'] == [] and old['error'].startswith('[parakeet_cli_process_failed]')
    cwd = Path(load(LOCAL / RUNS[0] / 'session.json')['workspacePath']) / 'asr-jobs' / (old['id'] + '-cli')
    cwd_proof = load(LOCAL / 'fresh-cwd-proof.json')
    assert all(row['winerror'] == 267 for row in cwd_proof[1:])
    for name, pattern in LOGS.items():
        log = re.sub(r'\x1b\[[0-9;]*m', '', (LOCAL / name).read_text(encoding='utf-8', errors='replace'))
        assert re.search(pattern, log), name
    safety = load(LOCAL / 'finalization-safety.json')
    assert safety['mutexAcquired'] and safety['modelProcesses'] == safety['durableCudaGates'] == []
    restored = load(LOCAL / 'fresh-resource-restoration.json')
    default_manifest = REPO / 'src-tauri/resources/native-asr/windows-x64/crispasr/cpu/runtime-manifest.json'
    assert identity(default_manifest)['sha256'] == restored['manifestSha256']
    return {'schemaVersion': 1, 'scope': 'retained exact-byte short-path local WebView CPU/CUDA delivery; independent review pending',
            'rawLock': identity(RAW_LOCK), 'app': inputs['exeIdentity'], 'packages': inputs['packages'],
            'candidateLock': identity(candidate_path), 'modelAndVad': inputs['modelAndVad'], 'runs': results,
            'retainedPassedLogs': list(LOGS), 'defaultResources': restored,
            'safetyAtFinalization': safety, 'longPath': {'resolved': False, 'failedProductCwdCharacters': len(str(cwd)),
                'productErrorCode': 'parakeet_cli_process_failed', 'modelFreeCreateProcessResults': [
                    {k: v for k, v in row.items() if k != 'error'} for row in cwd_proof]},
            'limits': ['No new inference during finalization; no relabeling of CPU outer interrupted/unscored disposition.',
                       'UI used real selections/clicks and normal product start/save, with synthetic file-drop and seeded verified audio cache.',
                       'No manual installer/uninstaller test or fresh model network download. CUDA is locally installed, unpublished and not offered for download.',
                       'Short-path success does not fix the deep-path CLI working-directory failure.',
                       'P1 unchanged runtime/device evidence and six prior host cases retain their original scope; physical CUDA evidence is RTX 3070 only.',
                       'No quality score, owner listening judgment, whole-task acceptance or release decision.']}


def check_mutations():
    run = LOCAL / RUNS[1]
    snapshot, ass = load(run / 'snapshot.json'), (run / 'final.ass').read_text(encoding='utf-8')
    for field, value in [('text', 'changed'), ('startMs', -1), ('endMs', 0)]:
        changed = deepcopy(snapshot)
        changed['segments'][0][field] = value
        try: validate_ass(changed, ass)
        except AssertionError: pass
        else: raise AssertionError('ASS mutation accepted: ' + field)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.freeze: freeze()
    result = encoded(derive())
    if args.check:
        assert OUTPUT.read_bytes() == result, 'evidence not reproducible'
        check_mutations()
    else: OUTPUT.write_bytes(result)
    print('PASS: retained local CPU/CUDA UI/ASS identities, separate runner dispositions, package/source bindings and default restoration')
