"""One serial, owned full-CLI file smoke. Private inputs/results stay ignored-local.

Build-time Python tooling only; not a worker, downloader or production dependency.
"""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import msvcrt
import os
from pathlib import Path
import subprocess
import time
import wave

from prepare import REPO, LOCAL
from validate import validate, require


def loaded_modules(process):
    psapi = c.WinDLL('psapi', use_last_error=True)
    psapi.EnumProcessModulesEx.argtypes = [w.HANDLE, c.c_void_p, w.DWORD, c.c_void_p, w.DWORD]
    psapi.GetModuleFileNameExW.argtypes = [w.HANDLE, w.HMODULE, w.LPWSTR, w.DWORD]
    modules = (w.HMODULE * 1024)()
    needed = w.DWORD()
    handle = w.HANDLE(int(process._handle))
    require(psapi.EnumProcessModulesEx(handle, modules, c.sizeof(modules), c.byref(needed), 3), 'module_inventory')
    require(needed.value <= c.sizeof(modules), 'module_inventory_limit')
    paths = []
    for module in modules[:needed.value // c.sizeof(w.HMODULE)]:
        buffer = c.create_unicode_buffer(32768)
        require(psapi.GetModuleFileNameExW(handle, module, buffer, len(buffer)), 'module_path')
        paths.append(buffer.value)
    return paths


def inventory():
    command = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -match "
               "'^(crispasr|hikaru-asr|qwen[-_]).*\\.exe$' } | "
               "Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress")
    raw = subprocess.check_output(['powershell', '-NoProfile', '-NonInteractive', '-Command', command])
    return json.loads(raw.decode('utf-8-sig')) if raw.strip() else []


