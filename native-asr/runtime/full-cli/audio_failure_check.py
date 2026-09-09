"""Exact upstream reader + real miniaudio WAV, bounded fallback-call stand-ins."""
from pathlib import Path
import subprocess
import wave


def check_audio_failure(source, output, reader_file=None):
    source, output = Path(source), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    text = Path(reader_file or source / 'examples/common-crispasr.cpp').read_text(encoding='utf8')
    start = text.index('bool read_audio_data(')
    end = text.index('\n//  500 ->', start)
    reader = text[start:end]  # complete, unmodified function; no branch reimplementation
    code = r'''
#define MA_NO_DEVICE_IO
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include "core/hikaru_qwen_device.h"
#include <vector>
#include <string>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <fcntl.h>
#include <io.h>
static int native_calls, subprocess_calls;
constexpr int CRISPASR_SAMPLE_RATE = 16000;
int crispasr_audio_load_stereo(const char*, float**, float**, int*, int*, int*) { ++native_calls; return -1; }
int crispasr_audio_load_at_rate(const char*, int, float**, int*, int*) { ++native_calls; return -1; }
void crispasr_audio_free(float*) {}
bool ffmpeg_subprocess_decode(const std::string&, std::vector<float>&) { ++subprocess_calls; return false; }
namespace core_audio {
std::vector<float> resample_polyphase(const float*, int, int, int) { std::abort(); }
}
''' + reader + r'''
int main(int argc, char** argv) {
    if (argc != 2) return 10;
    int checks = 0;
    for (const char* mode : {"cpu", "cuda", ""}) {
        _putenv_s("HIKARU_QWEN_DEVICE", mode);
        for (bool stereo : {false, true}) {
            for (bool valid : {false, true}) {
                native_calls = subprocess_calls = 0;
                std::vector<float> samples;
                std::vector<std::vector<float>> channels;
                bool ok = read_audio_data(valid ? argv[1] : "missing-audio-fixture.wav", samples, channels, stereo, 16000);
                if (ok != valid) return 11;
                const int fallback = !valid && !*mode ? 1 : 0;
                if (native_calls != fallback || subprocess_calls != fallback) return 12;
                if (valid && samples.size() != 16000) return 13;
                ++checks;
            }
        }
    }
    std::printf("PASS: %d exact-reader audio cases; controlled failures reach zero fallback calls\n", checks);
    return 0;
}
'''
    cpp = output / 'audio_failure_test.cpp'
    cpp.write_text(code, encoding='utf8')
    wav = output / 'valid.wav'
    with wave.open(str(wav), 'wb') as out:
        out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        out.writeframes(b'\0' * 32000)
    command = ['cl', '/nologo', '/std:c++17', '/EHsc', '/utf-8', '/O2',
               '/I' + str(source / 'examples'), '/I' + str(source / 'src'),
               '/I' + str(source / 'ggml/include'), str(cpp),
               '/Fe:' + str(output / 'audio_failure_test.exe'), 'ole32.lib']
    subprocess.run(command, cwd=output, check=True)
    subprocess.run([str(output / 'audio_failure_test.exe'), str(wav)], check=True)


if __name__ == '__main__':
    import sys
    check_audio_failure(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(),
                        Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else None)
