"""Focused pure-RNNT endpoint and exact PCM-support source check."""
import argparse
from pathlib import Path


def check(source):
    source = Path(source)
    if source.is_file():
        source = source.parent.parent
    parakeet = (source / 'src/parakeet.cpp').read_text(encoding='utf-8')
    backend = (source / 'examples/cli/crispasr_backend_parakeet.cpp').read_text(encoding='utf-8')
    run = (source / 'examples/cli/crispasr_run.cpp').read_text(encoding='utf-8')
    gap = (source / 'examples/cli/crispasr_gap_fill.h').read_text(encoding='utf-8')
    support = (source / 'examples/cli/hikaru_reazonspeech_pcm.h').read_text(encoding='utf-8')

    for old, new in (
        ('{c.token, parent.t, parent.t, c.tok_p}', '{c.token, parent.t, parent.t + 1, c.tok_p}'),
        ('{tok, t, t, (float)std::exp(new_score - h.score)}',
         '{tok, t, t + 1, (float)std::exp(new_score - h.score)}'),
        ('emitted.push_back({tok, t, t, tok_p});\n            if (has_hotwords)',
         'emitted.push_back({tok, t, t + 1, tok_p});\n            if (has_hotwords)'),
    ):
        assert old not in parakeet and parakeet.count(new) == 1, new
    for marker in (
        'emitted.push_back({tok, t, t_end, tok_p});',
        'nh.emitted.push_back({c.token, parent.t, t_end, c.tok_p});',
        'nh.emitted.push_back({ex.token, t, t_end, (float)std::exp(ex.new_score - h.score)});',
        'use_ctc ? parakeet_ctc_decode(ctx, enc_frames, T_enc, d_model)',
        'use_ctc ? parakeet_ctc_decode(ctx, enc_all.data(), T_enc_total, d_model)',
        'emitted.push_back({tok, t, t, tok_p});',
    ):
        assert parakeet.count(marker) == 1, marker

    assert 'int64_t start_sample = -1;' in support and 'int64_t end_sample = -1;' in support
    assert 'inline thread_local support current;' in support
    assert 'current = {start_sample, end_sample};' in support
    assert 'current = {};' in support
    assert run.count('hikaru_reazonspeech_pcm::set(ext_start, ext_end);\n        finish_slice(i, be.transcribe(samples.data() + ext_start, ext_end - ext_start, ext_t0_cs, params), be);') == 1
    assert gap.count('hikaru_reazonspeech_pcm::set(s0, s1);\n            auto fill = be.transcribe(samples + s0, s1 - s0, win0_cs, params);') == 1

    helper = backend[backend.index('static void intersect_exact_pcm_end'):backend.index('// ---- Split transcribe')]
    for marker in (
        'support.end_sample - support.start_sample != (int64_t)n_samples',
        'support_start_cs = (support.start_sample + kSamplesPerCs - 1) / kSamplesPerCs',
        'support_end_cs = support.end_sample / kSamplesPerCs',
        't1 = std::min(t1, support_end_cs);',
        't1 <= t0 || t1 > support_end_cs',
        'intersect(token.t1, token.t0',
        'intersect(word.t1, word.t0',
        'intersect(seg.t1, seg.t0',
    ):
        assert marker in helper, marker
    assert 't_offset_cs' not in helper
    assert 'parakeet_is_rnnt(ctx_)' in backend

    # 80 ms RNNT cell with only 50 ms of input: intersect inside the true PCM.
    def clipped(t0, t1, start, end):
        assert end > start
        lo, hi = (start + 159) // 160, end // 160
        assert start >= 0 and lo <= t0 < hi
        result = min(t1, hi)
        assert result > t0
        return result

    assert clipped(14, 18, 1600, 2400) == 15
    assert clipped(11, 18, 1640, 2480) == 15
    for args in ((15, 18, 1600, 2400), (10, 18, 1640, 2480)):
        try:
            clipped(*args)
        except AssertionError:
            pass
        else:
            raise AssertionError('invalid PCM interval accepted')
    print('PASS: exact parent/gap PCM support, partial RNNT cell, unchanged TDT/CTC')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    check(parser.parse_args().source.resolve())
