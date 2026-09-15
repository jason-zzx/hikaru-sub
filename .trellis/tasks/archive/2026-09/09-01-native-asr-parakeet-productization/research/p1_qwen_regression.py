"""Serial Qwen short compatibility on the P1 shared candidate, not product acceptance."""
import argparse
import json
import msvcrt
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / 'native-asr/runtime/full-cli'))
from parakeet_smoke import LOCAL, LOCK, identity, inventory, runtime_identity, execute, complete_cuda, verify_loaded_runtime, write, SHORT_SHA
from prepare import verify
from validate import require, validate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['runtime-lock', 'asr', 'aligner', 'audio']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--device', choices=['cpu', 'cuda'], required=True)
    parser.add_argument('--name', required=True)
    args = parser.parse_args()
    require(args.name.isascii() and all(x.isalnum() or x in '-_' for x in args.name), 'run_name')
    out = LOCAL / args.name
    subprocess.run(['git', 'check-ignore', '--quiet', str(out)], cwd=REPO, check=True)
    out.mkdir(exist_ok=False)
    frozen = json.loads(args.runtime_lock.read_bytes())
    require(frozen['devices'][args.device] == runtime_identity(args.device), 'runtime_drift')
    for name, row in frozen['adaptations'].items():
        verify(REPO / 'native-asr/runtime/full-cli' / name, row)
    paths = {'asr': args.asr.resolve(), 'aligner': args.aligner.resolve(),
             'vad': LOCAL / 'acquisition/ggml-silero-v6.2.0.bin'}
    for row in json.loads(LOCK.read_bytes())['models']:
        verify(paths[row['role']], {'sizeBytes': row['publicationSizeBytes'], 'sha256': row['publicationSha256']})
    require(identity(args.audio)['sha256'] == SHORT_SHA, 'short_audio_identity')
    exe = LOCAL / args.device / 'bin/crispasr.exe'
    command = [str(exe), '--backend', 'qwen3', '-m', str(paths['asr']), '-am', str(paths['aligner']),
               '--vad', '-vm', str(paths['vad']), '--strict-pipeline', '--require-vad', '--require-word-timestamps',
               '-l', 'ja', '--split-on-punct', '-ojf', '-of', str(out / 'result'), '-f', os.path.relpath(args.audio, out),
               '--gpu-backend', args.device, '-t', '8', '--cache-dir', str(out / 'cache')]
    if args.device == 'cpu':
        command.append('--no-gpu')
    env = {k: v for k, v in os.environ.items() if k.upper() in ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']}
    env.update(PATH=str(exe.parent) + os.pathsep + str(Path(os.environ['SystemRoot']) / 'System32'), HIKARU_QWEN_DEVICE=args.device)
    with (LOCAL / 'model.lock').open('r+b') as mutex:
        msvcrt.locking(mutex.fileno(), msvcrt.LK_NBLCK, 1)
        try:
            before = inventory(); write(out / 'process-before.json', before)
            require(not before, 'model_process_running')
            inputs = {'runtimeLock': identity(args.runtime_lock), 'tool': identity(Path(__file__)),
                      'models': {r: identity(p) for r, p in paths.items()}, 'audio': identity(args.audio)}
            write(out / 'inputs.json', inputs)
            record, error = execute(command, env, out, args.device, {**inputs, 'backend': 'qwen3'})
            after = inventory(); write(out / 'process-after.json', after)
            summary = {'device': args.device, 'backend': 'qwen3', 'case': 'short-v1', 'status': 'failed',
                       'elapsedSeconds': record['elapsedSeconds'], 'runtimeLock': identity(args.runtime_lock)}
            try:
                require(not error and record.get('exitCode') == 0 and not after and record.get('activeJobProcesses') == 0
                        and record.get('processExitConfirmed'), 'qwen_cli_or_reap_failed')
                summary['validation'] = validate((out / 'result.json').read_bytes(), 385637 * 1000 // 16000,
                                                  (out / 'stderr.log').read_bytes(), args.device)
                verify_loaded_runtime(json.loads((out / 'loaded-module-identities.json').read_bytes()), exe.parent,
                                      frozen['devices'][args.device]['files'])
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
            mutex.seek(0); msvcrt.locking(mutex.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    raise SystemExit(main())
