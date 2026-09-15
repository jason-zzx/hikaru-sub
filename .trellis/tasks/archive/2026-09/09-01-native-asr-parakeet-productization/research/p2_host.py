"""P2 serial owned host proof. Reuses P1 mutex, Job, watchdog and durable CUDA gate.

No product switch: runs one existing Rust test executable with private inputs.
A CUDA cancellation leaves the same task gate pending for a separate, identical
short invocation; process reap never clears it. Raw evidence stays ignored-local.
"""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import msvcrt
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'native-asr/runtime/full-cli'))
from parakeet_smoke import (LOCAL, DLLS, CUDA_DLLS, SHORT_SHA, execute, complete_cuda,
                           inventory, identity, write, verify_loaded_runtime, process_stamp)
from prepare import verify
from smoke import loaded_modules
from validate import require

P1 = LOCAL / 'parakeet-runtime-lock-r4.json'
ACQUISITION = Path(__file__).with_name('p1-acquisition-lock.json')
TEST = 'asr_worker::tests::parakeet_cli_real_host_case'


def processes():
    # One native snapshot, no repeated PowerShell process or broad taskkill.
    class Entry(c.Structure):
        _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('pid', w.DWORD),
                    ('heap', c.c_size_t), ('module', w.DWORD), ('threads', w.DWORD),
                    ('parent', w.DWORD), ('priority', w.LONG), ('flags', w.DWORD),
                    ('name', w.WCHAR * 260)]
    k = c.WinDLL('kernel32', use_last_error=True)
    k.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
    k.CreateToolhelp32Snapshot.restype = w.HANDLE
    k.Process32FirstW.argtypes = k.Process32NextW.argtypes = [w.HANDLE, c.POINTER(Entry)]
    k.CloseHandle.argtypes = [w.HANDLE]
    handle = k.CreateToolhelp32Snapshot(2, 0)
    require(handle != c.c_void_p(-1).value, 'process_snapshot')
    try:
        entry = Entry(); entry.size = c.sizeof(entry)
        result = {}
        ok = k.Process32FirstW(handle, c.byref(entry))
        while ok:
            result[entry.pid] = (entry.parent, entry.name)
            ok = k.Process32NextW(handle, c.byref(entry))
        require(c.get_last_error() == 18, 'process_snapshot_end')
        return result
    finally:
        k.CloseHandle(handle)


