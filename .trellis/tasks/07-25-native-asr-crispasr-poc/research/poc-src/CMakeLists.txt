cmake_minimum_required(VERSION 3.24)
project(hikaru_crispasr_poc LANGUAGES CXX)

if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "This PoC is Windows x64 only")
endif()

set(CRISPASR_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../local/sdk/libcrispasr-windows-x86_64" CACHE PATH "Pinned CrispASR v0.8.22 Windows x64 CPU library archive")
set(CRISPASR_SOURCE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../local/src/CrispASR-cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45" CACHE PATH "Pinned CrispASR v0.8.22 source archive")
set(NLOHMANN_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../local/deps" CACHE PATH "Pinned nlohmann/json single-header root")
foreach(required
    "${CRISPASR_ROOT}/bin/crispasr.dll"
    "${CRISPASR_ROOT}/bin/ggml-base.dll"
    "${CRISPASR_ROOT}/bin/ggml-cpu.dll"
    "${CRISPASR_ROOT}/bin/ggml.dll"
    "${CRISPASR_SOURCE_ROOT}/include/crispasr_session.h"
    "${NLOHMANN_ROOT}/nlohmann/json.hpp")
  if(NOT EXISTS "${required}")
    message(FATAL_ERROR "Missing pinned PoC input: ${required}")
  endif()
endforeach()

add_executable(hikaru-crispasr-poc src/main.cpp)
target_compile_features(hikaru-crispasr-poc PRIVATE cxx_std_17)
target_include_directories(hikaru-crispasr-poc PRIVATE "${CRISPASR_SOURCE_ROOT}/include" "${NLOHMANN_ROOT}")
file(REAL_PATH "${CMAKE_CURRENT_SOURCE_DIR}/../local" POC_LOCAL_ROOT_REAL)
file(REAL_PATH "${CRISPASR_ROOT}" CRISPASR_ROOT_REAL)
file(REAL_PATH "${CRISPASR_SOURCE_ROOT}" CRISPASR_SOURCE_ROOT_REAL)
target_compile_definitions(hikaru-crispasr-poc PRIVATE
  NOMINMAX WIN32_LEAN_AND_MEAN
  "POC_LOCAL_ROOT=\"${POC_LOCAL_ROOT_REAL}\""
  "CRISPASR_ROOT=\"${CRISPASR_ROOT_REAL}\""
  "CRISPASR_SOURCE_ROOT=\"${CRISPASR_SOURCE_ROOT_REAL}\"")
target_link_libraries(hikaru-crispasr-poc PRIVATE bcrypt psapi)
if(MSVC)
  target_compile_options(hikaru-crispasr-poc PRIVATE /W4 /utf-8 /EHsc)
endif()
foreach(dll crispasr.dll ggml-base.dll ggml-cpu.dll ggml.dll)
  add_custom_command(TARGET hikaru-crispasr-poc POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${CRISPASR_ROOT}/bin/${dll}" "$<TARGET_FILE_DIR:hikaru-crispasr-poc>/${dll}")
endforeach()

enable_testing()
find_package(Python3 REQUIRED COMPONENTS Interpreter)
add_test(NAME poc-self-check COMMAND hikaru-crispasr-poc --self-check)
add_test(NAME qwen-upstream-tokenizer-grouping COMMAND hikaru-crispasr-poc --qwen-grouping-test)
add_test(NAME abi-export-probe COMMAND hikaru-crispasr-poc --abi-probe)
add_test(NAME invalid-model-controlled-error COMMAND hikaru-crispasr-poc --invalid-model-test)

set(INPUT_LOCK "${CMAKE_CURRENT_SOURCE_DIR}/../crispasr-input-lock.json")
set(MODEL_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../local/models")
set(BENCHMARK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../.asr-benchmark" CACHE PATH "Ignored authoritative T01 corpus root")
set(MANIFEST "${BENCHMARK_ROOT}/manifest.json")
set(MANIFEST_SHA "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277")

function(restrict_test_path test_name)
  set_tests_properties(${test_name} PROPERTIES ENVIRONMENT
    "PATH=${CMAKE_BINARY_DIR}\\;$ENV{SystemRoot}/System32")
endfunction()

if(EXISTS "${INPUT_LOCK}" AND EXISTS "${MODEL_ROOT}/parakeet-tdt-0.6b-ja-q8_0.gguf")
  add_test(NAME parakeet-contract COMMAND hikaru-crispasr-poc --contract-test --engine parakeet-ja
    --model "${MODEL_ROOT}/parakeet-tdt-0.6b-ja-q8_0.gguf" --lock "${INPUT_LOCK}")
endif()
if(EXISTS "${INPUT_LOCK}" AND EXISTS "${MODEL_ROOT}/reazonspeech-nemo-v2-q8_0.gguf")
  add_test(NAME reazonspeech-contract COMMAND hikaru-crispasr-poc --contract-test --engine reazonspeech
    --model "${MODEL_ROOT}/reazonspeech-nemo-v2-q8_0.gguf" --lock "${INPUT_LOCK}")
endif()
if(EXISTS "${INPUT_LOCK}" AND EXISTS "${MODEL_ROOT}/qwen3-asr-1.7b-q4_k.gguf" AND EXISTS "${MODEL_ROOT}/qwen3-forced-aligner-0.6b-q4_k.gguf")
  add_test(NAME qwen3-contract COMMAND hikaru-crispasr-poc --contract-test --engine qwen3-asr
    --model "${MODEL_ROOT}/qwen3-asr-1.7b-q4_k.gguf"
    --aligner "${MODEL_ROOT}/qwen3-forced-aligner-0.6b-q4_k.gguf" --lock "${INPUT_LOCK}")
endif()

if(EXISTS "${INPUT_LOCK}" AND EXISTS "${BENCHMARK_ROOT}/short.wav")
  if(EXISTS "${MODEL_ROOT}/parakeet-tdt-0.6b-ja-q8_0.gguf")
    set(PARAKEET_EVIDENCE "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/parakeet-short-lifecycle.json")
    add_test(NAME parakeet-short-repeat-lifecycle COMMAND hikaru-crispasr-poc --run --engine parakeet-ja
      --model "${MODEL_ROOT}/parakeet-tdt-0.6b-ja-q8_0.gguf" --audio "${BENCHMARK_ROOT}/short.wav"
      --case-id short-v1 --manifest-sha256 "${MANIFEST_SHA}" --lock "${INPUT_LOCK}"
      --output "${PARAKEET_EVIDENCE}" --repeats 2)
    restrict_test_path(parakeet-short-repeat-lifecycle)
    add_test(NAME parakeet-short-evidence-validation COMMAND hikaru-crispasr-poc
      --validate-evidence "${PARAKEET_EVIDENCE}" --manifest "${MANIFEST}" --manifest-sha256 "${MANIFEST_SHA}"
      --lock "${INPUT_LOCK}" --model "${MODEL_ROOT}/parakeet-tdt-0.6b-ja-q8_0.gguf"
      --audio "${BENCHMARK_ROOT}/short.wav" --case-id short-v1 --case-source t01-authoritative)
    set_tests_properties(parakeet-short-evidence-validation PROPERTIES DEPENDS parakeet-short-repeat-lifecycle)
  endif()

  if(EXISTS "${MODEL_ROOT}/reazonspeech-nemo-v2-q8_0.gguf")
    set(REAZON_EVIDENCE "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/reazonspeech-short.json")
    add_test(NAME reazonspeech-short-public-dispatch COMMAND hikaru-crispasr-poc --run --engine reazonspeech
      --model "${MODEL_ROOT}/reazonspeech-nemo-v2-q8_0.gguf" --audio "${BENCHMARK_ROOT}/short.wav"
      --case-id short-v1 --manifest-sha256 "${MANIFEST_SHA}" --lock "${INPUT_LOCK}"
      --output "${REAZON_EVIDENCE}")
    restrict_test_path(reazonspeech-short-public-dispatch)
    add_test(NAME reazonspeech-short-evidence-validation COMMAND hikaru-crispasr-poc
      --validate-evidence "${REAZON_EVIDENCE}" --manifest "${MANIFEST}" --manifest-sha256 "${MANIFEST_SHA}"
      --lock "${INPUT_LOCK}" --model "${MODEL_ROOT}/reazonspeech-nemo-v2-q8_0.gguf"
      --audio "${BENCHMARK_ROOT}/short.wav" --case-id short-v1 --case-source t01-authoritative)
    set_tests_properties(reazonspeech-short-evidence-validation PROPERTIES DEPENDS reazonspeech-short-public-dispatch)
  endif()

  if(EXISTS "${MODEL_ROOT}/qwen3-asr-1.7b-q4_k.gguf" AND EXISTS "${MODEL_ROOT}/qwen3-forced-aligner-0.6b-q4_k.gguf")
    set(QWEN_EVIDENCE "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/qwen3-short-grouped.json")
    add_test(NAME qwen3-short-forced-aligner-grouping COMMAND hikaru-crispasr-poc --run --engine qwen3-asr
      --model "${MODEL_ROOT}/qwen3-asr-1.7b-q4_k.gguf"
      --aligner "${MODEL_ROOT}/qwen3-forced-aligner-0.6b-q4_k.gguf" --audio "${BENCHMARK_ROOT}/short.wav"
      --case-id short-v1 --manifest-sha256 "${MANIFEST_SHA}" --lock "${INPUT_LOCK}"
      --output "${QWEN_EVIDENCE}")
    restrict_test_path(qwen3-short-forced-aligner-grouping)
    add_test(NAME qwen3-short-evidence-validation COMMAND hikaru-crispasr-poc
      --validate-evidence "${QWEN_EVIDENCE}" --manifest "${MANIFEST}" --manifest-sha256 "${MANIFEST_SHA}"
      --lock "${INPUT_LOCK}" --model "${MODEL_ROOT}/qwen3-asr-1.7b-q4_k.gguf"
      --aligner "${MODEL_ROOT}/qwen3-forced-aligner-0.6b-q4_k.gguf"
      --audio "${BENCHMARK_ROOT}/short.wav" --case-id short-v1 --case-source t01-authoritative)
    set_tests_properties(qwen3-short-evidence-validation PROPERTIES DEPENDS qwen3-short-forced-aligner-grouping)

    file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/fixtures")
    file(WRITE "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/fixtures/corrupt-aligner.gguf" "corrupt")
    file(WRITE "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/fixtures/qwen3-forced-aligner-unloadable.gguf" "GGUF-invalid")
    set(QWEN_NEGATIVE_EVIDENCE "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/qwen-negative-matrix.json")
    add_test(NAME qwen3-real-negative-matrix COMMAND hikaru-crispasr-poc --negative-matrix
      --model "${MODEL_ROOT}/qwen3-asr-1.7b-q4_k.gguf"
      --aligner "${MODEL_ROOT}/qwen3-forced-aligner-0.6b-q4_k.gguf"
      --corrupt-aligner "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/fixtures/corrupt-aligner.gguf"
      --unloadable-aligner "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/fixtures/qwen3-forced-aligner-unloadable.gguf"
      --audio "${BENCHMARK_ROOT}/short.wav" --case-id short-v1 --manifest-sha256 "${MANIFEST_SHA}"
      --lock "${INPUT_LOCK}" --output "${QWEN_NEGATIVE_EVIDENCE}")
    restrict_test_path(qwen3-real-negative-matrix)
    add_test(NAME qwen3-negative-evidence-validation COMMAND hikaru-crispasr-poc
      --validate-evidence "${QWEN_NEGATIVE_EVIDENCE}" --manifest "${MANIFEST}" --manifest-sha256 "${MANIFEST_SHA}"
      --lock "${INPUT_LOCK}" --model "${MODEL_ROOT}/qwen3-asr-1.7b-q4_k.gguf"
      --aligner "${MODEL_ROOT}/qwen3-forced-aligner-0.6b-q4_k.gguf"
      --audio "${BENCHMARK_ROOT}/short.wav" --case-id short-v1 --case-source negative-obligation
      --corrupt-aligner "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/fixtures/corrupt-aligner.gguf"
      --unloadable-aligner "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/fixtures/qwen3-forced-aligner-unloadable.gguf")
    set_tests_properties(qwen3-negative-evidence-validation PROPERTIES DEPENDS qwen3-real-negative-matrix)
  endif()
endif()

set(FINAL_RUN_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../local/runs")
set(FINAL_NEGATIVE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../local/negative")
if(EXISTS "${FINAL_RUN_ROOT}/qwen3-short.json"
   AND EXISTS "${FINAL_RUN_ROOT}/qwen-leading-silence-v1.json"
   AND EXISTS "${FINAL_RUN_ROOT}/qwen3-long.json"
   AND EXISTS "${FINAL_NEGATIVE_ROOT}/matrix.json")
  file(MAKE_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/mutations")
  add_test(NAME shared-evidence-validator-mutations COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/evidence_contract.py" --mutation-test
    --executable "$<TARGET_FILE:hikaru-crispasr-poc>" --manifest "${MANIFEST}" --manifest-sha256 "${MANIFEST_SHA}"
    --lock "${INPUT_LOCK}" --model "${MODEL_ROOT}/qwen3-asr-1.7b-q4_k.gguf"
    --aligner "${MODEL_ROOT}/qwen3-forced-aligner-0.6b-q4_k.gguf" --audio "${BENCHMARK_ROOT}/short.wav"
    --raw "${FINAL_RUN_ROOT}/qwen3-short.json"
    --derived "${FINAL_RUN_ROOT}/qwen-leading-silence-v1.json"
    --derived-audio "${CMAKE_CURRENT_SOURCE_DIR}/../local/derived/qwen-leading-silence.wav"
    --long "${FINAL_RUN_ROOT}/qwen3-long.json" --long-audio "${BENCHMARK_ROOT}/long.wav"
    --negative "${FINAL_NEGATIVE_ROOT}/matrix.json"
    --corrupt-aligner "${FINAL_NEGATIVE_ROOT}/corrupt-aligner.gguf"
    --unloadable-aligner "${FINAL_NEGATIVE_ROOT}/qwen3-forced-aligner-unloadable.gguf"
    --temp-root "${CMAKE_CURRENT_SOURCE_DIR}/../local/ctest/mutations")
endif()
