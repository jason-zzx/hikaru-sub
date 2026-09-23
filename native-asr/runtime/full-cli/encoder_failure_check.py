"""Exact native encoder allocation-fault proof; no model/GPU or injection flag.

The ENTIRE shared encoder function and controlled failure helper are extracted.
Only tensor/model/compute data are stand-ins. Repeated calls represent the shared
single-pass, later-slice/gap and streamed-window entry, not a mock log filter.
"""
import hashlib
import json
from pathlib import Path
import subprocess
from vad_failure_check import between

PREAMBLE = r'''
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
struct ggml_cgraph {};
struct ggml_tensor { int64_t ne[2]={1,1}; };
using ggml_backend_t=void*;
constexpr int GGML_STATUS_SUCCESS=0;
static int calls=0, fail_at=0;
struct parakeet_context {
 struct { struct { int n_mels=80,d_model=1,att_context_left=1,att_context_right=1,global_tokens=0; } hparams; } model;
 void *sched=nullptr,*backend=nullptr,*backend_cpu=nullptr;
 std::vector<char> compute_meta,cached_enc_meta;
 ggml_cgraph* cached_enc_gf=nullptr; int cached_enc_T_mel=0;
};
namespace crispasr_env { const char* get(const char*) { return nullptr; } }
namespace core_conformer {
std::vector<float> make_pos_enc(int,int) { return {1}; }
std::vector<float> make_local_attn_mask(int,int,int,int) { return {1}; }
std::vector<float> make_window_band_mask(int,int,int,int,int) { return {1}; }
int fc_window_block_size(int,int) { return 1; }
}
namespace hikaru_qwen { int compute(void*,ggml_cgraph*,const char*) { return 0; } }
void* ggml_backend_sched_new(void**,void*,int,int,bool,bool) { return (void*)1; }
void crispasr_imatrix_install(void*) {}
size_t ggml_tensor_overhead() { return 1; }
size_t ggml_graph_overhead_custom(int,bool) { return 1; }
int64_t ggml_time_us() { return 0; }
ggml_cgraph* parakeet_build_graph_encoder(parakeet_context*,int) { static ggml_cgraph g; return &g; }
void ggml_backend_sched_reset(void*) {}
bool ggml_backend_sched_alloc_graph(void*,ggml_cgraph*) { return ++calls != fail_at; }
ggml_tensor* ggml_graph_get_tensor(ggml_cgraph*,const char* name) {
 static ggml_tensor t;
 return std::strcmp(name,"local_attn_mask") && std::strcmp(name,"window_band_mask") ? &t : nullptr;
}
void ggml_backend_tensor_set(ggml_tensor*,const void*,size_t,size_t) {}
void ggml_backend_tensor_get(ggml_tensor*,void* out,size_t,size_t) { *static_cast<float*>(out)=1; }
'''
MAIN = r'''
int main(int argc,char** argv) {
 if(argc!=3) return 2;
 fail_at=std::atoi(argv[1]);
 _putenv_s("HIKARU_PARAKEET_DEVICE",argv[2]);
 _putenv_s("HIKARU_QWEN_DEVICE","");
 _putenv_s("CRISPASR_PARAKEET_ENC_CACHE","");
 parakeet_context ctx; float mel[80]={}; int frames=0,empty=0;
 for(int i=1;i<=6;++i) {
  // Six invocations alternate normal slice and actual-audio gap entry. The
  // streamed entry reaches this same native encoder (source trace in result).
  std::fprintf(stderr,"entry=%s call=%d\n",i%2?"slice-or-stream":"gap",i);
  const auto result=parakeet_encode_mel(&ctx,mel,80,1,&frames);
  if(result.empty()) ++empty;
  std::fprintf(stderr,"returned call=%d empty=%d\n",i,result.empty());
 }
 std::printf("calls=%d empty=%d completed=1\n",calls,empty);
 return 0;
}
'''


def check_encoder_failure(source: Path, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    native = (source / 'src/parakeet.cpp').read_text(encoding='utf-8')
    header = (source / 'src/core/hikaru_qwen_device.h').read_text(encoding='utf-8')
    encoder = between(native, 'static std::vector<float> parakeet_encode_mel(', '\n}\n')
    helper = ''.join(between(header, marker, '\n') for marker in [
        'inline bool parakeet()', 'inline bool reazonspeech()', 'inline bool parakeet_family()'
    ]) + between(header, '[[noreturn]] inline void fail(', '\n}\n')
    guard = '        if (hikaru_qwen::parakeet_family()) hikaru_qwen::fail("parakeet_encoder_allocation_failed");\n'
    assert encoder.count(guard) == 1
    # All relevant callers share this one encoder: transcribe_ex and streamed
    # windows in native; gap fill calls the same backend transcribe entry.
    assert native.count('parakeet_encode_mel(ctx,') >= 2
    gap = (source / 'examples/cli/crispasr_gap_fill.h').read_text(encoding='utf-8')
    assert 'be.transcribe(' in gap
    rows = []
    for variant, body in [('fixed', encoder), ('guard-removed-negative-control', encoder.replace(guard, ''))]:
        test = out / (variant + '.cpp')
        test.write_text(PREAMBLE + '\nnamespace hikaru_qwen {\n' + helper + '}\n' + body + MAIN, encoding='utf-8')
        exe = out / (variant + '.exe')
        subprocess.run(['cl', '/nologo', '/EHsc', '/std:c++17', '/utf-8', str(test), '/Fe:' + str(exe)], cwd=out, check=True)
        for device in ['cpu', 'cuda', '']:
            for failure in [0, 1, 5, 6]:
                name = f'{variant}-{device or "uncontrolled"}-{failure}'
                result = subprocess.run([str(exe), str(failure), device], capture_output=True, check=False)
                (out / (name + '.log')).write_bytes(result.stdout + result.stderr)
                fatal = variant == 'fixed' and bool(device) and failure > 0
                passed = result.returncode == (40 if fatal else 0)
                if fatal:
                    passed &= b'hikaru_error: parakeet_encoder_allocation_failed' in result.stderr
                    passed &= b'completed=1' not in result.stdout and f'returned call={failure}'.encode() not in result.stderr
                else:
                    passed &= f'calls=6 empty={int(failure > 0)} completed=1'.encode() in result.stdout
                rows.append({'case': name, 'exitCode': result.returncode, 'expectedExitCode': 40 if fatal else 0, 'passed': bool(passed)})
    (out / 'result.json').write_text(json.dumps({'modelRuns': 0, 'cases': rows,
        'exactEncoderSha256': hashlib.sha256(encoder.encode()).hexdigest(),
        'exactFailureHelperSha256': hashlib.sha256(helper.encode()).hexdigest(),
        'scope': 'shared exact encoder; allocation/compute stubs, repeated early/late slice-gap-stream entries'}, indent=2) + '\n')
    assert all(row['passed'] for row in rows), 'native encoder allocation must fail before empty-result fallback'
    print(f'PASS: {len(rows)} exact-encoder early/late allocation/control cases (including guard-removed defect reproduction)')
