"""Model-free Windows Job cleanup and retry regression; never loads ASR/CUDA."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import parakeet_smoke as runner


def fixture(root, name, sleep):
    out = root / name
    out.mkdir()
    script = ('import sys,time; print("ready", file=sys.stderr, flush=True); time.sleep(60)'
              if sleep else 'import sys; print("done", file=sys.stderr)')
    command = [sys.executable, '-c', script]
    record, error = runner.execute(command, os.environ.copy(), out, 'cuda')
    runner.write(out / 'result.json', {'record': record, 'error': error})


def running(path):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if path.exists():
            record = json.loads(path.read_bytes())
            if record.get('state') == 'running-in-job':
                return record
        time.sleep(0.05)
    raise AssertionError('fixture did not enter owned Job')


def check(root):
    root.mkdir(parents=True, exist_ok=False)
    for scenario in ('external-exit', 'interrupted-owner'):
        path = root / scenario
        path.mkdir()
        unfinished = path / 'unfinished'
        owner = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--fixture',
                                  str(path), 'unfinished', 'sleep'], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.PIPE)
        child = None
        try:
            child = running(unfinished / 'ownership.json')
            assert runner.process_stamp(child['pid']) == child['pidCreated']
            if scenario == 'external-exit':
                subprocess.run(['taskkill', '/F', '/PID', str(child['pid'])], check=True, timeout=10,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                owner.wait(timeout=10)
                record = json.loads((unfinished / 'result.json').read_bytes())['record']
                assert record['exitCode'] != 0 and record['processExitConfirmed']
                assert record['activeJobProcesses'] == 0
            else:
                owner.terminate()
                owner.wait(timeout=10)  # Job kill-on-close terminates the owned child.
            deadline = time.monotonic() + 10
            while runner.process_stamp(child['pid']) == child['pidCreated'] and time.monotonic() < deadline:
                time.sleep(0.05)
            assert runner.process_stamp(child['pid']) != child['pidCreated']
            # No persistent runtime/harness identity gate after physical cleanup.
            subprocess.run([sys.executable, '-B', str(Path(__file__).resolve()), '--fixture',
                            str(path), 'retry', 'done'], check=True, timeout=20)
            record = json.loads((path / 'retry/result.json').read_bytes())
            assert record['error'] is None and record['record']['exitCode'] == 0
            assert record['record']['processExitConfirmed'] and record['record']['activeJobProcesses'] == 0
        finally:
            if owner.poll() is None:
                owner.terminate(); owner.wait(timeout=10)
    print('PASS: external exit and interrupted owner release task-owned process tree; fresh retry succeeds')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', nargs=3)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.fixture:
        root, name, mode = args.fixture
        fixture(Path(root), name, mode == 'sleep')
    else:
        if args.output is None:
            parser.error('--output is required')
        check(args.output.resolve())
