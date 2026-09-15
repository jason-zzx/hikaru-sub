"""Model-free Windows process regressions for BOTH P1 execute() callers.

Actual Python fixture processes are externally terminated; no ASR/CUDA model is
loaded. Each test has its own scratch mutex/blocker, never the real model gate.
"""
import argparse
import json
import msvcrt
import os
from pathlib import Path
import subprocess
import sys
import time

import parakeet_smoke as runner


def binding(backend):
    return {'backend': backend, 'runtimeLock': {'sha256': 'test-runtime'},
            'models': {'model': 'test-model'}, 'tool': {'sha256': 'test-caller'},
            'audio': {'sha256': runner.SHORT_SHA}}


def worker(root, backend, scenario, name):
    runner.LOCAL = root
    out = root / name
    out.mkdir()
    value = binding(backend)
    device = 'cuda'
    if scenario.startswith('drift-'):
        field = scenario[6:]
        if field == 'device':
            device = 'cpu'
        else:
            value[field] = 'changed'
    command = [sys.executable, '-c', 'import sys,time; print("fixture-ready",file=sys.stderr,flush=True); time.sleep(60)'
               if scenario in ['external-exit', 'interrupted-owner'] else 'import sys; print("fixture-done",file=sys.stderr)']
    env = dict(os.environ, **{'HIKARU_PARAKEET_DEVICE' if backend == 'parakeet' else 'HIKARU_QWEN_DEVICE': device})
    try:
        with (root / 'model.lock').open('a+b') as mutex:
            if mutex.tell() == 0:
                mutex.write(b'0'); mutex.flush()
            mutex.seek(0)
            msvcrt.locking(mutex.fileno(), msvcrt.LK_NBLCK, 1)
            try:
                if scenario == 'live-owner':
                    runner.begin_cuda(out, device, value, command, env)
                else:
                    record, error = runner.execute(command, env, out, device, value)
                    summary = {'device': device, 'backend': backend, 'runtimeLock': value['runtimeLock'],
                               'status': 'failed' if error else 'passed', 'testOnly': True}
                    if not error:
                        if scenario == 'late-sentinel':
                            record['elapsedSeconds'] = 120.001  # explicit model-free clock mutation
                            runner.write(out / 'ownership.json', record)
                        if scenario == 'wrong-backend-completion':
                            summary['backend'] = 'qwen3' if backend == 'parakeet' else 'parakeet'
                        runner.complete_cuda(root / 'unfinished' if scenario == 'wrong-attempt-completion' else out, summary)
                    runner.write(out / 'test-summary.json', {**summary, 'record': record, 'error': error})
            finally:
                mutex.seek(0); msvcrt.locking(mutex.fileno(), msvcrt.LK_UNLCK, 1)
        if scenario == 'live-owner':
            # Deliberately release the mutex while the durable owner remains
            # alive: reconciliation must still refuse, and must not kill it.
            time.sleep(60)
    except (ValueError, OSError) as exc:
        runner.write(out / 'rejected.json', {'code': str(exc) if isinstance(exc, ValueError) else type(exc).__name__})
    return 0


def await_record(path):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if path.exists():
            value = json.loads(path.read_bytes())
            if value.get('state') == 'running-in-job':
                return value
        time.sleep(0.05)
    raise AssertionError('fixture did not enter owned Job within 10s')


