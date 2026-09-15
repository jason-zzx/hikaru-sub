"""Serial P1 full-CLI proof; no quality scoring or production dependency.

Uses the existing Windows Job/module/mutex helpers, not the unbounded legacy
Qwen stderr loop. Freeze both local runtime closures before the first run.
"""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import msvcrt
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
import wave

from prepare import LOCAL, REPO, LOCK, verify
from smoke import Job, identity, inventory, loaded_modules
from validate import require, validate

RUNTIME_LOCK = LOCAL / 'parakeet-runtime-lock.json'
DLLS = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']
CUDA_DLLS = ['cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll']
SHORT_SHA = '4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211'


def write(path, data):
    # Same-volume atomic, flushed state: an interrupted runner must leave either
    # the old blocker or the complete new one, never a truncated success record.
    temp = path.with_name(path.name + '.tmp')
    with temp.open('w', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def process_stamp(pid):
    """Creation time of a live Windows process; PID reuse is not ownership."""
    kernel = c.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.GetProcessTimes.argtypes = [w.HANDLE] + [c.POINTER(w.FILETIME)] * 4
    kernel.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    kernel.CloseHandle.argtypes = [w.HANDLE]
    handle = kernel.OpenProcess(0x1000 | 0x100000, False, pid)
    if not handle:
        if c.get_last_error() == 87:  # nonexistent PID, not permission failure
            return None
        raise c.WinError(c.get_last_error())
    try:
        state = kernel.WaitForSingleObject(handle, 0)
        require(state in (0, 258), 'owner_wait_failed')
        if state == 0:
            return None
        times = [w.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(c.byref(t) for t in times)):
            raise c.WinError(c.get_last_error())
        return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
    finally:
        kernel.CloseHandle(handle)


def begin_cuda(out, device, binding, command, env):
    """Called only under model.lock, BEFORE even suspended process creation.

    One task-wide blocker covers both callers. An unfinished owner is unscored,
    even if its process physically exited. Never kill a different/live owner.
    """
    for old in ['parakeet-cuda-recovery-required.json', 'qwen-cuda-recovery-required.json']:
        require(not (LOCAL / old).exists(), 'legacy_cuda_recovery_required')
    gate = LOCAL / 'cuda-ownership.json'
    previous = None
    if gate.exists():
        previous = json.loads(gate.read_bytes())
        path = (LOCAL / previous['attempt']).resolve()
        require(path.is_relative_to(LOCAL.resolve()) and path.name == 'cuda-attempt.json', 'recovery_path')
        verify(path, previous['identity'])
        pending = json.loads(path.read_bytes())
        owner = pending['owner']
        require(process_stamp(owner['pid']) != owner['created'], 'cuda_owner_still_live')
        record_path = path.parent / 'ownership.json'
        if record_path.exists():
            record = json.loads(record_path.read_bytes())
            if 'pid' in record:
                live = process_stamp(record['pid'])
                require(live is None or live != record['pidCreated'], 'cuda_process_unreaped')
        require(device == 'cuda' and pending['binding'] == binding, 'cuda_recovery_identity_drift')
        write(out / 'cuda-reconciliation.json', {'unfinished': previous,
              'ownership': identity(record_path) if record_path.exists() else None,
              'ownerExitConfirmed': True, 'disposition': 'unfinished-unscored'})
    if device != 'cuda':
        return None
    require(binding['backend'] in ('parakeet', 'qwen3') and binding['audio']['sha256'] == SHORT_SHA,
            'cuda_short_binding')
    attempt = {'binding': binding, 'owner': {'pid': os.getpid(), 'created': process_stamp(os.getpid())},
               'argv': command, 'environment': env, 'recoveryOf': previous}
    path = out / 'cuda-attempt.json'
    require(not path.exists(), 'cuda_attempt_exists')
    write(path, attempt)
    pointer = {'attempt': path.relative_to(LOCAL).as_posix(), 'identity': identity(path)}
    write(gate, pointer)
    return pointer


def complete_cuda(out, summary):
    """Clear only this hash-bound attempt after output/module AND physical proof."""
    if summary['device'] != 'cuda':
        return
    gate = LOCAL / 'cuda-ownership.json'
    path = out / 'cuda-attempt.json'
    pointer = {'attempt': path.relative_to(LOCAL).as_posix(), 'identity': identity(path)}
    require(json.loads(gate.read_bytes()) == pointer, 'cuda_blocker_changed')
    attempt = json.loads(path.read_bytes())
    record = json.loads((out / 'ownership.json').read_bytes())
    require(summary['status'] == 'passed' and summary['backend'] == attempt['binding']['backend']
            and summary['runtimeLock'] == attempt['binding']['runtimeLock']
            and record['cudaAttempt'] == pointer and record['exitCode'] == 0
            and record['outcome'] == 'exited-zero' and record['processExitConfirmed']
            and record['activeJobProcesses'] == 0, 'cuda_completion_invalid')
    if attempt['recoveryOf'] is not None:
        require(record['elapsedSeconds'] <= 120, 'cuda_recovery_sentinel_deadline')
    # Publish the proof before unlink, so interruption never removes the only
    # evidence of a verified sentinel. A crash before unlink stays conservative.
    write(out / 'cuda-completion.json', {'attempt': pointer, 'recoveryOf': attempt['recoveryOf'],
          'summary': summary, 'evidence': {p.name: identity(p) for p in sorted(out.iterdir()) if p.is_file()}})
    require(json.loads(gate.read_bytes()) == pointer, 'cuda_blocker_changed')
    gate.unlink()


def runtime_identity(device):
    root = LOCAL / device / 'bin'
    names = ['crispasr.exe'] + DLLS + (CUDA_DLLS if device == 'cuda' else [])
    require(sorted(p.name for p in root.glob('*.dll')) == sorted(names[1:]), 'runtime_closure')
    return {'files': {name: identity(root / name) for name in names},
            'cmakeCache': identity(LOCAL / device / 'CMakeCache.txt')}


def verify_loaded_runtime(modules, root, files):
    # Windows loader spelling is case-insensitive (e.g. VCOMP140.DLL). Compare
    # canonical Windows paths, not strings, while retaining exact byte hashes.
    canonical = {Path(path).resolve(): row for path, row in modules.items()}
    for name, row in files.items():
        require(canonical.get((root / name).resolve()) == row, 'runtime_module_missing_or_drift')


class Progress:
    """Only first monotonic stages and strictly advancing completed slices count."""
    def __init__(self):
        self.stage = 0
        self.slice = 0
        self.total = None

    def advance(self, line):
        stage = (1 if re.fullmatch(rb'hikaru_stage: parakeet_model_loaded\r?\n', line) else
                 2 if re.fullmatch(rb'hikaru_vad: device=cpu chunks=[1-9][0-9]* completed=1\r?\n', line) else
                 3 if line.startswith(b'hikaru_graph: role=') else 0)
        # First graph means compute started, not every token/graph is progress.
        if stage > self.stage:
            self.stage = stage
            return True
        match = re.fullmatch(rb'hikaru_slice: completed=(\d+) total=(\d+)\r?\n', line)
        if match:
            done, total = map(int, match.groups())
            require(0 < done <= total and (self.total is None or self.total == total), 'slice_progress_invalid')
            self.total = total
            if done > self.slice:
                self.slice = done
                return True
        return False


def execute(command, env, out, device, binding):
    """Suspend→assign Job→resume; bounded diagnostics and real no-progress deadline."""
    attempt = begin_cuda(out, device, binding, command, env)
    job, process = Job(), None
    record = {'argv': command, 'environment': env, 'state': 'starting', 'ownerPid': os.getpid(),
              'cudaAttempt': attempt, 'outcome': 'unfinished'}
    write(out / 'ownership.json', record)
    checkpoints, failure = {}, None
    started = time.monotonic()
    try:
        process = subprocess.Popen(command, cwd=out, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=4)
        record.update(pid=process.pid, pidCreated=process_stamp(process.pid))
        write(out / 'ownership.json', record)
        job.attach(process)
        record.update(state='running-in-job')
        write(out / 'ownership.json', record)
        ntdll = c.WinDLL('ntdll')
        ntdll.NtResumeProcess.argtypes = [w.HANDLE]
        ntdll.NtResumeProcess.restype = c.c_long
        require(ntdll.NtResumeProcess(w.HANDLE(int(process._handle))) == 0, 'resume_failed')
        lines = queue.Queue(maxsize=4096)
        stop = threading.Event()
        def drain():
            while not stop.is_set():
                line = process.stderr.readline(16385)
                while not stop.is_set():
                    try:
                        lines.put(line, timeout=0.2)
                        break
                    except queue.Full:
                        continue
                if not line:
                    return
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        progress = Progress()
        last_progress = time.monotonic()
        count = 0
        with (out / 'stderr.log').open('xb') as log:
            while True:
                require(time.monotonic() - last_progress < 120, 'no_forward_progress_120s')
                try:
                    line = lines.get(timeout=0.2)
                except queue.Empty:
                    continue
                if not line:
                    break
                count += len(line)
                require(len(line) <= 16384 and count <= 64 * 1024 * 1024, 'diagnostic_limit')
                log.write(line)
                log.flush()
                if progress.advance(line):
                    last_progress = time.monotonic()
                match = re.match(rb'hikaru_graph: role=(\S+)', line)
                if match and match[1].decode() not in checkpoints:
                    # Short graph calls may finish quickly; inventory while the
                    # process is live, never infer device proof from DLL names.
                    paths = loaded_modules(process)
                    root = (LOCAL / device / 'bin').resolve()
                    system = Path(os.environ['SystemRoot']).resolve()
                    require(all(Path(p).resolve().is_relative_to(root) or Path(p).resolve().is_relative_to(system)
                                for p in paths), 'foreign_runtime_module')
                    checkpoints[match[1].decode()] = paths
        remaining = max(0.01, 120 - (time.monotonic() - last_progress))
        record['exitCode'] = process.wait(timeout=remaining)
        require(job.active() == 0, 'child_process_remaining')
        record['state'] = 'reaped'  # physical state, not a success classification
        record['outcome'] = 'exited-zero' if record['exitCode'] == 0 else 'abnormal-exit'
        if record['exitCode'] != 0:
            failure = 'cli_nonzero_exit'
            record['failure'] = failure
    except BaseException as exc:
        failure = type(exc).__name__ + (':' + str(exc) if isinstance(exc, ValueError) else '')
        record.update(state='terminated-unscored', outcome='interrupted', failure=failure)
    finally:
        try:
            if process is not None:
                job.k.TerminateJobObject(job.handle, 43)
                if process.poll() is None:
                    process.kill()  # also cover failure before suspended Job assignment
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    failure = 'process_exit_unconfirmed'
                    record.update(state='terminated-unscored', failure=failure)
                if 'stop' in locals():
                    stop.set()
                    reader.join(timeout=1)
                record['activeJobProcesses'] = job.active()
                record['processExitConfirmed'] = process.poll() is not None
        except OSError:
            failure = 'process_cleanup_unconfirmed'
            record.update(state='terminated-unscored', failure=failure, processExitConfirmed=False)
        finally:
            job.close()  # kill-on-close still applies if explicit reap/query raises
        record['elapsedSeconds'] = round(time.monotonic() - started, 3)
        write(out / 'ownership.json', record)
        write(out / 'loaded-modules.json', checkpoints)
        paths = sorted({p for values in checkpoints.values() for p in values})
        write(out / 'loaded-module-identities.json', {p: identity(Path(p)) for p in paths})
    return record, failure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze-runtime', action='store_true')
    parser.add_argument('--runtime-lock', type=Path, default=RUNTIME_LOCK)
    parser.add_argument('--device', choices=['cpu', 'cuda'])
    parser.add_argument('--name')
    parser.add_argument('--acquisition-lock', type=Path, required=True)
    parser.add_argument('--audio', type=Path)
    args = parser.parse_args()
    runtime_lock = args.runtime_lock.resolve()
    require(runtime_lock.is_relative_to(LOCAL.resolve()), 'runtime_lock_outside_scratch')
    lock = json.loads(args.acquisition_lock.read_bytes())
    require(lock['model']['logicalModel'] == 'nvidia/parakeet-tdt_ctc-0.6b-ja', 'logical_model')
    if args.freeze_runtime:
        source = LOCAL / 'source-parakeet-p1'
        sources = {p.relative_to(source).as_posix(): identity(p) for p in sorted(source.rglob('*')) if p.is_file()}
        write(LOCAL / 'parakeet-source-files.json', sources)
        for name, target in [('hikaru_qwen_device.h', 'src/core/hikaru_qwen_device.h'),
                             ('hikaru_cuda_probe.h', 'examples/cli/hikaru_cuda_probe.h')]:
            require(identity(Path(__file__).parent / name) == sources[target], 'source_header_drift')
        value = {'sourceLock': identity(LOCK), 'acquisitionLock': identity(args.acquisition_lock),
                 'preparedSources': identity(LOCAL / 'parakeet-source-files.json'),
                 'devices': {d: runtime_identity(d) for d in ['cpu', 'cuda']},
                 'adaptations': {p.name: identity(p) for p in sorted(Path(__file__).parent.iterdir())
                                 if p.suffix in ['.py', '.h', '.cmd', '.cmake', '.cpp']}}
        require(not runtime_lock.exists(), 'runtime_lock_already_exists')
        write(runtime_lock, value)
        print('PASS: local runtime identity frozen; no product/publication authority')
        return
    require(args.device and args.name and args.audio, 'run_inputs')
    require(args.name.isascii() and all(x.isalnum() or x in '-_' for x in args.name), 'run_name')
    out = LOCAL / args.name
    subprocess.run(['git', 'check-ignore', '--quiet', str(out)], cwd=REPO, check=True)
    out.mkdir(exist_ok=False)
    frozen = json.loads(runtime_lock.read_bytes())
    require(frozen['acquisitionLock'] == identity(args.acquisition_lock), 'acquisition_lock_drift')
    require(frozen['preparedSources'] == identity(LOCAL / 'parakeet-source-files.json'), 'source_manifest_drift')
    require(frozen['devices'][args.device] == runtime_identity(args.device), 'runtime_drift')
    for name, row in frozen['adaptations'].items():
        verify(Path(__file__).parent / name, row)
    inputs = {role: LOCAL / 'acquisition' / lock[role]['file'] for role in ['model', 'vad']}
    for role, path in inputs.items():
        verify(path, lock[role])
    audio = args.audio.resolve()
    require(identity(audio)['sha256'] == SHORT_SHA, 'short_audio_identity')
    with wave.open(str(audio)) as wav:
        require((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()) == (1, 2, 16000, 385637), 'audio_shape')
        duration = wav.getnframes() * 1000 // wav.getframerate()
    exe = (LOCAL / args.device / 'bin/crispasr.exe').resolve()
    command = [str(exe), '--backend', 'parakeet', '-m', str(inputs['model'].resolve()), '--vad',
               '-vm', str(inputs['vad'].resolve()), '--strict-pipeline', '--require-vad', '--require-word-timestamps',
               '-l', 'ja', '--split-on-punct', '-ojf', '-of', str((out / 'result').resolve()), '-f', os.path.relpath(audio, out),
               '--gpu-backend', args.device, '-t', '8', '--cache-dir', str((out / 'cache').resolve())]
    if args.device == 'cpu':
        command.append('--no-gpu')
    env = {k: v for k, v in os.environ.items() if k.upper() in ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']}
    env.update(PATH=str(exe.parent) + os.pathsep + str(Path(os.environ['SystemRoot']) / 'System32'),
               HIKARU_PARAKEET_DEVICE=args.device)
    with (LOCAL / 'model.lock').open('a+b') as mutex:
        if mutex.tell() == 0:
            mutex.write(b'0'); mutex.flush()
        mutex.seek(0)
        msvcrt.locking(mutex.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            before = inventory()
            write(out / 'process-before.json', before)
            require(not before, 'model_process_already_running')
            input_record = {'runtimeLock': identity(runtime_lock), 'acquisitionLock': identity(args.acquisition_lock),
                            'audio': identity(audio), 'models': {r: identity(p) for r, p in inputs.items()}}
            write(out / 'inputs.json', input_record)
            binding = {**input_record, 'backend': 'parakeet', 'tool': identity(Path(__file__))}
            record, error = execute(command, env, out, args.device, binding)
            after = inventory()
            write(out / 'process-after.json', after)
            summary = {'device': args.device, 'backend': 'parakeet', 'case': 'short-v1', 'status': 'failed',
                       'runtimeLock': identity(runtime_lock), 'inputs': identity(out / 'inputs.json'),
                       'ownership': identity(out / 'ownership.json'), 'elapsedSeconds': record['elapsedSeconds']}
            try:
                require(not error and record.get('exitCode') == 0, 'cli_failed')
                require(not after and record.get('activeJobProcesses') == 0 and record.get('processExitConfirmed'), 'reap_failed')
                raw = (out / 'result.json').read_bytes()
                stderr = (out / 'stderr.log').read_bytes()
                summary['validation'] = validate(raw, duration, stderr, args.device, backend='parakeet')
                modules = json.loads((out / 'loaded-module-identities.json').read_bytes())
                verify_loaded_runtime(modules, exe.parent, frozen['devices'][args.device]['files'])
                summary['status'] = 'passed'
                complete_cuda(out, summary)
            except (ValueError, KeyError, TypeError, OSError) as exc:
                summary['status'] = 'failed'
                summary['error'] = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
            summary['rawEvidence'] = {p.name: identity(p) for p in sorted(out.iterdir()) if p.is_file()}
            write(out / 'summary.json', summary)
            print(json.dumps(summary))
            return 0 if summary['status'] == 'passed' else 1
        finally:
            mutex.seek(0)
            msvcrt.locking(mutex.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    raise SystemExit(main())
