#pragma once
// Process-scoped policy for the controlled one-file CLI invocation, not a new ABI.
#include "ggml.h"
#include "ggml-backend.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>

namespace hikaru_qwen {
inline bool parakeet() { return std::getenv("HIKARU_PARAKEET_DEVICE") != nullptr; }
inline const char* device() {
    const char* value = std::getenv("HIKARU_QWEN_DEVICE");
    if (parakeet()) {
        if (value) {
            std::fprintf(stderr, "hikaru_error: conflicting_device_controls\n");
            std::exit(40);
        }
        value = std::getenv("HIKARU_PARAKEET_DEVICE");
    }
    if (value && std::strcmp(value, "cpu") && std::strcmp(value, "cuda")) {
        std::fprintf(stderr, "hikaru_error: invalid_device\n");
        std::exit(40);
    }
    return value;
}
inline bool local_file(const std::string& path) {
    try {
        const auto file = std::filesystem::u8path(path);
        std::error_code error;
        if (!file.is_absolute() || !std::filesystem::is_regular_file(file, error) || error) return false;
        std::ifstream input(file, std::ios::binary);
        return input.good() && input.peek() != std::char_traits<char>::eof();
    } catch (...) { return false; }
}
inline bool cuda() { return device() && !std::strcmp(device(), "cuda"); }
[[noreturn]] inline void fail(const char* code) {
    std::fprintf(stderr, "hikaru_error: %s\n", code);
    std::exit(40);
}
inline bool matches(ggml_backend_dev_t dev, bool gpu) {
    if (!dev) return false;
    if (!gpu) return ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_CPU;
    auto reg = ggml_backend_dev_backend_reg(dev);
    return ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_GPU && reg &&
           !std::strcmp(ggml_backend_reg_name(reg), "CUDA");
}
inline void backend(ggml_backend_t value, bool requested_gpu, const char* role) {
    if (!device()) return;
    if (!value || !matches(ggml_backend_get_device(value), requested_gpu)) fail("device_unavailable");
    std::fprintf(stderr, "hikaru_device: role=%s device=%s\n", role, requested_gpu ? "cuda" : "cpu");
}
inline void buffer(ggml_backend_buffer_t value) {
    if (!device() || !value) return;
    // Upstream mmap weight buffers are host buffers without a registry device.
    // They are legal for CPU only; CUDA must own a real CUDA device buffer.
    if (!cuda() && ggml_backend_buffer_is_host(value)) return;
    if (!matches(ggml_backend_buft_get_device(ggml_backend_buffer_get_type(value)), cuda()))
        fail("weight_or_kv_device_mismatch");
}
inline ggml_status compute(ggml_backend_sched_t sched, ggml_cgraph* graph, const char* role) {
    // Call sites already allocated this exact graph. Check the scheduler's actual
    // assignment, including view nodes, BEFORE execution. Never move graph nodes.
    if (device()) {
        for (int i = 0; i < ggml_graph_n_nodes(graph); ++i) {
            auto assigned = ggml_backend_sched_get_tensor_backend(sched, ggml_graph_node(graph, i));
            if (!assigned || !matches(ggml_backend_get_device(assigned), cuda())) fail("graph_device_mismatch");
        }
    }
    auto status = ggml_backend_sched_graph_compute(sched, graph);
    if (device()) {
        if (status != GGML_STATUS_SUCCESS) fail("graph_compute_failed");
        std::fprintf(stderr, "hikaru_graph: role=%s device=%s nodes=%d other=0\n",
                     role, cuda() ? "cuda" : "cpu", ggml_graph_n_nodes(graph));
    }
    return status;
}
// Parakeet's persistent predictor/joint graphs use a single direct backend,
// not the encoder scheduler. Host state/readback/encoder projection remain
// upstream CPU operations; this attests the actual graph dispatch, not those.
inline ggml_status direct_compute(ggml_backend_t selected, ggml_cgraph* graph, const char* role) {
    if (parakeet() && (!selected || !matches(ggml_backend_get_device(selected), cuda())))
        fail("parakeet_decoder_device_mismatch");
    auto status = ggml_backend_graph_compute(selected, graph);
    if (parakeet()) {
        if (status != GGML_STATUS_SUCCESS) fail("parakeet_decoder_compute_failed");
        std::fprintf(stderr, "hikaru_graph: role=%s device=%s nodes=%d other=0\n",
                     role, cuda() ? "cuda" : "cpu", ggml_graph_n_nodes(graph));
    }
    return status;
}
} // namespace hikaru_qwen
