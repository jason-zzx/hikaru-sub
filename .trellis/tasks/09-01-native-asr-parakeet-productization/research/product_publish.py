"""Offline sanitized P2/P3/P4 functional evidence; no inference/observer/quality scoring.

--freeze anchors retained raw outputs once under ignored scratch. --check replays
hash-verified actual host snapshots, private CLI results and exact ASS Dialogue
rows. Historical runner failures retain their disposition separately from usable
CPU transcription/ASS/reap facts. No published artifact or availability is changed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import shutil
import tempfile

REPO = Path(__file__).resolve().parents[4]
LOCAL = REPO / 'native-asr/build/full-cli'
RAW_LOCK = LOCAL / 'product-evidence-lock.json'
OUTPUT = Path(__file__).with_name('product-evidence.json')
sys.path.insert(0, str(REPO / 'native-asr/runtime/full-cli'))
from prepare import verify
from smoke import identity
from validate import require


def load(path):
    return json.loads(path.read_bytes())


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def freeze():
    require(not RAW_LOCK.exists(), 'evidence_lock_exists')
    names = ['p2-parakeet-cpu-short', 'p2-parakeet-cpu-short-r2', 'p2-parakeet-cpu-short-r3']
    names += [p.name for p in sorted(LOCAL.glob('p2-parakeet-*-no-observer')) if p.is_dir()]
    names += [p.name for p in sorted(LOCAL.glob('p3-parakeet-*')) if p.is_dir()]
    names += [p.name for p in sorted(LOCAL.glob('p4-parakeet-*')) if p.is_dir()]
    paths = [p for name in names for p in sorted((LOCAL / name).rglob('*')) if p.is_file()]
    paths += [LOCAL / name for name in ['p2-lock.json', 'p2-lock-r2.json', 'p2-lock-r3.json',
              'p2-lock-no-observer.json', 'p3-managed-lock.json', 'parakeet-runtime-lock-r4.json']]
    # Include exact host/worker binaries, not only a claim about source behavior.
    for name in ['p2-lock-no-observer.json', 'p3-managed-lock.json']:
        lock = load(LOCAL / name)
        paths.append(Path(lock['host']['path']))
    for device in ['cpu', 'cuda']:
        paths.extend(p for p in sorted((LOCAL / ('p2-runtime-' + device)).iterdir()) if p.is_file())
    RAW_LOCK.write_bytes(encoded({'runs': names, 'files': {p.relative_to(LOCAL).as_posix(): identity(p) for p in sorted(set(paths))}}))


def stamp(ms):
    cs = (ms + 5) // 10
    return f'{cs // 360000}:{cs % 360000 // 6000:02}:{cs % 6000 // 100:02}.{cs % 100:02}'


def validate_host(run, host, ownership):
    snapshot = load(run / 'host/snapshot.json')
    require(load(run / 'host/recovery.json') == snapshot, 'recovery_drift')
    require(host['status'] == snapshot['status'] and ownership.get('exitCode') == 0
            and ownership['processExitConfirmed'] and ownership['activeJobProcesses'] == 0, 'host_lifecycle')
    require(all(host[k] for k in ['activeGateReleased', 'privateWorkRemoved', 'processTreeReaped', 'recoveryMatches']), 'host_cleanup')
    ass = (run / 'host/result.ass').read_text(encoding='utf-8')
    rows = snapshot.get('segments', [])
    if host['status'] != 'completed':
        require(not rows and ass == 'preserve prior ASS', 'failed_or_cancelled_ass')
        if host['status'] == 'cancelled': require(host['cancelSeconds'] < 2, 'cancel_bound')
        return
    raw_bytes = (run / 'host/cli-result.json').read_bytes()
    require(b'\0' not in raw_bytes, 'raw_nul')
    raw = json.loads(raw_bytes.decode('utf-8'))
    require(raw['crispasr']['backend'] == 'parakeet' and raw['displayFallback'] is False, 'backend_fallback')
    require(rows == raw['displaySegments'], 'atomic_output_drift')
    require(len(rows) == host['segmentCount'] == snapshot['segmentCount'], 'count_drift')
    compact = lambda text: ''.join(c for c in text if not c.isspace())
    require(compact(''.join(r['text'] for r in rows)) == compact(''.join(r['text'] for r in raw['transcription'])), 'text_conservation')
    previous = -1
    for row in rows:
        start, end, text = row['startMs'], row['endMs'], row['text']
        require(type(start) is int and type(end) is int and previous <= start < end <= snapshot['durationMs'], 'timeline')
        require(start >= 0 and text.strip() and all(ord(c) >= 32 and ord(c) != 127 for c in text), 'subtitle_text')
        previous = start
    dialogues = [line for line in ass.splitlines() if line.startswith('Dialogue:')]
    expected = [f"Dialogue: 0,{stamp(r['startMs'])},{stamp(r['endMs'])},Primary,,0,0,0,,{r['text']}" for r in rows]
    if rows:
        require(dialogues == expected and raw['vadSilence'] is False, 'ass_dialogue_drift')
    else:
        require(raw['vadSilence'] is True and not raw['transcription'] and ass == 'preserve prior ASS', 'silence')


def publish():
    frozen = load(RAW_LOCK)
    for name, expected in frozen['files'].items(): verify(LOCAL / name, expected)
    current = load(LOCAL / 'p3-managed-lock.json')
    for path, expected in current['sources'].items(): verify(REPO / path, expected)
    verify(Path(__file__).with_name('p2_host.py'), current['harness'])
    acquisition = load(Path(__file__).with_name('p1-acquisition-lock.json'))
    manifest = load(REPO / 'src-tauri/resources/native-asr-models.json')
    parakeet = next(m for m in manifest['models'] if m['engine'] == 'parakeet')
    qwen = next(m for m in manifest['models'] if m['engine'] == 'qwen3-asr')
    require(parakeet['postMvpUnavailable'] is True and parakeet['requiredVad'] == qwen['requiredVad'], 'availability_or_shared_vad_drift')
    for key, source in [('path', 'file'), ('sizeBytes', 'sizeBytes'), ('sha256', 'sha256')]:
        require(parakeet['files'][0][key] == acquisition['model'][source], 'acquisition_drift')
    require(parakeet['repository'] == acquisition['model']['repository'] and parakeet['revision'] == acquisition['model']['revision'], 'model_source')
    records = []
    for name in frozen['runs']:
        run = LOCAL / name
        owned = load(run / 'ownership.json')
        top = load(run / 'summary.json') if (run / 'summary.json').exists() else None
        host = load(run / 'host/summary.json') if (run / 'host/summary.json').exists() else None
        if host: validate_host(run, host, owned)
        records.append({'run': name, 'runnerDisposition': top['status'] if top else 'historical-runner-failure',
            'functionalOutcome': host['status'] if host else 'no-validated-host-result',
            'device': host['device'] if host else load(run / 'inputs.json')['device'],
            'case': host['case'] if host else load(run / 'inputs.json')['case'],
            'segmentCount': host['segmentCount'] if host else None,
            'hostSeconds': round(host['elapsedSeconds'], 6) if host else None,
            'runnerSeconds': owned['elapsedSeconds'], 'processExitConfirmed': owned['processExitConfirmed'],
            'ownedProcessesAfter': owned['activeJobProcesses'],
            'cancelSeconds': host.get('cancelSeconds') if host else None,
            'firstCancelCleanupError': bool(host and host.get('firstCancelError')),
            'managedModelAndVad': bool(host and host.get('managedExactModelAndVad')),
            'optionalObserver': top.get('optionalObserver') if top else 'historical-not-required',
            'rawFileCount': sum(p.is_file() for p in run.rglob('*')),
            'rawFingerprint': hashlib.sha256(encoded({p.relative_to(run).as_posix(): identity(p)
                for p in sorted(run.rglob('*')) if p.is_file()})).hexdigest()})
    matrix = [r for r in records if r['run'] in ['p3-parakeet-cpu-short', 'p3-parakeet-cuda-short',
              'p4-parakeet-cpu-medium', 'p4-parakeet-cuda-medium', 'p4-parakeet-cpu-long', 'p4-parakeet-cuda-long']]
    require(len(matrix) == 6 and all(r['functionalOutcome'] == 'completed' and r['managedModelAndVad'] for r in matrix), 'six_case_matrix')
    for name in ['p4-parakeet-cuda-recovery', 'p4-parakeet-cuda-silence-recovery',
                 'p4-parakeet-cuda-invalid-audio-recovery', 'p4-parakeet-cuda-invalid-vad-recovery', 'p4-parakeet-cuda-invalid-model-recovery']:
        completion = load(LOCAL / name / 'cuda-completion.json')
        require(completion['recoveryOf'] is not None and load(LOCAL / name / 'ownership.json')['elapsedSeconds'] <= 120, 'recovery_sentinel')
    return {'schemaVersion': 1, 'scope': 'local Parakeet functional worker/managed-model/host/ASS evidence; not packaged-product or release acceptance',
        'rawLock': identity(RAW_LOCK), 'publisher': identity(Path(__file__)),
        'runtimeLock': identity(LOCAL / 'p3-managed-lock.json'), 'p1ReusedRuntimeLock': identity(LOCAL / 'parakeet-runtime-lock-r4.json'),
        'modelManifest': identity(REPO / 'src-tauri/resources/native-asr-models.json'),
        'exactModel': parakeet['model'], 'model': acquisition['model']['sha256'],
        'postMvpUnavailable': True, 'sixCaseMatrixPassed': True, 'records': records,
        'limitations': ['Real host runs use the test-only managed-path seam with unchanged unavailable manifest, not a product availability override.',
            'Complete preverified partials exercise offline managed publication; HTTP interruption/range/repair tests use synthetic bytes.',
            'Optional observer failures are retained separately and do not invalidate genuine successful CPU ASS/reap facts.',
            'CUDA cancellation can report a transient private-result deletion error; bounded existing cleanup retry succeeds without changing the first terminal outcome.',
            'Physical CUDA evidence is RTX 3070 only. No CER, semantic-gap, quality rank, RTF threshold or Python parity was evaluated.',
            'New shared runtime packaging/verifier integration, distribution and final installed/portable delivery are not closed; immutable published artifacts are still Qwen-only.']}


def check_mutations():
    source = LOCAL / 'p3-parakeet-cpu-short'
    with tempfile.TemporaryDirectory(prefix='product-output-check-', dir=LOCAL) as scratch:
        run = Path(scratch)
        shutil.copytree(source / 'host', run / 'host')
        host, owned = load(source / 'host/summary.json'), load(source / 'ownership.json')
        validate_host(run, host, owned)
        # Mutate actual retained output copies, never the original raw evidence.
        for name, mutate in [
            ('result.ass', lambda b: b.replace(b'Dialogue:', b'NotDialogue:', 1)),
            ('recovery.json', lambda b: b.replace(b'"completed"', b'"failed"', 1)),
            ('cli-result.json', lambda b: b + b'\x00garbage'),
        ]:
            path = run / 'host' / name
            original = path.read_bytes()
            path.write_bytes(mutate(original))
            try:
                validate_host(run, host, owned)
            except (ValueError, KeyError, TypeError):
                pass
            else:
                raise ValueError('mutation_not_rejected:' + name)
            finally:
                path.write_bytes(original)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.freeze: freeze()
    result = encoded(publish())
    if args.check:
        require(OUTPUT.read_bytes() == result, 'tracked_summary_drift')
        check_mutations()
    else: OUTPUT.write_bytes(result)
    print('PASS: hash-bound local functional evidence; six managed CPU/CUDA ASS rows; no quality/release claim')
