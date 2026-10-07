"""Reviewer's exact-source VAD fault proof, retained as a narrow regression.

Only CPU compute/allocator/model data are stand-ins. Detection, its caller, the
Silero result branch, CLI slices and required-VAD guard are extracted unchanged.
No model execution or production fault-injection switch.
"""
import hashlib
import json
from pathlib import Path
import subprocess

# Reused from independent-review/vad_failure_check.py, with a success control and
# minimal data types for the immediate downstream required-VAD chain.
PREAMBLE = r'''#include <algorithm>
#include <cstdlib>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>
#define CRISPASR_LOG_INFO(...) std::fprintf(stderr, __VA_ARGS__)
#define CRISPASR_LOG_ERROR(...) std::fprintf(stderr, __VA_ARGS__)
struct ggml_tensor {};
struct ggml_cgraph {};
struct ggml_cplan { size_t work_size=0; uint8_t* work_data=nullptr; };
constexpr int GGML_STATUS_SUCCESS=0;
static int cpu_calls=0, fail_at=0, resets=0, segment_calls=0, fallback_calls=0;
static const char* requested_device="cpu";
namespace core_cpu_backend {
inline ggml_cplan plan(ggml_cgraph*,int,void*) { return {}; }
inline int compute_planned(ggml_cgraph*,ggml_cplan*,int) {
 return ++cpu_calls == fail_at ? -1 : GGML_STATUS_SUCCESS;
}
}
namespace hikaru_qwen {
inline const char* device() { return requested_device; }
inline bool vad_only() { return std::strcmp(requested_device,"vad-only") == 0; }
}
struct whisper_vad_context {
 int n_window=1; void* buffer=nullptr; void* threadpool=nullptr;
 std::vector<float> probs,window_buf;
 std::vector<uint8_t> work_buf;
 struct { void* sched=nullptr; } sched;
 int64_t t_vad_us=0;
};
static whisper_vad_context ctx;
static ggml_cgraph graph;
static ggml_tensor tensor;
inline ggml_cgraph* whisper_vad_build_graph(whisper_vad_context&) { return &graph; }
inline void ggml_backend_buffer_clear(void*,int) {}
inline void ggml_backend_sched_reset(void*) { ++resets; }
inline bool ggml_backend_sched_alloc_graph(void*,ggml_cgraph*) { return true; }
inline ggml_tensor* ggml_graph_get_tensor(ggml_cgraph*,const char*) { return &tensor; }
inline int64_t ggml_time_us() { return 1; }
inline int ggml_nelements(ggml_tensor*) { return 1; }
inline void ggml_backend_tensor_set(ggml_tensor*,const void*,size_t,size_t) {}
inline void ggml_backend_tensor_get(ggml_tensor*,void* data,size_t,size_t) { *static_cast<float*>(data)=0.9f; }
struct whisper_vad_params {
 float threshold=0.5f, speech_pad_ms=0; int min_speech_duration_ms=0, min_silence_duration_ms=0;
};
struct whisper_vad_segments {};
inline whisper_vad_params whisper_vad_default_params() { return {}; }
inline whisper_vad_segments* whisper_vad_segments_from_probs(whisper_vad_context*,whisper_vad_params) {
 ++segment_calls; static whisper_vad_segments value; return &value;
}
inline int whisper_vad_segments_n_segments(whisper_vad_segments*) { return 1; }
inline float whisper_vad_segments_get_segment_t0(whisper_vad_segments*,int) { return 0; }
inline float whisper_vad_segments_get_segment_t1(whisper_vad_segments*,int) { return 3; }
inline void whisper_vad_free_segments(whisper_vad_segments*) {}
static std::mutex g_silero_cache_mtx;
inline whisper_vad_context* silero_vad_get_cached_locked(const char*,int) { return &ctx; }
struct crispasr_audio_slice { int start,end; int64_t t0_cs,t1_cs; };
enum class crispasr_vad_post_merge_policy { offline, streaming_json };
struct crispasr_vad_options {
 crispasr_vad_post_merge_policy post_merge_policy=crispasr_vad_post_merge_policy::offline;
 int stream_close_gap_ms=100;
 float threshold=0.5f; bool threshold_explicit=false;
 int min_speech_duration_ms=0,min_silence_duration_ms=0,speech_pad_ms=0,chunk_seconds=0,n_threads=1;
};
struct whisper_params {
 bool vad=true,strict_pipeline=true,require_vad=true,force_aligner=false,
      require_word_timestamps=false,require_punctuation=false,vad_threshold_explicit=false;
 float vad_threshold=0.5f;
 int vad_min_speech_duration_ms=0,vad_min_silence_duration_ms=0,vad_speech_pad_ms=0,n_threads=1;
 std::string vad_model="vad-fixture.bin",aligner_model,punc_model;
};
inline std::string crispasr_resolve_vad_model(const whisper_params& p) { return p.vad_model; }
inline std::vector<crispasr_audio_slice> crispasr_energy_chunk_slices(const float*,int,int,int) {
 ++fallback_calls; return {};
}
'''