class Job:
    """Windows kill-on-close job; all CLI descendants share the owned lifetime."""
    def __init__(self):
        self.k = c.WinDLL('kernel32', use_last_error=True)
        self.k.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
        self.k.CreateJobObjectW.restype = w.HANDLE
        self.k.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
        self.k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.k.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
        self.k.QueryInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p]
        self.k.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.k.CreateJobObjectW(None, None)
        if not self.handle:
            raise c.WinError(c.get_last_error())
        # JOBOBJECT_EXTENDED_LIMIT_INFORMATION, Windows x64 layout. LimitFlags at 16.
        require(c.sizeof(c.c_void_p) == 8, 'x64_runner_required')
        info = c.create_string_buffer(144)
        c.c_uint32.from_buffer(info, 16).value = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.k.SetInformationJobObject(self.handle, 9, info, len(info)):
            raise c.WinError(c.get_last_error())

    def attach(self, process):
        if not self.k.AssignProcessToJobObject(self.handle, w.HANDLE(int(process._handle))):
            process.kill()
            process.wait()
            raise c.WinError(c.get_last_error())

    def active(self):
        info = c.create_string_buffer(48)  # JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        if not self.k.QueryInformationJobObject(self.handle, 1, info, len(info), None):
            raise c.WinError(c.get_last_error())
        return c.c_uint32.from_buffer(info, 40).value

    def close(self):
        self.k.TerminateJobObject(self.handle, 43)
        self.k.CloseHandle(self.handle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', choices=['cpu', 'cuda'], required=True)
    parser.add_argument('--case', choices=['short', 'silence', 'missing-vad', 'invalid-vad', 'missing-cuda', 'missing-asr', 'missing-aligner', 'auto-asr', 'auto-aligner', 'auto-vad'], default='short')
    parser.add_argument('--name', required=True)
    parser.add_argument('--cuda-bin', type=Path)
    parser.add_argument('--unicode-paths', action='store_true')
    parser.add_argument('--asr', type=Path)
    parser.add_argument('--aligner', type=Path)
    parser.add_argument('--vad', type=Path)
    parser.add_argument('--audio', type=Path)
    args = parser.parse_args()
    require(args.name.isascii() and all(c.isalnum() or c in '-_' for c in args.name), 'run_name')
    out = LOCAL / args.name
    require(not out.exists(), 'fresh_run_required')
    subprocess.run(['git', 'check-ignore', '--quiet', str(out)], cwd=REPO, check=True)
    out.mkdir()
    if args.unicode_paths:
        out = out / '中文 路径'
        out.mkdir()
    with (LOCAL / 'model.lock').open('a+b') as mutex:
        mutex.seek(0)
        if not mutex.read(1):
            mutex.write(b'0'); mutex.flush()
        mutex.seek(0)
        msvcrt.locking(mutex.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            before = inventory()
            (out / 'process-before.json').write_text(json.dumps(before))
            require(not before, 'task_model_process_already_running')
            supplied = [args.asr, args.aligner, args.vad]
            require(not any(supplied) or all(supplied), 'supply_all_model_roles')
            models = ([{'role': role, 'path': str(path.resolve())}
                       for role, path in zip(['asr', 'aligner', 'vad'], supplied, strict=True)] if all(supplied)
                      else json.loads((LOCAL / 'models-verified.json').read_text()))
            require([row['role'] for row in models] == ['asr', 'aligner', 'vad'], 'role_order')
            paths = {row['role']: row['path'] for row in models}
            require(all(Path(path).is_file() for path in paths.values()), 'missing_model')
            audio_path = args.audio.resolve() if args.audio else Path(json.loads((LOCAL / 'audio-verified.json').read_text())['path'])
            require(audio_path.is_file(), 'missing_audio')
            if args.case == 'silence':
                audio_path = out / 'silence.wav'
                with wave.open(str(audio_path), 'wb') as wav:
                    wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                    wav.writeframes(b'\0' * 32000 * 3)
            with wave.open(str(audio_path)) as wav:
                require((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000), 'audio_shape')
                duration = wav.getnframes() * 1000 // wav.getframerate()
                require(0 < duration <= 30000, 'short_audio_duration')
            if args.unicode_paths:
                for role, path in paths.items():
                    link = out / Path(path).name
                    os.link(path, link)  # same verified bytes, no second weight copy
                    paths[role] = str(link)
                link = out / '短 音频.wav'
                os.link(audio_path, link)
                audio_path = link
            if args.case == 'missing-vad':
                paths['vad'] = str(out / 'missing-silero.bin')
            if args.case == 'invalid-vad':
                bad = out / 'invalid-silero.bin'; bad.write_bytes(b'bad model')
                paths['vad'] = str(bad)
            if args.case in ('missing-asr', 'missing-aligner'):
                role = args.case.removeprefix('missing-')
                paths[role] = str(out / ('missing-' + Path(paths[role]).name))
            if args.case.startswith('auto-'):
                paths[args.case.removeprefix('auto-')] = 'auto'
            exe = LOCAL / args.device / 'bin/crispasr.exe'
            command = [str(exe), '--backend', 'qwen3', '-m', paths['asr'], '-am', paths['aligner'],
                       '--vad', '-vm', paths['vad'], '--strict-pipeline', '--require-vad', '--require-word-timestamps',
                       '-l', 'ja', '--split-on-punct', '-ojf', '-of', str(out / 'result'), '-f', str(audio_path),
                       '--gpu-backend', args.device, '-t', '8', '--cache-dir', str(out / 'cache')]
            if args.device == 'cpu': command.append('--no-gpu')
            env = {k: v for k, v in os.environ.items() if not k.upper().startswith(('CRISP', 'GGML', 'HIKARU', 'CUDA'))}
            env['HIKARU_QWEN_DEVICE'] = args.device
            env['PATH'] = str(exe.parent) + os.pathsep + str(Path(os.environ['SystemRoot']) / 'System32')
            if args.device == 'cuda':
                require(args.cuda_bin is not None and args.cuda_bin.is_dir(), 'cuda_bin')
                env['PATH'] += os.pathsep + str(args.cuda_bin.resolve())
            if args.case == 'missing-cuda':
                require(args.device == 'cuda', 'cuda_negative_device')
                env['CUDA_VISIBLE_DEVICES'] = '-1'
            require(exe.is_file(), 'missing_cli')
            record = {'ownerPid': os.getpid(), 'device': args.device, 'case': args.case,
                      'argv': command, 'state': 'starting'}
            owner = out / 'ownership.json'
            owner.write_text(json.dumps(record, indent=2))
            job = Job()
            process = None
            started = time.monotonic()
            try:
                with (out / 'stderr.log').open('wb') as stderr:
                    process = subprocess.Popen(command, cwd=out, env=env, stdin=subprocess.DEVNULL,
                                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                               creationflags=0x00000004)  # CREATE_SUSPENDED: no child can escape assignment
                    job.attach(process)
                    record.update(pid=process.pid, state='running-in-job')
                    owner.write_text(json.dumps(record, indent=2))
                    ntdll = c.WinDLL('ntdll')
                    ntdll.NtResumeProcess.argtypes = [w.HANDLE]
                    ntdll.NtResumeProcess.restype = c.c_long
                    require(ntdll.NtResumeProcess(w.HANDLE(int(process._handle))) == 0, 'resume_failed')
                    # Drain private diagnostics continuously; genuine role transitions
                    # (not arbitrary stderr activity) trigger loaded-module checkpoints.
                    checkpoints = {}
                    for line in process.stderr:
                        stderr.write(line)
                        stderr.flush()
                        if line.startswith(b'hikaru_graph: role='):
                            role = line.split()[1].split(b'=')[1].decode('ascii')
                            if role not in checkpoints:
                                checkpoints[role] = loaded_modules(process)
                                allowed = [exe.parent.resolve(), Path(os.environ['SystemRoot']).resolve()]
                                if args.device == 'cuda': allowed.append(args.cuda_bin.resolve())
                                for module in checkpoints[role]:
                                    require(any(Path(module).resolve().is_relative_to(root) for root in allowed),
                                            'foreign_runtime_module')
                                (out / 'loaded-modules.json').write_text(json.dumps(checkpoints, indent=2))
                    rc = process.wait()
                require(job.active() == 0, 'child_process_remaining')
                record.update(exitCode=rc, state='reaped', activeJobProcesses=job.active())
            except BaseException:
                record.update(state='terminated-unscored', modelMetricsRetained=False)
                raise
            finally:
                job.close()
                if process is not None: process.wait()
                record['elapsedSeconds'] = round(time.monotonic() - started, 3)
                owner.write_text(json.dumps(record, indent=2))
                (out / 'process-after.json').write_text(json.dumps(inventory()))
            stderr = (out / 'stderr.log').read_bytes()
            require(not any(marker in stderr.lower() for marker in
                            [b'downloading', b'winhttp', b'download now?', b'model_download_forbidden']),
                    'download_entry_reached')
            result = out / 'result.json'
            summary = {'device': args.device, 'case': args.case, 'exitCode': rc, 'processReaped': True}
            if args.case in ('short', 'silence'):
                require(rc == 0, 'cli_failed')
                summary['validation'] = validate(result.read_bytes(), duration, stderr, args.device, args.case == 'silence')
            else:
                require(rc != 0 and not result.exists(), 'negative_did_not_fail_closed')
                expected = (b'cuda_unavailable' if args.case == 'missing-cuda' else
                            b'VAD' if args.case.endswith('vad') else b'explicit_model_unreadable')
                require(expected in stderr, 'negative_error_distinction')
                summary['negativeRejected'] = True
            (out / 'summary.json').write_text(json.dumps(summary, indent=2))
            print(json.dumps(summary))
        finally:
            mutex.seek(0)
            msvcrt.locking(mutex.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    main()
