"""Model-free shared runner: deep private paths, real audio/result I/O and cleanup."""
import json
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import wave

worker = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='hikaru-cli-path-') as temp:
    # Match native_job_id(): native-PID-nanoseconds-counter. Do not lengthen
    # IDs to disguise the separate upstream long-audio-path limitation.
    job_id = 'native-12345-1788278400000000000-0'
    for length in (200, 272):
        for engine in ('qwen3-asr', 'parakeet', 'reazonspeech-nemo'):
            for device in ('cpu', 'cuda'):
                # Rust canonical paths have the extended spelling. Count ordinary
                # private-cwd characters separately from that four-character prefix.
                tag = {'qwen3-asr': 'q', 'parakeet': 'p', 'reazonspeech-nemo': 'r'}[engine]
                root = Path(temp) / f'{length}-{tag}-{device}' / '日本 音声'
                suffix = Path('asr-jobs') / (job_id + '-cli')
                while len(str(root / suffix)) < length:
                    remaining = length - len(str(root / suffix)) - 1
                    root /= 'x' * min(60, remaining)
                assert len(str(root / suffix)) == length
                assert len(str(root / '別の 音声.wav')) < 260
                root = Path('\\\\?\\' + str(root))
                root.mkdir(parents=True)
                audio = root / '別の 音声.wav'
                with wave.open(str(audio), 'wb') as out:
                    out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                    out.writeframes(b'\0' * 96000)
                models = []
                for role in (('model', 'aligner', 'vad') if engine == 'qwen3-asr' else ('model', 'vad')):
                    path = root / (role + '.bin')
                    path.write_text('cwd-no-dll', encoding='utf8')
                    models.append({'role': role, 'path': str(path)})
                work = root / suffix
                work.mkdir(parents=True)
                # Portable topology: runtime and cache share the extracted app
                # ancestor, unlike a repo worker reading an unrelated temp tree.
                runtime = root.parent / 'runtime'
                runtime.mkdir()
                local_worker = runtime / worker.name
                shutil.copyfile(worker, local_worker)
                shutil.copyfile(worker.parent / 'crispasr.exe', runtime / 'crispasr.exe')
                marker = worker.parent.parent / 'bin' / 'hikaru-asr-fake-crispasr-cuda-marker.dll'
                # Plant in all possible launch ancestors inside this isolated tree.
                # The actual child must not load it via ambient cwd search.
                at = work.parent
                while len(str(at)) > len(temp) + 4:
                    shutil.copyfile(marker, at / marker.name)
                    at = at.parent
                request = dict(protocolVersion=1, jobId=job_id, engine=engine, backend='crispasr',
                               modelPaths=models, audioPath=str(audio), device=device, language='ja', useVad=True)
                run = subprocess.run([str(local_worker)], input=(json.dumps(request) + '\n').encode(),
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
                events = [json.loads(line) for line in run.stdout.splitlines()]
                assert run.returncode == 0 and not run.stderr, (length, engine, device, events)
                assert [e['event'] for e in events] == ['ready', 'segmentsReplace', 'completed'], events
                assert events[0]['durationMs'] == 3000 and len(events[1]['segments']) == 1
                result = work / 'result.json'
                assert json.loads(result.read_bytes())['crispasr']['backend'] == ('qwen3' if engine == 'qwen3-asr' else 'parakeet')
                # Standalone worker leaves deletion to its host. Prove child I/O
                # handles have closed and the original result is removable.
                result.unlink()
                work.rmdir()
                assert not work.exists() and audio.is_file()
                print(f'PASS cwd={length} {engine}/{device}: audio read, result consumed, cleanup, no ancestor DLL')
                assert sorted(p.name for p in runtime.iterdir()) == sorted([worker.name, 'crispasr.exe'])
                if length == 272 and device == 'cpu':
                    # A too-long own-root is not rescued by another writable cwd.
                    deep_runtime = runtime / ('d' * 70) / ('e' * 70)
                    deep_runtime.mkdir(parents=True)
                    shutil.copyfile(worker, deep_runtime / worker.name)
                    shutil.copyfile(worker.parent / 'crispasr.exe', deep_runtime / 'crispasr.exe')
                    work.mkdir()
                    run = subprocess.run([str(deep_runtime / worker.name)], executable=str(deep_runtime / worker.name), input=(json.dumps(request) + '\n').encode(),
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
                    events = [json.loads(line) for line in run.stdout.splitlines()]
                    assert run.returncode == 20 and not run.stderr and len(events) == 1, events
                    prefix = {'qwen3-asr': 'qwen', 'parakeet': 'parakeet', 'reazonspeech-nemo': 'reazonspeech'}[engine]
                    assert events[0]['code'] == f'{prefix}_cli_path_invalid', events
                    assert not list(work.iterdir())
                    work.rmdir()
                    print(f'PASS deep runtime {engine}: structured rejection, no result')
                    if len(sys.argv) > 2:
                        # Optional real second-volume fixture; no SUBST/alias/share.
                        with tempfile.TemporaryDirectory(prefix='hikaru-cross-volume-', dir=sys.argv[2]) as other:
                            assert Path(other).drive[-2:].lower() != audio.drive[-2:].lower()
                            other_worker = Path(other) / worker.name
                            shutil.copyfile(worker, other_worker)
                            shutil.copyfile(worker.parent / 'crispasr.exe', Path(other) / 'crispasr.exe')
                            work.mkdir()
                            run = subprocess.run([str(other_worker)], input=(json.dumps(request) + '\n').encode(),
                                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
                            events = [json.loads(line) for line in run.stdout.splitlines()]
                            assert run.returncode == 20 and not run.stderr and len(events) == 1, events
                            assert events[0]['code'].endswith('_cli_path_invalid'), events
                            assert not list(work.iterdir())
                            work.rmdir()
                            print(f'PASS cross-volume {engine}: structured rejection, no result')