MAIN = r'''
int main(int argc,char** argv) {
 if(argc!=4) return 2;
 fail_at=std::atoi(argv[1]); requested_device=argv[2];
 const std::string stage=argv[3];
 const std::vector<float> samples(3,0.5f);
 bool result=false,load_failed=false; int rc=0;
 if(stage=="detect") result=whisper_vad_detect_speech(&ctx,samples.data(),3);
 else if(stage=="segments") result=whisper_vad_segments_from_samples(&ctx,{},samples.data(),3)!=nullptr;
 else if(stage=="slices") {
  const auto slices=crispasr_compute_audio_slices(samples.data(),3,100,0,{},&load_failed);
  result=!slices.empty();
 } else if(stage=="strict") { rc=required_vad(samples,{}); result=rc==0; }
 else return 2;
 const auto positive=std::count_if(ctx.probs.begin(),ctx.probs.end(),[](float p){return p>0;});
 std::printf("result=%d cpu_calls=%d requested_chunks=3 positive_probs=%d segment_conversion_calls=%d scheduler_resets=%d load_failed=%d strict_rc=%d fallback_calls=%d\n",
             result,cpu_calls,(int)positive,segment_calls,resets,load_failed,rc,fallback_calls);
 const bool failed=fail_at>0;
 const bool valid=result==!failed && cpu_calls==(failed?fail_at:3) && resets==2 && fallback_calls==0 &&
   positive==(failed?fail_at-1:3) && segment_calls==((!failed && stage!="detect")?1:0) &&
   (stage!="slices" || load_failed==failed) && (stage!="strict" || rc==(failed?30:0));
 return valid ? rc : 1;
}
'''


def between(text, begin, end):
    assert text.count(begin) == 1, begin
    start = text.index(begin)
    finish = text.index(end, start) + len(end)
    return text[start:finish]


def check_vad_failure(source: Path, out: Path):
    native = (source / 'src/crispasr.cpp').read_text(encoding='utf-8')
    vad = (source / 'src/crispasr_vad.cpp').read_text(encoding='utf-8')
    cli = (source / 'examples/cli/crispasr_vad_cli.cpp').read_text(encoding='utf-8')
    run = (source / 'examples/cli/crispasr_run.cpp').read_text(encoding='utf-8')
    strict = (source / 'examples/cli/crispasr_strict.h').read_text(encoding='utf-8')
    extracts = {
        'detect': between(native, 'bool whisper_vad_detect_speech(', '\n}\n'),
        'caller': between(native, 'struct whisper_vad_segments* whisper_vad_segments_from_samples(', '\n}\n'),
        'silero': between(vad, '        std::lock_guard<std::mutex> vad_lock(g_silero_cache_mtx);',
                          '        // Do NOT free vctx — it\'s owned by the cache.\n    }'),
        'audio_slices': between(cli, 'std::vector<crispasr_audio_slice> crispasr_compute_audio_slices(', '\n}\n'),
        'requirements': between(strict, 'struct crispasr_strict_reqs {', '\n}\n'),
        'exit_codes': between(run, 'enum crispasr_strict_rc {', '\n};'),
        'strict_guard': between(run, '        bool vad_load_failed = false;\n        slices = crispasr_compute_audio_slices',
                                '            return CRISPASR_STRICT_RC_VAD;\n        }'),
    }
    # Exercise the exact Silero branch; post-merge/rechunk and other VAD models
    # are deliberately outside this error-path test (failure returns before them).
    library = '''std::vector<crispasr_audio_slice> crispasr_compute_vad_slices(
        const float* samples,int n_samples,int sample_rate,const char* vad_model_path,
        const crispasr_vad_options& opts,bool* out_load_failed) {
    std::vector<crispasr_audio_slice> slices;
    if(out_load_failed) *out_load_failed=false;
    {
''' + extracts['silero'] + '\n    return slices;\n}\n'
    guard = '''int required_vad(const std::vector<float>& samples,const whisper_params& params) {
    constexpr int SR=100,slice_chunk_seconds=0;
    const std::string fname_inp="fixture";
    std::vector<crispasr_audio_slice> slices;
''' + extracts['strict_guard'] + '\n    return 0;\n}\n'
    test = out / 'vad_failure_test.cpp'
    test.write_text(PREAMBLE + extracts['detect'] + extracts['caller'] + library + extracts['audio_slices'] +
                    extracts['requirements'] + extracts['exit_codes'] + guard + MAIN, encoding='utf-8')
    (out / 'vad-fixture.bin').write_bytes(b'local test fixture')
    subprocess.run(['cl', '/nologo', '/EHsc', '/std:c++17', '/utf-8', str(test),
                    '/Fe:' + str(out / 'vad_failure_test.exe')], cwd=out, check=True)
    rows = []
    for device in ['cpu', 'cuda', 'vad-only']:
        for stage in ['detect', 'segments', 'slices', 'strict']:
            for failure in [1, 2, 0]:
                result = subprocess.run([str(out / 'vad_failure_test.exe'), str(failure), device, stage],
                                        cwd=out, capture_output=True)
                name = f'vad-{device}-{stage}-{failure}'
                (out / (name + '.log')).write_bytes(result.stdout + result.stderr)
                expected = 30 if failure and stage == 'strict' else 0
                passed = (result.returncode == expected and
                          result.stderr.count(b'hikaru_vad: device=cpu chunks=3 completed=1') == (0 if failure else 1))
                rows.append({'case': name, 'exitCode': result.returncode, 'expectedExitCode': expected, 'passed': passed})
                print(f'{name}: {"PASS" if passed else "FAIL"} rc={result.returncode} expected={expected}')
    (out / 'vad-failure-result.json').write_text(json.dumps({
        'exactSourceSha256': {key: hashlib.sha256(value.encode('utf-8')).hexdigest() for key, value in extracts.items()},
        'modelRuns': 0, 'cases': rows,
    }, indent=2), encoding='utf-8')
    assert all(row['passed'] for row in rows), 'VAD compute failure/success contract'