@contextmanager
def opened_process(pid):
    k = c.WinDLL('kernel32', use_last_error=True)
    k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]; k.OpenProcess.restype = w.HANDLE
    k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    k.GetProcessTimes.argtypes = [w.HANDLE] + [c.POINTER(w.FILETIME)] * 4
    k.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)]
    k.CloseHandle.argtypes = [w.HANDLE]
    handle = k.OpenProcess(0x410 | 0x100000, False, pid)
    if not handle:
        require(c.get_last_error() == 87, 'process_open')
        yield None
        return
    try:
        if k.WaitForSingleObject(handle, 0) == 0:
            yield None
            return
        times = [w.FILETIME() for _ in range(4)]
        require(k.GetProcessTimes(handle, *(c.byref(t) for t in times)), 'process_times')
        image, size = c.create_unicode_buffer(32768), w.DWORD(32768)
        require(k.QueryFullProcessImageNameW(handle, 0, image, c.byref(size)), 'process_image')
        ntdll = c.WinDLL('ntdll')
        ntdll.NtQueryInformationProcess.argtypes = [w.HANDLE, w.ULONG, c.c_void_p, w.ULONG, c.c_void_p]
        info = (c.c_size_t * 6)()  # x64 PROCESS_BASIC_INFORMATION
        require(ntdll.NtQueryInformationProcess(handle, 0, info, c.sizeof(info), None) == 0, 'process_parent')
        require(info[4] == pid, 'process_pid')
        yield {'pid': pid, 'created': (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime,
               'parent': info[5], 'path': Path(image.value).resolve(), 'handle': handle, 'kernel': k}
    finally:
        k.CloseHandle(handle)


def bound_child(child, parent, path):
    return child is not None and child['parent'] == parent['pid'] and child['created'] >= parent['created'] and child['path'] == path.resolve()


def observe(host_path, worker_path, stop, captured, errors, observed):
    runtime = worker_path.parent.resolve()
    cli_path = runtime / 'crispasr.exe'
    owner = {'pid': os.getpid(), 'created': process_stamp(os.getpid())}
    initialized = set()
    starting = {}
    while not stop.wait(0.01):
        try:
            require(process_stamp(owner['pid']) == owner['created'], 'observer_owner_identity')
            table = processes()
            for host_pid, (parent, name) in table.items():
                if parent != owner['pid'] or name.lower() != host_path.name.lower(): continue
                with opened_process(host_pid) as host:
                    if not bound_child(host, owner, host_path): continue
                    for worker_pid, (parent, name) in table.items():
                        if parent != host_pid or name.lower() != worker_path.name.lower(): continue
                        with opened_process(worker_pid) as worker:
                            if not bound_child(worker, host, worker_path): continue
                            for pid, (parent, name) in table.items():
                                if parent != worker_pid or name.lower() != cli_path.name.lower(): continue
                                with opened_process(pid) as cli:
                                    if not bound_child(cli, worker, cli_path): continue
                                    key = (pid, cli['created'])
                                    starting.setdefault(key, time.monotonic())
                                    try: paths = loaded_modules(SimpleNamespace(_handle=cli['handle']))
                                    except (ValueError, OSError):
                                        error = c.get_last_error()
                                        if cli['kernel'].WaitForSingleObject(cli['handle'], 0) == 0: continue
                                        # ERROR_PARTIAL_COPY is permitted only for
                                        # this still-starting process before any
                                        # successful module sample, <=120 seconds.
                                        if error == 299 and key not in initialized and time.monotonic() - starting[key] < 120: continue
                                        raise
                                    if not paths and key not in initialized and time.monotonic() - starting[key] < 120: continue
                                    require(paths, 'empty_live_modules')
                                    system = Path(os.environ['SystemRoot']).resolve()
                                    require(all(Path(p).resolve().is_relative_to(runtime) or Path(p).resolve().is_relative_to(system)
                                                for p in paths), 'foreign_cli_module')
                                    initialized.add(key)
                                    observed[str(key)] = {role: {k: str(v) if isinstance(v, Path) else v
                                                               for k, v in process.items() if k not in ['handle', 'kernel']}
                                                         for role, process in [('host', host), ('worker', worker), ('cli', cli)]}
                                    captured.update(paths)
        except BaseException as exc:
            errors.append(type(exc).__name__ + (':' + str(exc) if isinstance(exc, ValueError) else ''))
            return


def locked(path):
    return {'path': str(path.resolve()), **identity(path)}


def freeze(path, test_exe):
    require(not path.exists(), 'lock_exists')
    p1 = json.loads(P1.read_bytes())
    for name, row in p1['adaptations'].items(): verify(REPO / 'native-asr/runtime/full-cli' / name, row)
    roots = {}
    for device in ['cpu', 'cuda']:
        root = LOCAL / ('p2-runtime-' + device)
        root.mkdir(exist_ok=True)
        for name, row in p1['devices'][device]['files'].items():
            source = LOCAL / device / 'bin' / name
            verify(source, row)
            if (root / name).exists(): verify(root / name, row)
            else: shutil.copyfile(source, root / name)
        worker = LOCAL / ('p2-worker-' + device) / 'bin/hikaru-asr-qwen-cli-worker.exe'
        if (root / 'hikaru-asr-worker.exe').exists(): verify(root / 'hikaru-asr-worker.exe', identity(worker))
        else: shutil.copyfile(worker, root / 'hikaru-asr-worker.exe')
        roots[device] = {p.name: identity(p) for p in sorted(root.iterdir())}
    tools = LOCAL / 'p2-tools'; tools.mkdir(exist_ok=True)
    host = tools / (path.stem + '-host-tests.exe')
    if host.exists(): verify(host, identity(test_exe))
    else: shutil.copyfile(test_exe, host)
    sources = ['native-asr/src/full_cli.cpp', 'native-asr/src/full_cli.hpp', 'native-asr/src/parakeet_cli.cpp',
               'native-asr/src/qwen_cli.cpp', 'native-asr/src/qwen_cli.hpp', 'native-asr/src/main.cpp',
               'native-asr/src/protocol.cpp', 'src-tauri/src/asr_worker.rs', 'src-tauri/src/asr_worker_job.rs',
               'src-tauri/src/asr_worker_parakeet_tests.rs', 'src-tauri/src/asr_worker_parakeet_real_tests.rs',
               'src-tauri/src/asr_worker_qwen_tests.rs', 'src-tauri/src/asr_models.rs',
               'src-tauri/src/asr.rs', 'src-tauri/resources/native-asr-models.json']
    write(path, {'schemaVersion': 1, 'p1Lock': identity(P1), 'acquisitionLock': identity(ACQUISITION),
                 'harness': identity(Path(__file__)), 'host': locked(host), 'devices': roots,
                 'sources': {name: identity(REPO / name) for name in sources}})


def run(args):
    lock = args.lock.resolve()
    frozen = json.loads(lock.read_bytes())
    verify(P1, frozen['p1Lock']); verify(ACQUISITION, frozen['acquisitionLock'])
    verify(Path(__file__), frozen['harness'])
    for name, row in frozen['sources'].items(): verify(REPO / name, row)
    host = Path(frozen['host']['path']); verify(host, frozen['host'])
    runtime = (LOCAL / ('p2-runtime-' + args.device)).resolve()
    require(sorted(p.name for p in runtime.iterdir()) == sorted(frozen['devices'][args.device]), 'closure')
    for name, row in frozen['devices'][args.device].items(): verify(runtime / name, row)
    acquisition = json.loads(ACQUISITION.read_bytes())
    paths = {'model': LOCAL / 'acquisition/parakeet-tdt-0.6b-ja.gguf',
             'vad': LOCAL / 'acquisition/ggml-silero-v6.2.0.bin'}
    if args.engine == 'qwen3-asr':
        previous = json.loads((LOCAL / 'qwen-cpu-short-parakeet-p1-r4/ownership.json').read_bytes())['argv']
        paths['model'] = Path(previous[previous.index('-m') + 1])
        paths['aligner'] = Path(previous[previous.index('-am') + 1])
    else: verify(paths['model'], acquisition['model'])
    verify(paths['vad'], acquisition['vad'])
    sentinel = REPO / '.asr-benchmark/short.wav'
    require(identity(sentinel)['sha256'] == SHORT_SHA, 'short_audio')
    audio = REPO / ('.asr-benchmark/' + (args.case if args.case in ['medium', 'long'] else 'short') + '.wav')
    expected_audio = {'medium': '6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458',
                      'long': 'af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e'}
    require(identity(audio)['sha256'] == expected_audio.get(args.case, SHORT_SHA), 'audio_identity')
    out = LOCAL / args.name
    require(out.resolve().parent == LOCAL.resolve(), 'run_path')
    out.mkdir(exist_ok=False)
    inputs = {'schema': 'parakeet-p2-full-cli-host-v1', 'engine': args.engine, 'device': args.device,
              'case': args.case, 'worker': locked(runtime / 'hikaru-asr-worker.exe'),
              'runtime': [locked(runtime / name) for name in frozen['devices'][args.device] if name != 'hikaru-asr-worker.exe'],
              'model': locked(paths['model']), 'vad': locked(paths['vad']), 'audio': locked(audio),
              'aligner': locked(paths['aligner']) if 'aligner' in paths else None,
              'evidenceDir': str(out / 'host')}
    write(out / 'inputs.json', inputs)
    env = {k: v for k, v in os.environ.items() if k.upper() in ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']}
    env.update(PATH=str(Path(os.environ['SystemRoot']) / 'System32'),
               HIKARU_ASR_PARAKEET_CLI_HOST_INPUTS=str(out / 'inputs.json'), HIKARU_ASR_PARAKEET_CLI_HOST_REQUIRED='1')
    command = [str(host), '--exact', TEST, '--test-threads=1', '--nocapture']
    binding = {'backend': 'parakeet' if args.engine == 'parakeet' else 'qwen3',
               'runtimeLock': identity(lock), 'tool': identity(Path(__file__)), 'host': identity(host),
               'worker': inputs['worker'], 'models': {r: identity(p) for r, p in paths.items()},
               'audio': identity(sentinel)}  # fixed short recovery input; actual input is separately locked above
    with (LOCAL / 'model.lock').open('r+b') as mutex:
        msvcrt.locking(mutex.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            before = inventory(); write(out / 'process-before.json', before)
            require(not before, 'model_process_running')
            # Any unfinished attempt must recover with this unchanged short
            # binding, never a medium/long/negative case disguised as a sentinel.
            require(args.case == 'short' or not (LOCAL / 'cuda-ownership.json').exists(), 'short_recovery_required')
            # Optional historical observer is deliberately not invoked. The
            # hash-pinned worker enforces runtime/device/output checks itself.
            record, failure = execute(command, env, out, args.device, binding)
            after = inventory(); write(out / 'process-after.json', after)
            require(not failure and not after, 'host_execution_failed')
            require(record.get('processExitConfirmed') and record.get('activeJobProcesses') == 0, 'host_not_reaped')
            proof = json.loads((out / 'host/summary.json').read_bytes())
            require(proof['status'] == ('cancelled' if args.case == 'cancel' else 'failed' if args.case.startswith('invalid-') else 'completed'), 'host_status')
            summary = {'device': args.device, 'backend': binding['backend'], 'case': args.case,
                       'runtimeLock': identity(lock), 'status': 'unscored-cancelled' if args.case == 'cancel' else 'passed',
                       'host': proof, 'runtimeIntegrityVerified': True, 'optionalObserver': 'not-run',
                       'workerEnforcesActualGraphDispatch': args.case in ['short', 'medium', 'long']}
            write(out / 'summary.json', summary)
            if args.case in ['short', 'medium', 'long']: complete_cuda(out, summary)
            print(json.dumps(summary, ensure_ascii=False))
        finally: msvcrt.locking(mutex.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lock', type=Path, required=True)
    parser.add_argument('--freeze', type=Path, metavar='HOST_TEST_EXE')
    parser.add_argument('--device', choices=['cpu', 'cuda'])
    parser.add_argument('--engine', choices=['parakeet', 'qwen3-asr'], default='parakeet')
    parser.add_argument('--case', choices=['short', 'medium', 'long', 'silence', 'cancel', 'invalid-vad', 'invalid-model', 'invalid-audio'], default='short')
    parser.add_argument('--name')
    args = parser.parse_args()
    require(args.lock.resolve().parent == LOCAL.resolve(), 'lock_path')
    if args.freeze: freeze(args.lock, args.freeze)
    else:
        require(args.name and args.name.isascii() and all(c.isalnum() or c in '-_' for c in args.name), 'run_name')
        require(args.device is not None, 'device_required')
        run(args)
