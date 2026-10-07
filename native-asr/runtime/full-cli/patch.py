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
        if (hikaru_qwen::vad_only() &&
            (!params.vad_export_raw || params.vad_export_file.empty() || params.fname_inp.size() != 1 ||
             params.use_gpu || params.gpu_backend != "cpu"))
            hikaru_qwen::fail("vad_only_route_mismatch");
        if (!hikaru_qwen::vad_only() && (!hikaru_qwen::local_file(params.model) ||
            (!hikaru_qwen::parakeet_family() && !hikaru_qwen::local_file(params.aligner_model))))
            hikaru_qwen::fail("explicit_model_unreadable");
        if (hikaru_qwen::parakeet() && (params.backend != "parakeet" || !params.aligner_model.empty()))
            hikaru_qwen::fail("parakeet_route_mismatch");
        if (hikaru_qwen::reazonspeech() && (params.backend != "reazonspeech" || !params.aligner_model.empty()))
            hikaru_qwen::fail("reazonspeech_route_mismatch");
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
    # Only standalone CPU export bypasses offline short/gap merging.
    replace('examples/cli/crispasr_vad_cli.cpp', '        opts.chunk_seconds = chunk_seconds;',
            '''        if (hikaru_qwen::vad_only()) {
            opts.post_merge_policy = crispasr_vad_post_merge_policy::streaming_json;
            opts.stream_close_gap_ms = 0;
        }
        opts.chunk_seconds = chunk_seconds;''')
    replace('src/crispasr.cpp', '        ggml_backend_tensor_get(prob, &vctx->probs[i], 0, sizeof(float));',
            '''        ggml_backend_tensor_get(prob, &vctx->probs[i], 0, sizeof(float));
        if (hikaru_qwen::vad_only())
            fprintf(stderr, "hikaru_vad_progress: completed=%d total=%d\\n", i + 1, n_chunks);''')
    replace('examples/cli/crispasr_run.cpp',
            '            std::ofstream out(export_path, std::ios::binary | std::ios::trunc);',
            '            std::ofstream out(std::filesystem::u8path(export_path), std::ios::binary | std::ios::trunc);')
    replace('examples/cli/crispasr_run.cpp',
            '                out << crispasr_serialize_vad_slices(slices, SR, slice_chunk, params.vad_export_raw);',
            '''                out << crispasr_serialize_vad_slices(slices, SR, slice_chunk, params.vad_export_raw);
                if (hikaru_qwen::vad_only()) {
                    out.close();
                    if (!out) return 42;
                }''')
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

    # Parakeet uses the selected encoder scheduler, native CPU TDT loops on
    # CPU, and persistent single-backend predictor/joint graphs on CUDA.
    # Observe these real dispatches; do not move operations or change decoding.
    changes['src/parakeet.cpp'] = '#include "core/hikaru_qwen_device.h"\n' + (root / 'src/parakeet.cpp').read_text(encoding='utf-8')
    replace('src/parakeet.cpp', '    ctx->backend = pick_backend(params.use_gpu);',
            '''    if (hikaru_qwen::parakeet_family() && params.use_gpu != hikaru_qwen::cuda())
        hikaru_qwen::fail("parakeet_requested_device_mismatch");
    ctx->backend = pick_backend(params.use_gpu);
    if (hikaru_qwen::parakeet_family()) hikaru_qwen::backend(ctx->backend, params.use_gpu, "parakeet");''')
    replace('src/parakeet.cpp', '    model.buf = wl.buf;',
            '    model.buf = wl.buf;\n    if (hikaru_qwen::parakeet_family()) hikaru_qwen::buffer(model.buf);')
    replace('src/parakeet.h', 'bool parakeet_has_ctc(struct parakeet_context* ctx);',
            'bool parakeet_has_ctc(struct parakeet_context* ctx);\nbool parakeet_is_rnnt(struct parakeet_context* ctx);')
    replace('src/parakeet.cpp', '''extern "C" bool parakeet_has_ctc(struct parakeet_context* ctx) {
    return ctx && ctx->model.has_ctc;
}''', '''extern "C" bool parakeet_has_ctc(struct parakeet_context* ctx) {
    return ctx && ctx->model.has_ctc;
}

extern "C" bool parakeet_is_rnnt(struct parakeet_context* ctx) {
    return ctx && ctx->model.hparams.n_tdt_durations == 0;
}''')
    replace('src/parakeet.cpp', '    parakeet_fold_batchnorm(ctx->model, ctx->backend);',
            '''    parakeet_fold_batchnorm(ctx->model, ctx->backend);
    if (hikaru_qwen::parakeet_family()) {
        hikaru_qwen::buffer(ctx->model.buf_f32);
        fprintf(stderr, "hikaru_stage: parakeet_model_loaded\\n");
    }''')
    # Every single-pass, later slice, gap retranscription and streamed window
    # reaches this allocator. Fail before an empty result can trigger retry or
    # be merged with earlier successful text; keep uncontrolled upstream return.
    replace('src/parakeet.cpp', '        fprintf(stderr, "parakeet: failed to alloc encoder graph\\n");',
            '''        if (hikaru_qwen::parakeet_family()) hikaru_qwen::fail("parakeet_encoder_allocation_failed");
        fprintf(stderr, "parakeet: failed to alloc encoder graph\\n");''')
    replace('src/parakeet.cpp', 'ggml_backend_sched_graph_compute(ctx->sched, gf)',
            'hikaru_qwen::compute(ctx->sched, gf, "parakeet-encoder")', 2)
    replace('src/parakeet.cpp', '    return ggml_dec;',
            '''    if (hikaru_qwen::parakeet_family() && ggml_dec != hikaru_qwen::cuda())
        hikaru_qwen::fail("parakeet_decoder_device_mismatch");
    return ggml_dec;''', 2)
    # The default persistent decoder ignores allocation failure upstream. In
    # controlled mode fail before any partial graph can be used or retried.
    for graph, allocator in [('pgf', 'palloc'), ('jgf', 'jalloc')]:
        replace('src/core/rnnt_ggml.h',
                f'    if (!ggml_gallocr_alloc_graph(d.{allocator}, d.{graph}))\n        return false;',
                f'''    if (!ggml_gallocr_alloc_graph(d.{allocator}, d.{graph})) {{
        if (hikaru_qwen::parakeet_family()) hikaru_qwen::fail("parakeet_decoder_allocation_failed");
        return false;
    }}''')
    replace('src/core/rnnt_ggml.h', '#include "ggml-backend.h"',
            '#include "hikaru_qwen_device.h"\n#include "ggml-backend.h"')
    replace('src/core/rnnt_ggml.h', '    ggml_backend_sched_graph_compute(sched, gf);',
            '    hikaru_qwen::compute(sched, gf, "parakeet-decoder-perstep");', 2)
    for graph, role in [('pgf', 'parakeet-predictor'), ('jgf', 'parakeet-joint')]:
        replace('src/core/rnnt_ggml.h', f'    ggml_backend_graph_compute(d.backend, d.{graph});',
                f'    hikaru_qwen::direct_compute(d.backend, d.{graph}, "{role}");')
    # NeMo standard pure-RNNT timestamps are half-open encoder-cell intervals.
    # Change only the three pure-RNNT nonblank emission seams; TDT/CTC timing,
    # decoder decisions and all frame/search advancement remain untouched.
    replace('src/parakeet.cpp',
            'nh.emitted.push_back({c.token, parent.t, parent.t, c.tok_p});',
            'nh.emitted.push_back({c.token, parent.t, parent.t + 1, c.tok_p});')
    replace('src/parakeet.cpp',
            'nh.emitted.push_back({tok, t, t, (float)std::exp(new_score - h.score)});',
            'nh.emitted.push_back({tok, t, t + 1, (float)std::exp(new_score - h.score)});')
    replace('src/parakeet.cpp', '''            emitted.push_back({tok, t, t, tok_p});
            if (has_hotwords)
                core_context_bias::advance(ctx->hotword_trie, hw_state, tok);''', '''            emitted.push_back({tok, t, t + 1, tok_p});
            if (has_hotwords)
                core_context_bias::advance(ctx->hotword_trie, hw_state, tok);''')

    # The decoder grid may include a padded final cell beyond the PCM supplied
    # to one concrete parent or gap invocation. Carry that invocation's exact
    # sample range to the Reazon adapter; never reconstruct it from t_offset_cs.
    changes['examples/cli/hikaru_reazonspeech_pcm.h'] = '''#pragma once

#include <cstdint>

namespace hikaru_reazonspeech_pcm {
struct support {
    int64_t start_sample = -1;
    int64_t end_sample = -1;
};
inline thread_local support current;
inline void set(int64_t start_sample, int64_t end_sample) { current = {start_sample, end_sample}; }
inline support take() {
    const support value = current;
    current = {};
    return value;
}
} // namespace hikaru_reazonspeech_pcm
'''
    replace('examples/cli/crispasr_backend_parakeet.cpp',
            '''        apply_sticky_params(params);

        // Issue #89 / #257: long-audio path selection,''',
            '''        const auto pcm_support = hikaru_reazonspeech_pcm::take();
        apply_sticky_params(params);

        // Issue #89 / #257: long-audio path selection,''')
    replace('examples/cli/crispasr_backend_parakeet.cpp',
            '''        for (const auto& ps : parakeet_transcribe_segments(ctx_, samples, n_samples, t_offset_cs, is_ja_model_, oo))
            out.push_back(seg_from_parakeet_seg(ps));
        return out;
    }

    // ---- Split transcribe: encode ∥ decode across dispatcher slices ----''',
            '''        auto segments = parakeet_transcribe_segments(ctx_, samples, n_samples, t_offset_cs, is_ja_model_, oo);
        if (hikaru_qwen::reazonspeech() && parakeet_is_rnnt(ctx_))
            intersect_exact_pcm_end(segments, n_samples, pcm_support);
        for (const auto& ps : segments)
            out.push_back(seg_from_parakeet_seg(ps));
        return out;
    }

    static void intersect_exact_pcm_end(std::vector<parakeet_seg>& segments, int n_samples,
                                        const hikaru_reazonspeech_pcm::support& support) {
        constexpr int64_t kSamplesPerCs = 160;
        if (support.start_sample < 0 || support.end_sample <= support.start_sample ||
            support.end_sample - support.start_sample != (int64_t)n_samples)
            hikaru_qwen::fail("reazonspeech_pcm_support_invalid");

        // Timestamps are whole centiseconds. Conservatively use only complete
        // boundaries inside the exact PCM support; never round outside it.
        const int64_t support_start_cs = (support.start_sample + kSamplesPerCs - 1) / kSamplesPerCs;
        const int64_t support_end_cs = support.end_sample / kSamplesPerCs;
        auto intersect = [&](int64_t& t1, int64_t t0, const char* code) {
            if (t0 < support_start_cs || t0 >= support_end_cs)
                hikaru_qwen::fail(code);
            t1 = std::min(t1, support_end_cs);
            if (t1 <= t0 || t1 > support_end_cs)
                hikaru_qwen::fail(code);
        };
        for (auto& seg : segments) {
            for (auto& token : seg.tokens)
                intersect(token.t1, token.t0, "reazonspeech_token_pcm_intersection_invalid");
            for (auto& word : seg.words)
                intersect(word.t1, word.t0, "reazonspeech_word_pcm_intersection_invalid");
            if (!seg.text.empty() || !seg.words.empty() || !seg.tokens.empty())
                intersect(seg.t1, seg.t0, "reazonspeech_segment_pcm_intersection_invalid");
        }
    }

    // ---- Split transcribe: encode ∥ decode across dispatcher slices ----''')

    # CPU manual TDT execution evidence belongs after the real decode, including
    # the upstream host projection/argmax work common to CPU and CUDA.
    replace('src/parakeet.cpp', '    if (time_dec) {\n        auto _dt1 = std::chrono::steady_clock::now();',
            '''    if (hikaru_qwen::parakeet())
        fprintf(stderr, "hikaru_tdt: decoder=%s host_projection=cpu frames=%d steps=%d completed=1\\n",
                ggml_dec ? "cuda" : "cpu", T_enc, total_steps);
    if (time_dec) {
        auto _dt1 = std::chrono::steady_clock::now();''')
    replace('src/parakeet.cpp', '''    int t = 0;
    while (t < T_enc) {
        joint_proj_enc(J, enc + (size_t)t * d_model, proj_e);

        int n_inner = 0;
        while (n_inner < max_per_step) {
            if (ggml_dec)''', '''    int t = 0;
    int total_steps = 0;
    while (t < T_enc) {
        joint_proj_enc(J, enc + (size_t)t * d_model, proj_e);

        int n_inner = 0;
        while (n_inner < max_per_step) {
            total_steps++;
            if (ggml_dec)''')
    replace('src/parakeet.cpp', '''        if (n_inner >= max_per_step)
            t++;
    }

    return emitted;
}

// ===========================================================================
// CTC greedy decode''', '''        if (n_inner >= max_per_step)
            t++;
    }

    if (hikaru_qwen::reazonspeech())
        fprintf(stderr, "hikaru_rnnt: decoder=%s host_projection=cpu frames=%d steps=%d completed=1\\n",
                ggml_dec ? "cuda" : "cpu", T_enc, total_steps);
    return emitted;
}

// ===========================================================================
// CTC greedy decode''')
    replace('examples/cli/crispasr_backend_parakeet.cpp',
            '        is_ja_model_ = parakeet_vocab_is_japanese(ctx_) != 0;',
            '''        is_ja_model_ = parakeet_vocab_is_japanese(ctx_) != 0;
        if (hikaru_qwen::parakeet() && (!is_ja_model_ || !p.parakeet_decoder.empty()))
            hikaru_qwen::fail("parakeet_japanese_tdt_required");
        if (hikaru_qwen::reazonspeech() && (!is_ja_model_ || !parakeet_is_rnnt(ctx_) || !p.parakeet_decoder.empty()))
            hikaru_qwen::fail("reazonspeech_japanese_rnnt_required");''')
    changes['examples/cli/crispasr_backend_parakeet.cpp'] = ('#include "core/hikaru_qwen_device.h"\n'
        '#include "hikaru_reazonspeech_pcm.h"\n' + changes['examples/cli/crispasr_backend_parakeet.cpp'])
    replace('examples/cli/crispasr_run.cpp',
            '''        slice_ext_range(i, ext_start, ext_end, ext_t0_cs);
        finish_slice(i, be.transcribe(samples.data() + ext_start, ext_end - ext_start, ext_t0_cs, params), be);''',
            '''        slice_ext_range(i, ext_start, ext_end, ext_t0_cs);
        hikaru_reazonspeech_pcm::set(ext_start, ext_end);
        finish_slice(i, be.transcribe(samples.data() + ext_start, ext_end - ext_start, ext_t0_cs, params), be);''')
    replace('examples/cli/crispasr_gap_fill.h',
            '''            if (s1 - s0 < sample_rate / 4)
                continue;
            auto fill = be.transcribe(samples + s0, s1 - s0, win0_cs, params);''',
            '''            if (s1 - s0 < sample_rate / 4)
                continue;
            hikaru_reazonspeech_pcm::set(s0, s1);
            auto fill = be.transcribe(samples + s0, s1 - s0, win0_cs, params);''')
    replace('examples/cli/crispasr_gap_fill.h', '#include "crispasr_vad.h"',
            '#include "crispasr_vad.h"\n#include "hikaru_reazonspeech_pcm.h"')
    replace('examples/cli/crispasr_run.cpp', '        per_slice[i] = std::move(segs);',
            '''        per_slice[i] = std::move(segs);
        if (hikaru_qwen::parakeet_family())
            fprintf(stderr, "hikaru_slice: completed=%zu total=%zu\\n", i + 1, slices.size());''')

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
    changes['examples/cli/crispasr_run.cpp'] = ('#include "core/hikaru_qwen_device.h"\n'
        '#include "hikaru_reazonspeech_pcm.h"\n' + changes['examples/cli/crispasr_run.cpp'])
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
