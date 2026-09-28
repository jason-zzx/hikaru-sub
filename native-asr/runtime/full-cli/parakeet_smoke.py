"""Serial local full-CLI smoke; no quality scoring or production dependency.

Uses the existing Windows Job/module/mutex helpers and a bounded progress loop.
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

from prepare import LOCAL, REPO
from smoke import Job, inventory, loaded_modules
from validate import require, validate

DLLS = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']
CUDA_DLLS = ['cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll']


def write(path, data):
    # Fixture and diagnostics readers may observe this file while the worker runs.
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
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


def verify_loaded_runtime(modules, root, files):
    # Windows loader spelling is case-insensitive (e.g. VCOMP140.DLL).
    canonical = {os.path.normcase(str(Path(path).resolve())) for path in modules}
    for name in files:
        require(os.path.normcase(str((root / name).resolve())) in canonical, 'runtime_module_missing')


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


def execute(command, env, out, device):
    """Suspend→assign Job→resume; bounded diagnostics and real no-progress deadline."""
    job, process = Job(), None
    record = {'argv': command, 'state': 'starting', 'ownerPid': os.getpid(),
              'outcome': 'unfinished'}
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
    return record, failure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', choices=['cpu', 'cuda'], required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--vad', type=Path, required=True)
    parser.add_argument('--audio', type=Path, required=True)
    args = parser.parse_args()
    require(args.name.isascii() and all(x.isalnum() or x in '-_' for x in args.name), 'run_name')
    out = LOCAL / args.name
    subprocess.run(['git', 'check-ignore', '--quiet', str(out)], cwd=REPO, check=True)
    out.mkdir(exist_ok=False)
    inputs = {'model': args.model.resolve(), 'vad': args.vad.resolve()}
    audio = args.audio.resolve()
    exe = (LOCAL / args.device / 'bin/crispasr.exe').resolve()
    root = exe.parent
    names = ['crispasr.exe'] + DLLS + (CUDA_DLLS if args.device == 'cuda' else [])
    require(exe.is_file() and all(path.is_file() for path in inputs.values()), 'missing_model_or_cli')
    require(sorted(p.name.lower() for p in root.glob('*.dll')) == sorted(n.lower() for n in names[1:]), 'runtime_closure')
    with wave.open(str(audio)) as wav:
        require((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000), 'audio_shape')
        duration = wav.getnframes() * 1000 // wav.getframerate()
        require(0 < duration <= 30000, 'short_audio_duration')
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
            record, error = execute(command, env, out, args.device)
            after = inventory()
            write(out / 'process-after.json', after)
            summary = {'device': args.device, 'backend': 'parakeet', 'case': 'short', 'status': 'failed',
                       'elapsedSeconds': record['elapsedSeconds']}
            try:
                require(not error and record.get('exitCode') == 0, 'cli_failed')
                require(not after and record.get('activeJobProcesses') == 0 and record.get('processExitConfirmed'), 'reap_failed')
                raw = (out / 'result.json').read_bytes()
                stderr = (out / 'stderr.log').read_bytes()
                summary['validation'] = validate(raw, duration, stderr, args.device, backend='parakeet')
                modules = {p for paths in json.loads((out / 'loaded-modules.json').read_bytes()).values() for p in paths}
                verify_loaded_runtime(modules, root, names)
                summary['status'] = 'passed'
            except (ValueError, KeyError, TypeError, OSError) as exc:
                summary['status'] = 'failed'
                summary['error'] = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
            write(out / 'summary.json', summary)
            print(json.dumps(summary))
            return 0 if summary['status'] == 'passed' else 1
        finally:
            mutex.seek(0)
            msvcrt.locking(mutex.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    raise SystemExit(main())
