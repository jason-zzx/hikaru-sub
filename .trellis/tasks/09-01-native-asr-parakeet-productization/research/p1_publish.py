"""Deterministically publish sanitized P1 evidence from hash-bound retained outputs.

No inference, quality scoring, transcript/token publication or mutable-summary
promotion. The original failed harness row remains failed.
"""
import argparse
import csv
import json
import re
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / 'native-asr/runtime/full-cli'))
from parakeet_smoke import LOCAL, identity, verify_loaded_runtime, runtime_identity
from prepare import verify
from validate import validate, require
from p1_acquisition import frozen_metadata, gguf_metadata

RUNS = [
    ('parakeet-cpu-short-p1', 'cpu', 'parakeet', '65c29ed1fa9ff7b7c1c48a93845529cc614a156973d3a593158f4bca87594947'),
    ('parakeet-cpu-short-p1-r2', 'cpu', 'parakeet', 'f5287748cce364b8a221db3cb8ff43144425737b515d5cdb7820b7ebe354e2fa'),
    ('parakeet-cuda-short-p1-r2', 'cuda', 'parakeet', '5b2f8c01a53c5a66811604a8a23c4ec9feeccfc4c60667aec231548f410aa1e5'),
    ('qwen-cpu-short-parakeet-p1', 'cpu', 'qwen3', 'b801989c96955f745b68cad12612d3cfb4e71e1322dbc82a03f60f1b9d186578'),
    ('qwen-cuda-short-parakeet-p1', 'cuda', 'qwen3', '2f8e6aed4b7039e754a46aa28b1b4b9e5196acceede3c14028adf937b4de056e'),
    ('parakeet-cpu-short-p1-r3', 'cpu', 'parakeet', '60014205d152834a44a40337e9fe1e4b65c0048467276806cbe87d253720f009'),
    ('parakeet-cuda-short-p1-r3', 'cuda', 'parakeet', 'dae30528253c8dc61098ef280d6856011e0fe44216efa497c8698f2a6b76720f'),
    ('qwen-cpu-short-parakeet-p1-r3', 'cpu', 'qwen3', 'b6fdecb0adbb2a541613e6c71dfe688b01c227023b5c331d9c3725f0333b5f19'),
    ('qwen-cuda-short-parakeet-p1-r3', 'cuda', 'qwen3', '18899ceb9441a5f7ccb5c90e8d7843d733d611404ea8380098349769e46e6cea'),
]
RUNS += [
    ('parakeet-cpu-short-p1-r4', 'cpu', 'parakeet', '727653f74a982f08096d107b15732a047c881186251833faea955a2167ae62fc'),
    ('parakeet-cuda-short-p1-r4', 'cuda', 'parakeet', '09ab5c75eddd09caf24539f2c960370d14fd7047026186fe6c3ff9ecc024c0d3'),
    ('qwen-cpu-short-parakeet-p1-r4', 'cpu', 'qwen3', '196cb7ce955c031569f4acdb0c70a54b4329517591a5e5c19d367bb5daabb272'),
    ('qwen-cuda-short-parakeet-p1-r4', 'cuda', 'qwen3', '525973611b633f0ae6e15348f2d51ee02feb13359452937567faa38abddf1926'),
]
PREVIOUS_RUNTIME_SHA = '732febf036fed7d4b44beec8abee20572762249c81b03e69809cb495fee61496'
RUNTIME_SHA = '397cc99bf6227cfb83e71a872b2108aae4f0bf42c726c454f9a6005d4cf7cf9a'
ACQUISITION_SHA = '87573bb1454dc460302b3585b2f4c7fcda9b99f370b5295c43284988ccdc991d'


