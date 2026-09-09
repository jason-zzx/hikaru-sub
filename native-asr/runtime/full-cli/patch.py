"""Exact-anchor device/error/output adaptations of the FULL v0.8.32 CLI.

No source lists, inference, tokenizer, LIS, windowing or grouping algorithms changed.
Apply once to a fresh tree made by prepare.py. Mismatched anchors fail closed.
"""
import argparse
from pathlib import Path
import shutil


def adapt(root):
    changes = {}

    def replace(file, old, new, count=1):
        text = changes.get(file, (root / file).read_text(encoding='utf-8'))
        if text.count(old) != count:
            raise ValueError(f'upstream anchor mismatch: {file}')
        changes[file] = text.replace(old, new)

    # Separate model-free prelaunch capability; bypass all model/CLI acquisition.
    replace('examples/cli/cli.cpp', '    whisper_params params;',
            '''    if (argc == 2 && !std::strcmp(argv[1], "--hikaru-probe-cuda"))
        return hikaru_qwen::probe_cuda();
    whisper_params params;''')
    changes['examples/cli/cli.cpp'] = '#include "hikaru_cuda_probe.h"\n' + changes['examples/cli/cli.cpp']

    # The application supplies verified PCM WAV. In controlled mode an audio
    # decode failure must not enter another decoder or a shell FFmpeg process.
    replace('examples/common-crispasr.cpp',
            '        // Container miniaudio can\'t open (.opus / .aac / .m4a / .webm / .amr / …):',
            '''        if (hikaru_qwen::device()) {
            fprintf(stderr, "hikaru_error: audio_decode_failed\\n");
            return false;
        }
        // Container miniaudio can't open (.opus / .aac / .m4a / .webm / .amr / …):''')
    changes['examples/common-crispasr.cpp'] = '#include "core/hikaru_qwen_device.h"\n' + changes['examples/common-crispasr.cpp']

    # Controlled mode only accepts explicit local models. No registry/cache
    # substitution or download when a UTF-8 path is missing/unreadable.
    replace('examples/cli/crispasr_model_mgr_cli.cpp',
            'const std::string& preferred_quant, const std::string& accepted_license) {\n    std::string effective_model_arg = model_arg;',
            '''const std::string& preferred_quant, const std::string& accepted_license) {
    if (hikaru_qwen::device()) {
        if (!hikaru_qwen::local_file(model_arg)) hikaru_qwen::fail("explicit_model_unreadable");
        return model_arg;
    }
    std::string effective_model_arg = model_arg;''')
    changes['examples/cli/crispasr_model_mgr_cli.cpp'] = '#include "core/hikaru_qwen_device.h"\n' + changes['examples/cli/crispasr_model_mgr_cli.cpp']
    replace('examples/cli/crispasr_vad_cli.cpp', '        if (!slices.empty())\n            return slices;',
            '        if (!slices.empty() || (hikaru_qwen::device() && !load_failed))\n            return slices;')
    changes['examples/cli/crispasr_vad_cli.cpp'] = '#include "core/hikaru_qwen_device.h"\n' + changes['examples/cli/crispasr_vad_cli.cpp']
    replace('examples/cli/cli.cpp', '''    if (whisper_params_parse(argc, argv, params) == false) {
        whisper_print_usage(argc, argv, params, stderr);
        return 1;
    }
''', '''    if (whisper_params_parse(argc, argv, params) == false) {
        whisper_print_usage(argc, argv, params, stderr);
        return 1;
    }
    if (hikaru_qwen::device()) {
        if (!hikaru_qwen::local_file(params.model) || !hikaru_qwen::local_file(params.aligner_model))
            hikaru_qwen::fail("explicit_model_unreadable");
        if (!params.vad || !hikaru_qwen::local_file(params.vad_model)) {
            fprintf(stderr, "hikaru_error: VAD_unreadable\\n");
            return 30;
        }
    }
''')
    replace('src/crispasr_cache.cpp',
            'const char* pretty_label, const std::string& cache_dir_override) {',
            '''const char* pretty_label, const std::string& cache_dir_override) {
    if (hikaru_qwen::device()) hikaru_qwen::fail("model_download_forbidden");''')
    changes['src/crispasr_cache.cpp'] = '#include "core/hikaru_qwen_device.h"\n' + changes['src/crispasr_cache.cpp']
    # Shared loader is used by ASR, ForcedAligner and lazy audio. Its GGUF
    # metadata already uses ggml_fopen; mmap/fread must use the same UTF-8 contract.
    replace('src/core/gguf_loader.cpp',
            '        HANDLE hFile = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);',
            '''        const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, nullptr, 0);
        if (length <= 0) return;
        std::wstring wide((size_t)length, wchar_t(0));
        if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, &wide[0], length)) return;
        HANDLE hFile = CreateFileW(wide.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);''')
    replace('src/core/gguf_loader.cpp', 'FILE* fp = fopen(path, "rb");', 'FILE* fp = ggml_fopen(path, "rb");', 2)
    replace('examples/common.cpp', '    std::ifstream infile(filename);',
            '    std::ifstream infile(std::filesystem::u8path(filename));')
    changes['examples/common.cpp'] = '#include <filesystem>\n' + changes['examples/common.cpp']
    replace('src/qwen3_asr.cpp', '#include "core/gpu_backend_pref.h"',
            '#include "core/hikaru_qwen_device.h"\n#include "core/gpu_backend_pref.h"')
    replace('src/qwen3_asr.cpp', '    ctx->backend = params.use_gpu ? crispasr_init_gpu_backend() : core_cpu_backend::init();',
            '''    if (hikaru_qwen::device() && params.use_gpu != hikaru_qwen::cuda())
        hikaru_qwen::fail("requested_device_mismatch");
    ctx->backend = params.use_gpu ? crispasr_init_gpu_backend() : core_cpu_backend::init();
    hikaru_qwen::backend(ctx->backend, params.use_gpu, "qwen");''')
    # The shared upstream GPU helper must not get as far as its CPU fallback.
    replace('src/core/gpu_backend_pref.h', '#include "ggml-backend.h"',
            '#include "hikaru_qwen_device.h"\n#include "ggml-backend.h"')
    replace('src/core/gpu_backend_pref.h', '    return ggml_backend_init_best();',
            '    if (hikaru_qwen::device()) hikaru_qwen::fail("cuda_unavailable");\n    return ggml_backend_init_best();')
    replace('src/qwen3_asr.cpp', '    model.buf_cpu = wl.buf_cpu;',
            '''    model.buf_cpu = wl.buf_cpu;
    hikaru_qwen::buffer(model.buf);
    hikaru_qwen::buffer(model.buf_cpu);''')
    # Include must precede weight-loading and lazy-audio functions too.
    replace('src/qwen3_asr.cpp', '#include "core/hikaru_qwen_device.h"\n', '')
    changes['src/qwen3_asr.cpp'] = '#include "core/hikaru_qwen_device.h"\n' + changes['src/qwen3_asr.cpp']
    replace('src/qwen3_asr.cpp', '    ctx->kv_buf = ggml_backend_alloc_ctx_tensors(ctx->kv_ctx, kv_backend);',
            '    ctx->kv_buf = ggml_backend_alloc_ctx_tensors(ctx->kv_ctx, kv_backend);\n    hikaru_qwen::buffer(ctx->kv_buf);')
    replace('src/qwen3_asr.cpp', '    ctx->audio_ca = crisp_audio_init_from_file(ctx->model_path.c_str(), &p);',
            '''    ctx->audio_ca = crisp_audio_init_from_file(ctx->model_path.c_str(), &p);
    if (hikaru_qwen::device() && !ctx->audio_ca) hikaru_qwen::fail("lazy_audio_load_failed");''')
    replace('src/qwen3_asr.cpp', 'ggml_backend_sched_graph_compute(ctx->sched, gf)',
            'hikaru_qwen::compute(ctx->sched, gf, qwen3_asr_lm_head_dim(ctx) <= 10000 ? "aligner" : "asr")', 7)
    # Cached aligner context must follow the same process-scoped concrete device.
    replace('src/crispasr_aligner.cpp', '#include "crispasr_aligner.h"',
            '#include "core/hikaru_qwen_device.h"\n#include "crispasr_aligner.h"')
    replace('src/crispasr_aligner.cpp', '        cp.n_threads = n_threads;\n        cp.verbosity = 0;',
            '''        cp.n_threads = n_threads;
        cp.verbosity = 0;
        if (hikaru_qwen::device()) cp.use_gpu = hikaru_qwen::cuda();''')
    replace('crisp_audio/src/audio_tower.cpp', '    // Backend selection — GPU if requested + available, fall back to CPU.',
            '''    if (hikaru_qwen::device() && eff.use_gpu != hikaru_qwen::cuda())
        hikaru_qwen::fail("lazy_audio_device_mismatch");
    // Backend selection — GPU if requested + available, fall back to CPU.''')
    replace('crisp_audio/src/audio_tower.cpp', '    if (!ctx->backend) {\n        ctx->backend = core_cpu_backend::init();',
            '''    if (hikaru_qwen::device() && eff.use_gpu && !ctx->backend)
        hikaru_qwen::fail("lazy_audio_cuda_unavailable");
    if (!ctx->backend) {
        ctx->backend = core_cpu_backend::init();''')
    replace('crisp_audio/src/audio_tower.cpp', '    if (!load_model(*ctx, gguf_path, eff)) {',
            '''    hikaru_qwen::backend(ctx->backend, eff.use_gpu, "lazy-audio");
    if (!load_model(*ctx, gguf_path, eff)) {''')
    replace('crisp_audio/src/audio_tower.cpp', '    ctx.model_buf = wl.buf;',
            '    ctx.model_buf = wl.buf;\n    hikaru_qwen::buffer(ctx.model_buf);')
    replace('crisp_audio/src/audio_tower.cpp', 'ggml_backend_sched_graph_compute(ctx->sched, gf)',
            'hikaru_qwen::compute(ctx->sched, gf, "lazy-audio")')
    changes['crisp_audio/src/audio_tower.cpp'] = '#include "../../src/core/hikaru_qwen_device.h"\n' + changes['crisp_audio/src/audio_tower.cpp']
    # Silero already uses CPU direct planned graphs upstream. Attest that actual
    # path and distinguish detect failure (nullptr) from a successful empty list.
    replace('src/crispasr_vad.cpp', '        const int nv = vseg ? whisper_vad_segments_n_segments(vseg) : 0;',
            '''        if (!vseg) {
            if (out_load_failed) *out_load_failed = true;
            return slices;
        }
        const int nv = whisper_vad_segments_n_segments(vseg);''')
    replace('src/crispasr.cpp', '    vctx->backends = whisper_backend_init(whisper_context_params);',
            '''    vctx->backends = whisper_backend_init(whisper_context_params);
    for (auto backend : vctx->backends) hikaru_qwen::backend(backend, false, "vad");''')
    # A failed chunk must not convert zero/partial probabilities into segments
    # or reach the success marker. Release the allocated scheduler on this exit.
    replace('src/crispasr.cpp',
            '''        if (core_cpu_backend::compute_planned(gf, &cplan, 1) != GGML_STATUS_SUCCESS) {
            CRISPASR_LOG_ERROR("%s: failed to compute VAD graph\\n", __func__);
            break;
        }''',
            '''        if (core_cpu_backend::compute_planned(gf, &cplan, 1) != GGML_STATUS_SUCCESS) {
            CRISPASR_LOG_ERROR("%s: failed to compute VAD graph\\n", __func__);
            ggml_backend_sched_reset(sched);
            return false;
        }''')
    replace('src/crispasr.cpp', '    const int64_t t_this_vad = ggml_time_us() - t_start_vad_us;',
            '''    if (hikaru_qwen::device())
        fprintf(stderr, "hikaru_vad: device=cpu chunks=%d completed=1\\n", n_chunks);
    const int64_t t_this_vad = ggml_time_us() - t_start_vad_us;''')
    changes['src/crispasr.cpp'] = '#include "core/hikaru_qwen_device.h"\n' + changes['src/crispasr.cpp']

    # Mark the exact fallback branch, without changing its grouping algorithm.
    replace('examples/cli/crispasr_output.h', 'int max_len, bool split_on_punct = false);',
            'int max_len, bool split_on_punct = false, bool* used_fallback = nullptr);')
    replace('examples/cli/crispasr_output.cpp', 'int max_len, bool split_on_punct) {\n    std::vector<crispasr_disp_segment> out;',
            '''int max_len, bool split_on_punct, bool* used_fallback) {
    if (used_fallback) *used_fallback = false;
    std::vector<crispasr_disp_segment> out;''')
    replace('examples/cli/crispasr_output.cpp', '            // No usable word timings. When max_len <= 0, keep the historical',
            '''            if (used_fallback) *used_fallback = true;
            // No usable word timings. When max_len <= 0, keep the historical''')
    replace('examples/cli/crispasr_output.h', 'bool full, const crispasr_lid_info* lid = nullptr);',
            '''bool full, const crispasr_lid_info* lid = nullptr,
                         const std::vector<crispasr_disp_segment>* display = nullptr,
                         bool display_fallback = false, bool vad_silence = false);''')
    replace('examples/cli/crispasr_output.cpp', 'bool full, const crispasr_lid_info* lid) {\n    std::ofstream f(path);',
            '''bool full, const crispasr_lid_info* lid,
                         const std::vector<crispasr_disp_segment>* display,
                         bool display_fallback, bool vad_silence) {
    std::ofstream f(std::filesystem::u8path(path), std::ios::binary);''')
    changes['examples/cli/crispasr_output.cpp'] = '#include <filesystem>\n' + changes['examples/cli/crispasr_output.cpp']
    replace('examples/cli/crispasr_output.cpp', '    f << "  ]\\n";\n    f << "}\\n";\n    return true;',
            '''    f << "  ]";
    if (display) {
        f << ",\\n  \\"displayFallback\\": " << (display_fallback ? "true" : "false");
        f << ",\\n  \\"vadSilence\\": " << (vad_silence ? "true" : "false");
        f << ",\\n  \\"displaySegments\\": [";
        for (size_t i = 0; i < display->size(); ++i) {
            const auto& s = (*display)[i];
            f << (i ? "," : "") << "\\n    {\\"startMs\\":" << s.t0 * 10
              << ",\\"endMs\\":" << s.t1 * 10 << ",\\"text\\":\\"" << json_escape(s.text) << "\\"}";
        }
        f << "\\n  ]";
    }
    f << "\\n}\\n";
    f.flush();
    return bool(f);''')
    # Individual BPE tokens can be partial UTF-8 byte sequences. They are not
    # display text and must not corrupt the complete machine-readable document.
    replace('examples/cli/crispasr_output.cpp', 'if (full && !s.tokens.empty()) {',
            'if (full && !display && !s.tokens.empty()) {')
    # Active per-slice dispatcher, NOT the stale #if 0 block near line 5136.
    replace('examples/cli/crispasr_run.cpp',
            '    const auto disp = crispasr_make_disp_segments(all_segs, params.max_len, params.split_on_punct);\n\n    const bool show_timestamps',
            '''    bool display_fallback = false;
    const auto disp = crispasr_make_disp_segments(all_segs, params.max_len, params.split_on_punct, &display_fallback);

    const bool show_timestamps''')
    replace('examples/cli/crispasr_run.cpp',
            '''    if (params.output_jsn)
        crispasr_write_json(out_path(".json"), all_segs, backend.name(), params.model, params.language,
                            params.output_jsn_full, lid_info.lang_code.empty() ? nullptr : &lid_info);''',
            '''    if (params.output_jsn &&
        !crispasr_write_json(out_path(".json"), all_segs, backend.name(), params.model, params.language,
                            params.output_jsn_full, lid_info.lang_code.empty() ? nullptr : &lid_info,
                            hikaru_qwen::device() ? &disp : nullptr, display_fallback, false)) return 42;
    if (hikaru_qwen::device() && display_fallback) return 41;''')
    replace('examples/cli/crispasr_run.cpp',
            '''        fprintf(stderr, "crispasr: warning: no speech detected in '%s'\\n", fname_inp.c_str());
        return 0;''',
            '''        fprintf(stderr, "crispasr: warning: no speech detected in '%s'\\n", fname_inp.c_str());
        const std::vector<crispasr_disp_segment> empty_display;
        if (hikaru_qwen::device() && params.output_jsn &&
            !crispasr_write_json(out_path(".json"), {}, backend.name(), params.model, params.language,
                                params.output_jsn_full, nullptr, &empty_display, false, true)) return 42;
        return 0;''')
    changes['examples/cli/crispasr_run.cpp'] = '#include "core/hikaru_qwen_device.h"\n' + changes['examples/cli/crispasr_run.cpp']
    for file, content in changes.items():
        (root / file).write_text(content, encoding='utf-8', newline='\n')
    shutil.copyfile(Path(__file__).with_name('hikaru_qwen_device.h'), root / 'src/core/hikaru_qwen_device.h')
    shutil.copyfile(Path(__file__).with_name('hikaru_cuda_probe.h'), root / 'examples/cli/hikaru_cuda_probe.h')
    return sorted(changes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    print('\n'.join(adapt(args.source.resolve())))
