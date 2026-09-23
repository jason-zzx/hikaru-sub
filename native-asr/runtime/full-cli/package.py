"""Package already-built independent full CLI runtimes; never build/download weights."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[3]
LOCK = Path(__file__).resolve().with_name('upstream-engineering-baseline-lock.json')


def identity(path):
    with path.open('rb') as stream:
        return {'sizeBytes': path.stat().st_size, 'sha256': hashlib.file_digest(stream, 'sha256').hexdigest()}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


def is_published_cuda_archive(archive, authority):
    # Publication belongs to exact uploaded bytes, never to a future rebuild.
    return (authority.get('externalStableAssetPublished') is True
            and archive == (authority.get('cuda') or {}).get('archive'))


def package(args):
    candidate = getattr(args, 'candidate_id', None)
    acquisition_path = getattr(args, 'parakeet_acquisition_lock', None)
    if bool(candidate) != bool(acquisition_path):
        raise ValueError('shared candidate requires explicit id and acquisition lock')
    acquisition = None
    if candidate:
        if not re.fullmatch(r'shared-[a-z0-9]+(?:-[a-z0-9]+)*', candidate):
            raise ValueError('invalid shared candidate id')
        # Candidate archives stay separately addressable; never replace published assets.
        args.output = args.output.resolve()
        if not args.output.is_relative_to(ROOT / 'native-asr/build/full-cli'):
            raise ValueError('candidate output must use ignored full-cli scratch')
        acquisition = json.loads(acquisition_path.read_text(encoding='utf-8'))
        if acquisition.get('schemaVersion') != 1:
            raise ValueError('candidate acquisition schema mismatch')
        models = acquisition.get('models') or [acquisition['model']]
        manifest = json.loads((ROOT / 'src-tauri/resources/native-asr-models.json').read_text(encoding='utf-8'))
        expected_models = {
            'nvidia/parakeet-tdt_ctc-0.6b-ja': next(r for r in manifest['models'] if r['engine'] == 'parakeet'),
            'reazon-research/reazonspeech-nemo-v2': next(r for r in manifest['models'] if r['engine'] == 'reazonspeech-nemo'),
        }
        logical_models = [model['logicalModel'] for model in models]
        if (len(logical_models) != len(set(logical_models))
                or set(logical_models) not in ({'nvidia/parakeet-tdt_ctc-0.6b-ja'}, set(expected_models))):
            raise ValueError('candidate model set mismatch')
        for model in models:
            expected = expected_models[model['logicalModel']]
            if (model['license'] != expected['license']['spdx']
                    or any(model[k] != expected[k] for k in ('repository', 'revision'))
                    or any(model[k] != expected['files'][0][v] for k, v in
                           [('file', 'path'), ('sizeBytes', 'sizeBytes'), ('sha256', 'sha256')])):
                raise ValueError('candidate model authority mismatch')
            if (model['logicalModel'] == 'reazon-research/reazonspeech-nemo-v2'
                    and (model.get('upstreamRepository') != model['logicalModel']
                         or model.get('upstreamRevision') != '33693408be76b7cba9fd4a7546a0a8772430211b'
                         or not model.get('upstreamModelCard'))):
                raise ValueError('candidate upstream model authority mismatch')
    engines = ['qwen3-asr'] + (['parakeet'] if candidate else [])
    if candidate and 'reazon-research/reazonspeech-nemo-v2' in logical_models:
        engines.append('reazonspeech-nemo')
    # Fresh output preserves every prior runtime/evidence byte.
    args.output.mkdir(parents=True, exist_ok=False)
    source_files = [{'path': p.relative_to(args.source).as_posix(), **identity(p)}
                    for p in sorted(args.source.rglob('*')) if p.is_file()]
    source = {'repository': 'CrispStrobe/CrispASR', 'commit': 'e2a356146e36bc1cc0410edefb01990448766979',
              'ggmlCommit': '5049ebb8472fdc965eb3fb72c1cb111260726186',
              'c2paCommit': 'e40329b83f16f67bb5ddc7bb13ae18de0a9376fc',
              'preparedFilesSha256': hashlib.sha256(json.dumps(source_files, sort_keys=True).encode()).hexdigest(),
              'adaptations': [{'path': p.name, **identity(p)} for p in sorted(Path(__file__).parent.iterdir())
                              if p.suffix in ('.py', '.h', '.cmake', '.cmd')]}
    write_json(args.output / 'source-identities.json', source_files)
    lock = {'schemaVersion': 1, 'status': 'qwen-application-enabled-owner-manual-verification-pending',
            'productEnablementAllowed': True, 'externalStableAssetPublished': False}
    if candidate:
        lock.update(status='local-shared-candidate-not-published', candidateId=candidate,
                    acquisitionLock=identity(acquisition_path))
    for device in ('cpu', 'cuda'):
        build = getattr(args, device + '_build')
        worker = getattr(args, device + '_worker')
        root = args.output / device / 'windows-x64/crispasr' / device
        licenses = root / 'licenses'; licenses.mkdir(parents=True)
        shutil.copyfile(build / 'bin/crispasr.exe', root / 'crispasr.exe')
        shutil.copyfile(worker / 'bin/hikaru-asr-qwen-cli-worker.exe', root / 'hikaru-asr-worker.exe')
        for name in ('msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'):
            shutil.copyfile(args.redist / 'Microsoft.VC145.CRT' / name, root / name)
        shutil.copyfile(args.redist / 'Microsoft.VC145.OpenMP/vcomp140.dll', root / 'vcomp140.dll')
        notices = []
        def copy_notice(name, source_path, component, terms, origin):
            shutil.copyfile(source_path, licenses / name)
            notices.append({'name': component, 'license': terms, 'localLicenseFile': 'licenses/' + name, 'source': origin})
        for name, path, component, terms in [
            ('CrispASR-MIT.txt', 'LICENSE', 'CrispASR / whisper.cpp / GGML', 'MIT'),
            ('upstream-THIRD-PARTY-NOTICES.txt', 'THIRD_PARTY_NOTICES.txt', 'Upstream complete notices (including explicitly unbundled components)', 'see component notices'),
            ('glint-MIT.txt', 'glint/LICENSE', 'glint', 'MIT'),
            ('WebRTC-BSD.txt', 'third_party/webrtc/LICENSE', 'WebRTC VAD', 'BSD-3-Clause'),
            ('c2pa-MIT.txt', 'third_party/c2pa-audio/LICENSE', 'c2pa-audio SHA helper (native signing disabled)', 'MIT / public-domain SHA helper'),
            ('micro-ecc-BSD.txt', 'third_party/c2pa-audio/third_party/uecc/LICENSE.txt', 'micro-ecc (native signing disabled; notice retained)', 'BSD-2-Clause'),
        ]:
            copy_notice(name, args.source / path, component, terms, 'pinned-upstream:' + path)
        copy_notice('Apache-2.0.txt', ROOT/'LICENSE', 'Hikaru Sub worker; OmniVoice derived tables; Qwen weight terms (weights not bundled)', 'Apache-2.0', 'https://www.apache.org/licenses/LICENSE-2.0')
        copy_notice('nlohmann-worker-MIT.txt', ROOT/'native-asr/third_party/nlohmann/LICENSE.MIT', 'nlohmann/json 3.11.3 worker', 'MIT', 'native-asr/third_party/nlohmann/provenance.json')
        for name, component in [('cpp-httplib-MIT.txt', 'cpp-httplib 0.20.0'), ('uroman-MIT.txt', 'uroman lookup tables')]:
            row = next(r for r in json.loads((args.extra_licenses/'sources.json').read_text(encoding='utf-8')) if r['path'] == name)
            if identity(args.extra_licenses/name) != {k:row[k] for k in ('sizeBytes','sha256')}: raise ValueError('license input drift')
            copy_notice(name,args.extra_licenses/name,component,
                        'MIT-style with additional publication acknowledgement' if name == 'uroman-MIT.txt' else 'MIT',row['url'])
        # Preserve complete original embedded license blocks; no copyright invention.
        for name, path, marker in [('stb-vorbis.txt','examples/stb_vorbis.c','This software is available under 2 licenses'),
                                   ('miniaudio.txt','examples/miniaudio.h','ALTERNATIVE 1 - Public Domain')]:
            text=(args.source/path).read_text(encoding='utf-8'); at=text.rfind(marker)
            if at < 0: raise ValueError('license anchor missing')
            (licenses/name).write_text(text[at:],encoding='utf-8',newline='\n')
            notices.append({'name':name,'license':'public domain or permissive alternative; full text retained','localLicenseFile':'licenses/'+name,'source':'pinned-upstream:'+path})
        with zipfile.ZipFile(ROOT/'native-asr/artifacts/windows-x64-cpu.zip') as ct2:
            name='Microsoft-Visual-Cpp-V14-Runtime-2026-License.docx'
            (licenses/name).write_bytes(ct2.read('windows-x64/cpu/licenses/'+name))
        (licenses/'Microsoft-Visual-Cpp-Runtime.txt').write_text(
            'Microsoft Visual C++ V14 Redistributable and Runtime 2026 terms\n'
            'https://visualstudio.microsoft.com/license-terms/vs2026-ga-visualcpp-v14-redist-runtime/\n'
            'https://aka.ms/vs/18/redistribution\nBY USING THE SOFTWARE, YOU ACCEPT THESE TERMS.\n'
            "msvcp140.dll, vcruntime140.dll, vcruntime140_1.dll and vcomp140.dll come unmodified from VS18 VC/Redist.\n"
            "These files are excluded from Hikaru Sub's Apache-2.0 project license. See the unchanged official DOCX.\n",encoding='utf-8')
        notices.append({'name':'Microsoft Visual C++ Runtime','license':'Microsoft Visual C++ V14 Redistributable and Runtime 2026 terms','localLicenseFile':'licenses/'+name,'source':'https://aka.ms/vs/18/redistribution','projectLicenseExcluded':True})
        if device == 'cuda':
            for name in ('cudart64_12.dll','cublas64_12.dll','cublasLt64_12.dll'):
                shutil.copyfile(args.cuda_toolkit/'bin'/name,root/name)
            for name in ('EULA.txt','LICENSE'):
                copy_notice('NVIDIA-'+name,args.cuda_toolkit/name,'NVIDIA CUDA Toolkit 12.8','NVIDIA CUDA Toolkit EULA','https://docs.nvidia.com/cuda/archive/12.8.0/eula/index.html')
        model_lock=json.loads(LOCK.read_text(encoding='utf-8'))
        model_notice={'weightsBundled':False,'converterCommit':None,'conversionProvenance':'Reused published GGUF bytes; publisher did not state converter commit. No conversion performed.',
                      'assets':[{k:r[k] for k in ('logicalModel','repository','revision','file','publicationSizeBytes','publicationSha256','licenseDeclaredByModelCard','modelCard')} for r in model_lock['models']]}
        if acquisition:
            # Full attribution/changes/provenance limits; no fabricated converter commit.
            model_notice['assets'].extend(models)
        write_json(licenses/'MODEL-SOURCES.json',model_notice)
        write_json(licenses/'THIRD-PARTY-NOTICES.json',{'components':notices,'modelsBundled':False,
                   'uromanAcknowledgement':"This project uses the universal romanizer software 'uroman' written by Ulf Hermjakob, USC Information Sciences Institute (2015-2020). Bibliography: Ulf Hermjakob, Jonathan May, and Kevin Knight. 2018. Out-of-the-box universal romanization tool uroman. Proceedings of the 56th Annual Meeting of Association for Computational Linguistics, Demo Track.",
                   'unusedWeightTerms':'Full CLI source contains other implementations, not their model weights; their weight-only licenses are not linked-code licenses.',
                   'disabledOptionalComponents':['espeak-ng','native C2PA signing','FFmpeg','libopus/libogg/opusfile fetch','AMR','CURL','other GPU backends'],
                   'msvcUnlinkedComponents':['RNNoise','KleidiAI','libgomp','libomp','OpenBLAS']})
        files=[]
        for f in sorted(root.rglob('*')):
            if not f.is_file():continue
            data=f.read_bytes()
            if f.suffix.lower() in ('.exe','.dll') and any(n in data for n in (b'.trellis',b'C:/Users/',b'C:'+bytes([92])+b'Users')):
                raise ValueError('private build path in runtime')
            files.append({'path':f.relative_to(root).as_posix(),**identity(f)})
        manifest={'schemaVersion':1,'artifactId':f'hikaru-asr-crispasr-windows-x64-{device}-{candidate or "v1"}','platform':'windows-x64','arch':'x64','protocolVersion':1,
                  'capabilities':{'backend':'crispasr','device':device,'engines':engines,'vad':True,'crispasr':True,'cuda':device=='cuda','vulkan':False,'modelsBundled':False},
                  'source':source,'build':{'target':'crispasr-cli','cmakeCacheSha256':identity(build/'CMakeCache.txt')['sha256'],
                    'cudaArchitectures': '50-virtual;61-virtual;70-virtual;75-virtual;80-virtual;86-real;89-real;90-virtual;120a-real' if device=='cuda' else None,
                    'cudaToolchain':'CUDA 12.8 + MSVC 14.50 -allow-unsupported-compiler; locally tested, not vendor-supported toolchain' if device=='cuda' else None},'files':files}
        write_json(root/'runtime-manifest.json',manifest)
        (root/'SHA256SUMS').write_text(''.join(f"{r['sha256']}  {r['path']}\n" for r in files),encoding='utf-8',newline='\n')
        archive=args.output/f'crispasr-{device}.zip'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for f in sorted(root.rglob('*')):
                if f.is_file():
                    info=zipfile.ZipInfo(f.relative_to(args.output/device).as_posix(),(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,f.read_bytes(),compresslevel=9)
        lock[device]={'artifactId':manifest['artifactId'],'manifestSha256':identity(root/'runtime-manifest.json')['sha256'],'files':files,
                      'archive':{'path':archive.relative_to(ROOT).as_posix() if candidate else f'native-asr/artifacts/crispasr-{device}.zip',
                                 'root':f'windows-x64/crispasr/{device}/',**identity(archive)}}
        if candidate:
            lock[device]['engines'] = engines
    authority = json.loads((ROOT/'native-asr/runtime/crispasr-product-lock.json').read_text(encoding='utf-8'))
    lock['externalStableAssetPublished'] = is_published_cuda_archive(lock['cuda']['archive'], authority)
    write_json(args.output/'crispasr-product-lock.json',lock)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source','cpu-build','cuda-build','cpu-worker','cuda-worker','redist','cuda-toolkit','extra-licenses','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--candidate-id', help='Fresh shared-* identity; never a publication or model availability toggle')
    parser.add_argument('--parakeet-acquisition-lock', type=Path)
    package(parser.parse_args())