def derive():
    model_lock = HERE / 'p1-acquisition-lock.json'
    require(identity(model_lock)['sha256'] == ACQUISITION_SHA, 'acquisition_lock_changed')
    require(json.loads(model_lock.read_bytes()) == frozen_metadata(), 'metadata_drift')
    runtime_path = LOCAL / 'parakeet-runtime-lock-r4.json'
    require(identity(runtime_path)['sha256'] == RUNTIME_SHA, 'runtime_lock_changed')
    runtime = json.loads(runtime_path.read_bytes())
    for device in ['cpu', 'cuda']:
        require(runtime['devices'][device] == runtime_identity(device), 'runtime_bytes_changed')
    for name, row in runtime['adaptations'].items():
        verify(REPO / 'native-asr/runtime/full-cli' / name, row)
    verify(LOCAL / 'parakeet-source-files.json', runtime['preparedSources'])
    for name, row in json.loads((LOCAL / 'parakeet-source-files.json').read_bytes()).items():
        verify(LOCAL / 'source-parakeet-p1' / name, row)
    preserved = LOCAL / 'p1-r3-preserved'
    require(identity(preserved / 'parakeet-runtime-lock-r3.json')['sha256'] == PREVIOUS_RUNTIME_SHA, 'previous_lock_changed')
    previous = json.loads((preserved / 'parakeet-runtime-lock-r3.json').read_bytes())
    for device, values in previous['devices'].items():
        for name, digest in values['files'].items():
            verify(preserved / device / 'bin' / name, digest)
        verify(preserved / device / 'CMakeCache.txt', values['cmakeCache'])
    for name, digest in previous['adaptations'].items():
        verify(preserved / 'tools' / name, digest)
    verify(preserved / 'parakeet-source-files.json', previous['preparedSources'])
    for name, digest in json.loads((preserved / 'parakeet-source-files.json').read_bytes()).items():
        verify(preserved / 'source' / name, digest)
    require(identity(preserved / 'research/p1-evidence.json')['sha256'] ==
            '6402cd5b775a3c73ba5790c16941dd9804cf6898a57bb7becf0255d28ca0d5b8', 'previous_evidence_changed')
    before_arch = re.search(r'-- Using CMAKE_CUDA_ARCHITECTURES=(\S+)', (LOCAL / 'build-cuda.log').read_text(errors='replace')).group(1)
    after_arch = re.search(r'-- Using CMAKE_CUDA_ARCHITECTURES=(\S+)', (LOCAL / 'build-cuda-retry.log').read_text(errors='replace')).group(1)
    current_arch = re.search(r'-- Using CMAKE_CUDA_ARCHITECTURES=(\S+)', (LOCAL / 'build-cuda-r4.log').read_text(errors='replace')).group(1)
    require(before_arch == after_arch == current_arch, 'retry_architecture_changed')
    require(not (LOCAL / 'cuda-ownership.json').exists(), 'cuda_recovery_required')
    processes = (LOCAL / 'final-processes-r4.json').read_bytes()
    require(not (json.loads(processes) if processes.strip() else []), 'final_process_remaining')
    acquisition = json.loads(model_lock.read_bytes())
    for role in ['model', 'vad']:
        verify(LOCAL / 'acquisition' / acquisition[role]['file'], acquisition[role])
    rows = []
    for name, device, backend, summary_sha in RUNS:
        root = LOCAL / name
        require(identity(root / 'summary.json')['sha256'] == summary_sha, 'summary_changed')
        summary = json.loads((root / 'summary.json').read_bytes())
        require(summary['device'] == device, 'device_changed')
        for file, digest in summary['rawEvidence'].items():
            require(Path(file).name == file, 'raw_path_escape')
            verify(root / file, digest)
        owner = json.loads((root / 'ownership.json').read_bytes())
        argv, env = owner['argv'], owner['environment']
        require(argv[argv.index('--backend') + 1] == backend and argv[argv.index('--gpu-backend') + 1] == device, 'argv_device')
        require(('--no-gpu' in argv) == (device == 'cpu'), 'cpu_argv')
        require(env.get('HIKARU_PARAKEET_DEVICE' if backend == 'parakeet' else 'HIKARU_QWEN_DEVICE') == device, 'control_device')
        require(not any(k.upper().startswith(('CRISPASR', 'GGML')) for k in env), 'inherited_tuning')
        require(not any(x in argv for x in ['--chunk-seconds', '--parakeet-decoder', '--vad-stitch', '--stream']), 'algorithm_override')
        require(('-am' in argv) == (backend == 'qwen3'), 'aligner_role')
        require(owner['state'] == 'reaped' and owner['exitCode'] == 0 and owner['processExitConfirmed'] and owner['activeJobProcesses'] == 0, 'process_not_reaped')
        require(not json.loads((root / 'process-before.json').read_bytes()) and not json.loads((root / 'process-after.json').read_bytes()), 'process_overlap')
        proof = validate((root / 'result.json').read_bytes(), 385637 * 1000 // 16000,
                         (root / 'stderr.log').read_bytes(), device, backend=backend)
        modules = json.loads((root / 'loaded-module-identities.json').read_bytes())
        final = name.endswith('-r4')
        selected_runtime = runtime if final else previous
        verify_loaded_runtime(modules, LOCAL / device / 'bin', selected_runtime['devices'][device]['files'])
        if final:
            inputs = json.loads((root / 'inputs.json').read_bytes())
            caller = REPO / 'native-asr/runtime/full-cli/parakeet_smoke.py' if backend == 'parakeet' else HERE / 'p1_qwen_regression.py'
            binding = {**inputs, 'backend': backend, 'tool': identity(caller)}
            if device == 'cuda':
                attempt = json.loads((root / 'cuda-attempt.json').read_bytes())
                require(attempt['binding'] == binding and attempt['argv'] == argv and attempt['environment'] == env,
                        'preexecution_binding_changed')
                completion = json.loads((root / 'cuda-completion.json').read_bytes())
                require(completion['attempt'] == owner['cudaAttempt'] and owner['outcome'] == 'exited-zero'
                        and completion['summary']['status'] == 'passed', 'cuda_completion_changed')
                require(completion['attempt']['identity'] == identity(root / 'cuda-attempt.json'), 'attempt_hash_changed')
                for file, digest in completion['evidence'].items():
                    require(Path(file).name == file, 'completion_path_escape')
                    verify(root / file, digest)
        original_failure = name == RUNS[0][0]
        require(summary['status'] == ('failed' if original_failure else 'passed'), 'disposition_changed')
        if original_failure:
            require(summary['error'] == 'runtime_module_missing_or_drift', 'historical_failure_changed')
            disposition = 'failed-original-harness-case-sensitive-module-path'
        else:
            expected_lock = (RUNTIME_SHA if final else PREVIOUS_RUNTIME_SHA if name.endswith('-r3') else
                             '5a90717a430cf58ef5bf413fa5f7f23469d98ce21c30a0c9dc4b3c0983041437')
            require(summary['runtimeLock']['sha256'] == expected_lock, 'row_runtime_drift')
            disposition = ('passed-short-functional-smoke' if backend == 'parakeet' else 'passed-short-shared-runtime-regression')
        rows.append({'run': name, 'device': device, 'backend': backend, 'case': 'short-v1', 'disposition': disposition,
                     'finalHarnessEvidence': final, 'runtimeLock': summary['runtimeLock'],
                     'elapsedSeconds': owner['elapsedSeconds'], 'outputValidation': proof,
                     'processExitCode': owner['exitCode'], 'activeJobProcesses': owner['activeJobProcesses'],
                     'loadedModuleCount': len(modules), 'summary': identity(root / 'summary.json'),
                     'rawEvidence': summary['rawEvidence']})
    checks = {}
    for name in ['output-check-p1-r4/encoder-fault/result.json', 'output-check-p1-r4/vad-failure-result.json',
                 'recovery-check-r4-final2/result.json']:
        value = json.loads((LOCAL / name).read_bytes())
        require(all(row['passed'] for row in value['cases']), 'focused_regression_failed')
        checks[name] = {'identity': identity(LOCAL / name), 'cases': value['cases']}
    audio_cases = re.search(r'PASS: (\d+) exact-reader audio cases;', (LOCAL / 'check-p1-r4-retry.log').read_text(errors='replace'))
    require(audio_cases and int(audio_cases.group(1)) == 24, 'audio_regression_missing')
    checks['audio-reader'] = {'casesPassed': int(audio_cases.group(1)), 'log': identity(LOCAL / 'check-p1-r4-retry.log')}
    return {'schemaVersion': 2, 'scope': 'P1 only; not worker/host/ASS delivery, qualification, publication or enablement',
            'acquisitionLock': identity(model_lock), 'runtimeLock': identity(runtime_path),
            'candidateRuntime': runtime,
            'preservedR3': {'root': 'native-asr/build/full-cli/p1-r3-preserved', 'runtime': previous,
                            'evidence': identity(preserved / 'research/p1-evidence.json')},
            'reviewCorrections': checks, 'verifiedGguf': gguf_metadata(LOCAL / 'acquisition' / acquisition['model']['file']),
            'runs': rows,
            'hardware': [{k.strip(): v.strip() for k, v in row.items()} for row in csv.DictReader((LOCAL / 'hardware.csv').read_text().splitlines())],
            'cudaArchitectureListBeforeAndAfterRetry': before_arch,
            'finalProcessInventory': identity(LOCAL / 'final-processes-r4.json'),
            'buildLogs': {name: identity(LOCAL / name) for name in ['build-cpu.log', 'build-cuda.log', 'build-cuda-retry.log', 'check-p1-r3.log',
                'timeline-retirement-e78aced5-cli-ctest.log', 'timeline-retirement-e78aced5-dev-ctest.log',
                'build-cpu-r4.log', 'build-cuda-r4.log', 'check-p1-r4.log', 'check-p1-r4-retry.log',
                'recovery-check-r4-final2.log']},
            'compilerTimeoutEvidence': {name: identity(LOCAL / name) for name in ['pre-retry-identities.json', 'pre-retry-processes.json', 'build-processes.json']},
            'tooling': {name: identity(HERE / name) for name in ['p1_acquisition.py', 'p1_qwen_regression.py', 'p1_publish.py']},
            'limitations': ['Original 1800s CUDA compiler timeout retained; owner-approved same-command incremental retry succeeded. No CUDA inference was killed.',
                            'CMakeCache bytes changed across normal reconfigure (58760 to 58802 bytes); pre-retry hash is retained, not the original cache bytes. Both logs report identical architectures; Ninja resumed the remaining 719 of 853 targets after 134 completed. Final cache/binaries are authority.',
                            'Original CPU smoke failed harness path-case comparison despite valid output; preserved, not relabeled.',
                            'Earlier r2/r3 successes and the original failed row remain unchanged. Only the four r4 runs are current-harness evidence after accepted R1-R3 corrections.',
                            'Malformed new VS check launcher failed before compiler startup; log/launcher/partial diff retained. Supervisor authorized same-protocol correction from original launcher bytes; retry passed.',
                            'Encoder faults and recovery sentinel failures use model-free exact-source/owned Python fixtures, not induced GPU OOM or terminated ASR hardware runs.',
                            'Only short-v1 CLI execution; medium/long, host/ASS, model manager, packaging and lifecycle matrix remain pending.',
                            'CUDA graph proof covers encoder/predictor/joint. Upstream host mel/projection/state/argmax work remains CPU; VAD is required CPU.',
                            'RTX 3070 8 GiB only; architecture code coverage is not other-hardware verification.',
                            'New shared candidate is local only and has not replaced published artifact identities.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    value = derive()
    encoded = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    output = HERE / 'p1-evidence.json'
    if args.check:
        require(output.read_bytes() == encoded, 'publication_not_reproducible')
        # Hash-bound disposition mutation must fail before any promotion.
        name, device, backend, digest = RUNS[0]
        RUNS[0] = (name, device, backend, '0' * 64)
        try:
            derive()
        except ValueError as exc:
            require(str(exc) == 'summary_changed', 'unexpected_mutation_failure')
        else:
            raise AssertionError('changed evidence hash accepted')
        finally:
            RUNS[0] = (name, device, backend, digest)
    else:
        output.write_bytes(encoded)
    print('PASS: hash-verified deterministic P1 publication' + (' and mutation rejection' if args.check else ''))


if __name__ == '__main__':
    main()
