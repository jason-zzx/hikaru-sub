#pragma once
// Model-free capability only. This does NOT attest Qwen ASR/aligner graphs.
#include "core/hikaru_qwen_device.h"
#include "ggml-alloc.h"
#include <array>

namespace hikaru_qwen {
inline int probe_cuda() {
    const auto reg = ggml_backend_reg_by_name("CUDA");
    if (!reg || ggml_backend_reg_dev_count(reg) == 0) return 43;
    const auto dev = ggml_backend_reg_dev_get(reg, 0);
    if (!matches(dev, true)) return 43;
    const auto backend = ggml_backend_dev_init(dev, nullptr);
    if (!backend) return 43;
    const auto ctx = ggml_init({ggml_tensor_overhead() * 3 + ggml_graph_overhead(), nullptr, true});
    if (!ctx) { ggml_backend_free(backend); return 43; }
    auto a = ggml_new_tensor_1d(ctx, GGML_TYPE_F32, 32);
    auto b = ggml_new_tensor_1d(ctx, GGML_TYPE_F32, 32);
    auto sum = ggml_add(ctx, a, b);
    auto graph = ggml_new_graph(ctx);
    ggml_build_forward_expand(graph, sum);
    auto buffer = ggml_backend_alloc_ctx_tensors(ctx, backend);
    bool ok = buffer && matches(ggml_backend_buft_get_device(ggml_backend_buffer_get_type(buffer)), true)
        && ggml_backend_supports_op(backend, sum) && ggml_graph_n_nodes(graph) == 1;
    if (ok) {
        std::array<float, 32> input{}, result{};
        input.fill(1.0f); ggml_backend_tensor_set(a, input.data(), 0, sizeof(input));
        input.fill(2.0f); ggml_backend_tensor_set(b, input.data(), 0, sizeof(input));
        ok = ggml_backend_graph_compute(backend, graph) == GGML_STATUS_SUCCESS;
        if (ok) {
            ggml_backend_tensor_get(sum, result.data(), 0, sizeof(result));
            for (float value : result) ok = ok && value == 3.0f;
        }
    }
    if (buffer) ggml_backend_buffer_free(buffer);
    ggml_free(ctx); ggml_backend_free(backend);
    if (!ok) return 43;
    std::puts("{\"schemaVersion\":1,\"backend\":\"crispasr\",\"device\":\"cuda\",\"operation\":\"ggml-add-f32\",\"nodes\":1,\"otherDeviceNodes\":0,\"resultVerified\":true,\"modelExecutionProof\":false}");
    return 0;
}
} // namespace hikaru_qwen