def check_recovery(out):
    out.mkdir(parents=True, exist_ok=False)
    rows = []
    for backend in ['parakeet', 'qwen3']:
        for scenario in ['external-exit', 'interrupted-owner', 'live-owner']:
            root = out / (backend + '-' + scenario)
            root.mkdir()
            def launch(mode, name, wait=True):
                command = [sys.executable, '-B', str(Path(__file__).resolve()), '--worker', str(root), backend, mode, name]
                if wait:
                    subprocess.run(command, check=True, timeout=20, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                    return root / name
                return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            owner = launch(scenario, 'unfinished', False)
            child = None
            try:
                if scenario == 'live-owner':
                    deadline = time.monotonic() + 10
                    while not (root / 'cuda-ownership.json').exists() and time.monotonic() < deadline:
                        time.sleep(0.05)
                    assert (root / 'cuda-ownership.json').exists()
                    rejected = launch('sentinel', 'live-refused')
                    assert (rejected / 'rejected.json').exists() and owner.poll() is None
                    assert json.loads((rejected / 'rejected.json').read_bytes())['code'] in ['cuda_owner_still_live', 'OSError']
                    owner.terminate(); owner.wait(timeout=10)
                else:
                    child = await_record(root / 'unfinished/ownership.json')
                    if scenario == 'external-exit':
                        # External, task-owned PID+creation checked termination.
                        assert runner.process_stamp(child['pid']) == child['pidCreated']
                        subprocess.run(['taskkill', '/F', '/PID', str(child['pid'])], check=True,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=10)
                        owner.wait(timeout=10)
                        record = json.loads((root / 'unfinished/ownership.json').read_bytes())
                        assert record['state'] == 'reaped' and record['outcome'] == 'abnormal-exit'
                        assert record['exitCode'] != 0 and record['processExitConfirmed'] and record['activeJobProcesses'] == 0
                        assert json.loads((root / 'unfinished/test-summary.json').read_bytes())['status'] == 'failed'
                    else:
                        owner.terminate(); owner.wait(timeout=10)  # Job kill-on-close must reap child
                if child:
                    deadline = time.monotonic() + 10
                    while runner.process_stamp(child['pid']) == child['pidCreated'] and time.monotonic() < deadline:
                        time.sleep(0.05)
                    assert runner.process_stamp(child['pid']) != child['pidCreated']
                gate = root / 'cuda-ownership.json'
                original = gate.read_bytes()
                for field in ['device', 'backend', 'runtimeLock', 'models', 'tool', 'audio']:
                    failed = launch('drift-' + field, 'drift-' + field)
                    assert (failed / 'rejected.json').exists() and not (failed / 'ownership.json').exists()
                    assert gate.read_bytes() == original
                late = launch('late-sentinel', 'late-sentinel')
                assert json.loads((late / 'rejected.json').read_bytes())['code'] == 'cuda_recovery_sentinel_deadline'
                assert gate.exists() and not (late / 'cuda-completion.json').exists()
                for mode, code in [('wrong-backend-completion', 'cuda_completion_invalid'),
                                   ('wrong-attempt-completion', 'cuda_blocker_changed')]:
                    wrong = launch(mode, mode)
                    assert json.loads((wrong / 'rejected.json').read_bytes())['code'] == code
                    assert gate.exists() and not (wrong / 'cuda-completion.json').exists()
                sentinel = launch('sentinel', 'sentinel')
                assert not gate.exists()
                completion = json.loads((sentinel / 'cuda-completion.json').read_bytes())
                assert completion['recoveryOf'] is not None and completion['summary']['testOnly']
                assert json.loads((sentinel / 'ownership.json').read_bytes())['elapsedSeconds'] <= 120
                for file, digest in completion['evidence'].items():
                    assert runner.identity(sentinel / file) == digest
                assert json.loads((sentinel / 'cuda-reconciliation.json').read_bytes())['disposition'] == 'unfinished-unscored'
                rows.append({'backend': backend, 'scenario': scenario, 'identityDriftsRejected': 6,
                             'deadlineMutationRejected': True, 'wrongCompletionsRejected': 2,
                             'hashBoundSentinelCleared': True, 'passed': True})
            finally:
                if owner.poll() is None:
                    owner.terminate(); owner.wait(timeout=10)
    runner.write(out / 'result.json', {'modelRuns': 0, 'cases': rows, 'scope': 'real owned Python fixture processes; no ASR/CUDA arithmetic'})
    print('PASS: both callers, external CLI exit/interrupted owner/live owner; six identity drifts, late sentinel and matching hash-bound recovery')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', nargs=4)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.worker:
        root, backend, scenario, name = args.worker
        raise SystemExit(worker(Path(root), backend, scenario, name))
    check_recovery(args.output.resolve())
