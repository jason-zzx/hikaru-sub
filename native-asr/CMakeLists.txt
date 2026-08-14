cmake_minimum_required(VERSION 3.21)
project(hikaru_native_asr_protocol VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(NLOHMANN_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/nlohmann")
file(READ "${NLOHMANN_DIR}/provenance.json" NLOHMANN_PROVENANCE)
string(JSON NLOHMANN_VERSION GET "${NLOHMANN_PROVENANCE}" version)
if(NOT NLOHMANN_VERSION STREQUAL "3.11.3")
  message(FATAL_ERROR "Expected vendored nlohmann/json 3.11.3, found ${NLOHMANN_VERSION}")
endif()
foreach(file_name IN ITEMS json.hpp LICENSE.MIT)
  string(JSON expected_hash GET "${NLOHMANN_PROVENANCE}" files "${file_name}" sha256)
  string(JSON expected_size GET "${NLOHMANN_PROVENANCE}" files "${file_name}" sizeBytes)
  file(SHA256 "${NLOHMANN_DIR}/${file_name}" actual_hash)
  file(SIZE "${NLOHMANN_DIR}/${file_name}" actual_size)
  if(NOT actual_hash STREQUAL expected_hash OR NOT actual_size EQUAL expected_size)
    message(FATAL_ERROR "Vendored nlohmann/json file failed offline identity check: ${file_name}")
  endif()
endforeach()
message(STATUS "Verified offline nlohmann/json ${NLOHMANN_VERSION}")

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/protocol-v1-limits.json" LIMITS_JSON)
function(read_positive_limit key variable)
  string(JSON value ERROR_VARIABLE error GET "${LIMITS_JSON}" "${key}")
  if(error OR NOT value MATCHES "^[0-9]+$" OR value LESS 1)
    message(FATAL_ERROR "Invalid protocol limit ${key}: ${error}")
  endif()
  set(${variable} "${value}" PARENT_SCOPE)
endfunction()
read_positive_limit(protocolVersion PROTOCOL_VERSION)
read_positive_limit(maxRequestLineBytes MAX_REQUEST_LINE_BYTES)
read_positive_limit(maxEventLineBytes MAX_EVENT_LINE_BYTES)
read_positive_limit(maxJobIdBytes MAX_JOB_ID_BYTES)
read_positive_limit(maxPathBytes MAX_PATH_BYTES)
read_positive_limit(maxTextBytes MAX_TEXT_BYTES)
read_positive_limit(maxModelEntries MAX_MODEL_ENTRIES)
read_positive_limit(maxReplacementSegments MAX_REPLACEMENT_SEGMENTS)
read_positive_limit(maxStderrDiagnosticBytes MAX_STDERR_DIAGNOSTIC_BYTES)
if(NOT PROTOCOL_VERSION EQUAL 1)
  message(FATAL_ERROR "This source implements protocol v1 only")
endif()

set(GENERATED_INCLUDE_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(MAKE_DIRECTORY "${GENERATED_INCLUDE_DIR}/hikaru_asr")
file(WRITE "${GENERATED_INCLUDE_DIR}/hikaru_asr/protocol_limits.hpp"
"#pragma once\n\n#include <cstddef>\n\nnamespace hikaru_asr::limits {\n"
"inline constexpr std::size_t protocol_version = ${PROTOCOL_VERSION};\n"
"inline constexpr std::size_t max_request_line_bytes = ${MAX_REQUEST_LINE_BYTES};\n"
"inline constexpr std::size_t max_event_line_bytes = ${MAX_EVENT_LINE_BYTES};\n"
"inline constexpr std::size_t max_job_id_bytes = ${MAX_JOB_ID_BYTES};\n"
"inline constexpr std::size_t max_path_bytes = ${MAX_PATH_BYTES};\n"
"inline constexpr std::size_t max_text_bytes = ${MAX_TEXT_BYTES};\n"
"inline constexpr std::size_t max_model_entries = ${MAX_MODEL_ENTRIES};\n"
"inline constexpr std::size_t max_replacement_segments = ${MAX_REPLACEMENT_SEGMENTS};\n"
"inline constexpr std::size_t max_stderr_diagnostic_bytes = ${MAX_STDERR_DIAGNOSTIC_BYTES};\n"
"}  // namespace hikaru_asr::limits\n")

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
foreach(configuration IN ITEMS DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${configuration} "${CMAKE_BINARY_DIR}/bin")
endforeach()

add_library(hikaru-asr-protocol STATIC src/protocol.cpp)
target_include_directories(hikaru-asr-protocol
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include" "${GENERATED_INCLUDE_DIR}")
target_include_directories(hikaru-asr-protocol SYSTEM PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
target_compile_features(hikaru-asr-protocol PUBLIC cxx_std_17)

add_executable(hikaru-asr-fake-worker src/fake_worker.cpp)
target_link_libraries(hikaru-asr-fake-worker PRIVATE hikaru-asr-protocol)

add_executable(hikaru-asr-protocol-tests tests/protocol_tests.cpp)
target_link_libraries(hikaru-asr-protocol-tests PRIVATE hikaru-asr-protocol)
target_include_directories(hikaru-asr-protocol-tests SYSTEM PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
target_compile_definitions(hikaru-asr-protocol-tests PRIVATE
  HIKARU_ASR_LIMITS_PATH="${CMAKE_CURRENT_SOURCE_DIR}/protocol-v1-limits.json")

set(HIKARU_ASR_BUILD_CT2_WORKER_DEFAULT OFF)
option(
  HIKARU_ASR_BUILD_CT2_WORKER
  "Build the T06 Windows x64 CTranslate2 production worker"
  ${HIKARU_ASR_BUILD_CT2_WORKER_DEFAULT})
option(
  HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT
  "Enable the ignored-local T07 CTranslate2 CUDA development backend"
  OFF)
option(
  HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT
  "Enable the ignored-local T09 CrispASR development backend"
  OFF)
set(HIKARU_ASR_CRISPASR_RUNTIME_FILE "" CACHE FILEPATH "Locked CrispASR development runtime")
set(HIKARU_ASR_CRISPASR_RUNTIME_SIZE "" CACHE STRING "Locked CrispASR development runtime size")
set(HIKARU_ASR_CRISPASR_RUNTIME_SHA256 "" CACHE STRING "Locked CrispASR development runtime SHA-256")

if(HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT AND NOT HIKARU_ASR_BUILD_CT2_WORKER)
  message(FATAL_ERROR "T07 CUDA development requires HIKARU_ASR_BUILD_CT2_WORKER=ON")
endif()
if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT AND NOT HIKARU_ASR_BUILD_CT2_WORKER)
  message(FATAL_ERROR "T09 CrispASR development requires HIKARU_ASR_BUILD_CT2_WORKER=ON")
endif()

add_library(hikaru-asr-wav-audio STATIC src/wav_audio.cpp)
target_include_directories(hikaru-asr-wav-audio PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_features(hikaru-asr-wav-audio PUBLIC cxx_std_17)

set(CRISPASR_GENERATED_INCLUDE_DIR "${GENERATED_INCLUDE_DIR}")
set(CRISPASR_RUNTIME_IDENTITY_SIZE 0)
set(CRISPASR_RUNTIME_IDENTITY_SHA256 "")
if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
  if(NOT HIKARU_ASR_CRISPASR_RUNTIME_FILE OR NOT EXISTS "${HIKARU_ASR_CRISPASR_RUNTIME_FILE}")
    message(FATAL_ERROR "T09 requires a reviewed CrispASR runtime file")
  endif()
  string(LENGTH "${HIKARU_ASR_CRISPASR_RUNTIME_SHA256}" CRISPASR_RUNTIME_SHA256_LENGTH)
  if(NOT "${HIKARU_ASR_CRISPASR_RUNTIME_SIZE}" MATCHES "^[0-9]+$"
      OR NOT "${HIKARU_ASR_CRISPASR_RUNTIME_SHA256}" MATCHES "^[0-9a-f]+$"
      OR NOT CRISPASR_RUNTIME_SHA256_LENGTH EQUAL 64)
    message(FATAL_ERROR "T09 requires a reviewed CrispASR runtime size/SHA-256")
  endif()
  file(SIZE "${HIKARU_ASR_CRISPASR_RUNTIME_FILE}" CRISPASR_RUNTIME_ACTUAL_SIZE)
  file(SHA256 "${HIKARU_ASR_CRISPASR_RUNTIME_FILE}" CRISPASR_RUNTIME_ACTUAL_SHA256)
  if(NOT CRISPASR_RUNTIME_ACTUAL_SIZE EQUAL HIKARU_ASR_CRISPASR_RUNTIME_SIZE
      OR NOT CRISPASR_RUNTIME_ACTUAL_SHA256 STREQUAL HIKARU_ASR_CRISPASR_RUNTIME_SHA256)
    message(FATAL_ERROR "Reviewed CrispASR runtime identity drifted")
  endif()
  set(CRISPASR_RUNTIME_IDENTITY_SIZE "${HIKARU_ASR_CRISPASR_RUNTIME_SIZE}")
  set(CRISPASR_RUNTIME_IDENTITY_SHA256 "${HIKARU_ASR_CRISPASR_RUNTIME_SHA256}")
endif()
file(WRITE "${CRISPASR_GENERATED_INCLUDE_DIR}/hikaru_asr/crispasr_runtime_identity.hpp"
"#pragma once\n\n#include <cstdint>\n\nnamespace hikaru_asr::crisp::runtime_identity {\n"
"inline constexpr std::uintmax_t size_bytes = ${CRISPASR_RUNTIME_IDENTITY_SIZE};\n"
"inline constexpr const char* sha256 = \"${CRISPASR_RUNTIME_IDENTITY_SHA256}\";\n"
"}  // namespace hikaru_asr::crisp::runtime_identity\n")

add_library(hikaru-asr-crispasr STATIC src/crispasr_backend.cpp)
target_include_directories(hikaru-asr-crispasr
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src" "${CRISPASR_GENERATED_INCLUDE_DIR}")
target_link_libraries(hikaru-asr-crispasr PUBLIC hikaru-asr-protocol hikaru-asr-wav-audio PRIVATE bcrypt)

add_library(hikaru-asr-parakeet-family-policy STATIC src/parakeet_family_policy.cpp)
target_include_directories(hikaru-asr-parakeet-family-policy PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src")
target_link_libraries(hikaru-asr-parakeet-family-policy PUBLIC hikaru-asr-protocol)

add_library(hikaru-asr-crispasr-test-adapter STATIC src/crispasr_backend.cpp)
target_include_directories(hikaru-asr-crispasr-test-adapter
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src" "${CRISPASR_GENERATED_INCLUDE_DIR}")
target_link_libraries(hikaru-asr-crispasr-test-adapter
  PUBLIC hikaru-asr-protocol hikaru-asr-wav-audio PRIVATE bcrypt)
target_compile_definitions(hikaru-asr-crispasr-test-adapter
  PRIVATE HIKARU_ASR_CRISPASR_TEST_RUNTIME_IDENTITY_BYPASS=1)

add_library(hikaru-asr-fake-crispasr-abi SHARED tests/fake_crispasr_abi.cpp)
add_library(hikaru-asr-fake-crispasr-cuda-marker SHARED tests/fake_crispasr_cuda_marker.cpp)
set_target_properties(hikaru-asr-fake-crispasr-cuda-marker PROPERTIES
  OUTPUT_NAME "hikaru-asr-fake-crispasr-cuda-marker")
add_library(hikaru-asr-fake-crispasr-abi-broken SHARED tests/fake_crispasr_abi.cpp)
target_compile_definitions(hikaru-asr-fake-crispasr-abi-broken PRIVATE HIKARU_ASR_FAKE_CRISPASR_BROKEN=1)
add_executable(hikaru-asr-crispasr-tests tests/crispasr_backend_tests.cpp)
target_link_libraries(hikaru-asr-crispasr-tests PRIVATE hikaru-asr-crispasr-test-adapter)
add_executable(hikaru-asr-parakeet-family-policy-tests tests/parakeet_family_policy_tests.cpp)
target_link_libraries(hikaru-asr-parakeet-family-policy-tests PRIVATE hikaru-asr-parakeet-family-policy)
if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
  add_executable(hikaru-asr-crispasr-development-runner tests/crispasr_development_runner.cpp)
  target_include_directories(hikaru-asr-crispasr-development-runner SYSTEM PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  file(TO_CMAKE_PATH
    "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-07-native-asr-crispasr-backend/research/local"
    T09_LOCAL_ROOT)
  file(TO_CMAKE_PATH
    "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-13-native-asr-parakeet-reazon/research/local"
    T10_LOCAL_ROOT)
  target_compile_definitions(hikaru-asr-crispasr-development-runner PRIVATE
    "T09_LOCAL_ROOT=\"${T09_LOCAL_ROOT}\""
    "T10_LOCAL_ROOT=\"${T10_LOCAL_ROOT}\"")
  target_link_libraries(hikaru-asr-crispasr-development-runner
    PRIVATE hikaru-asr-crispasr hikaru-asr-parakeet-family-policy bcrypt psapi)
endif()

if(HIKARU_ASR_BUILD_CT2_WORKER)
if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "The production CTranslate2 worker currently supports Windows x64 only")
endif()

file(REAL_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local"
  T06_LOCAL_ROOT_REAL)
set(CT2_SOURCE_DIR "${T06_LOCAL_ROOT_REAL}/src/CTranslate2" CACHE PATH "Pinned CTranslate2 4.8.0 source")
set(POCKETFFT_SOURCE_DIR "${T06_LOCAL_ROOT_REAL}/src/pocketfft" CACHE PATH "Pinned pocketfft source")
set(DNNL_ROOT "${T06_LOCAL_ROOT_REAL}/installed/onednn-3.1.1" CACHE PATH "Pinned oneDNN 3.1.1 install")
set(CANDIDATE_B_ROOT "${T06_LOCAL_ROOT_REAL}/candidate-b" CACHE PATH "Locked Candidate B input root")
set(ORT_ROOT "${CANDIDATE_B_ROOT}/extracted/onnxruntime-win-x64-1.28.0" CACHE PATH "Official ONNX Runtime 1.28.0 Windows x64 SDK")
set(ORT_ARCHIVE "${CANDIDATE_B_ROOT}/downloads/onnxruntime-win-x64-1.28.0.zip")
set(VAD_MODEL_SOURCE "${CANDIDATE_B_ROOT}/model/silero_vad_v6.onnx")
if(NOT EXISTS "${CT2_SOURCE_DIR}/include/ctranslate2/models/whisper.h")
  message(FATAL_ERROR "Missing pinned CTranslate2 source below T06 research/local")
endif()
if(NOT EXISTS "${POCKETFFT_SOURCE_DIR}/pocketfft_hdronly.h")
  message(FATAL_ERROR "Missing pinned pocketfft source below T06 research/local")
endif()
if(NOT EXISTS "${DNNL_ROOT}/include/dnnl.h" OR NOT EXISTS "${DNNL_ROOT}/lib/dnnl.lib")
  message(FATAL_ERROR "Missing pinned oneDNN install below T06 research/local")
endif()

function(require_pinned_file path expected_size expected_sha256 label)
  file(SIZE "${path}" actual_size)
  file(SHA256 "${path}" actual_sha256)
  if(NOT actual_size EQUAL expected_size OR NOT actual_sha256 STREQUAL expected_sha256)
    message(FATAL_ERROR "Pinned T06 input failed identity check: ${label}")
  endif()
endfunction()
require_pinned_file(
  "${CT2_SOURCE_DIR}/include/ctranslate2/models/whisper.h"
  6025
  ee3ae7a77c107fa8a6756dfa32340f3d4e1cc1d6e247786580d40dd810058312
  "CTranslate2 whisper.h")
require_pinned_file(
  "${POCKETFFT_SOURCE_DIR}/pocketfft_hdronly.h"
  120735
  3e9a05318d8e3b1446bda1c4617e6a103cdd23599ae0a776a92a6e8800e92fdc
  "pocketfft header")
require_pinned_file(
  "${DNNL_ROOT}/include/dnnl.h"
  826
  23e40186069086c288f70b397485a20b59a8fedce33194ea70e107d91fddaae4
  "oneDNN header")
require_pinned_file(
  "${DNNL_ROOT}/lib/dnnl.lib"
  385595736
  9104b04662d354793e593bb1b162740e7047c9ce3aa8c2b532049504d678c005
  "oneDNN static library")

require_pinned_file("${ORT_ARCHIVE}" 78796801 abef733dacbe2f571547a7150b479b5cb9cc0df22f96c24983a42cadb1b4f8bc "official ONNX Runtime archive")
require_pinned_file("${ORT_ROOT}/VERSION_NUMBER" 8 b056072036db8b4f37fbdb84a6c45992ceea413fd481b7a0489288c0708f2fae "ONNX Runtime version identity")
require_pinned_file("${ORT_ROOT}/GIT_COMMIT_ID" 43 c7b502512e05a29cca9fb4e220d5d847e67075173fdce3a125166fc60bfe4491 "ONNX Runtime commit identity")
require_pinned_file("${ORT_ROOT}/include/cpu_provider_factory.h" 416 e2f658eeace78d79a8df82f233dcdeea135db498a77766156054bfc0d1d06c21 "ONNX Runtime CPU provider header")
require_pinned_file("${ORT_ROOT}/include/onnxruntime_c_api.h" 403673 e3a01cdb382b2ba52267bf8a1a40d60b1197a1bac4da55667fe4d84e244f589a "ONNX Runtime C API header")
require_pinned_file("${ORT_ROOT}/include/onnxruntime_cxx_api.h" 172735 0765fc56924999b06b4c01f665d8fbd368582fed7a856a22ce1ed686a73e8be2 "ONNX Runtime C++ API header")
require_pinned_file("${ORT_ROOT}/include/onnxruntime_cxx_inline.h" 161868 e6c0478ab86467cfb4ac8694df3081ad1d42585c16f024d107638fb197e92f4a "ONNX Runtime C++ inline header")
require_pinned_file("${ORT_ROOT}/include/onnxruntime_ep_c_api.h" 156087 612dd6c3b5c7fa8f936fe07e1d8da4dc4727890011305b4f67279b132aa1c8e0 "ONNX Runtime EP API header")
require_pinned_file("${ORT_ROOT}/include/onnxruntime_error_code.h" 2873 6690bf0df3f7a7a9c4f38597dc3232042e432b48ea166cb5672f72a49d32b742 "ONNX Runtime error header")
require_pinned_file("${ORT_ROOT}/include/onnxruntime_float16.h" 18528 9b45e1bc0fe19d9d53f272b168f5cab616e26eb00136c3a1b78f394c9b1b6757 "ONNX Runtime float16 header")
require_pinned_file("${ORT_ROOT}/lib/onnxruntime.lib" 2124 b9fc3cd678257d88a111b0773ede4bfceaf0fe95daab4379f2b2b37348a68781 "ONNX Runtime import library")
require_pinned_file("${ORT_ROOT}/lib/onnxruntime.dll" 15809848 18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257 "ONNX Runtime DLL")
require_pinned_file("${ORT_ROOT}/lib/onnxruntime_providers_shared.dll" 21856 599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8 "ONNX Runtime providers shared DLL")
require_pinned_file("${ORT_ROOT}/LICENSE" 1094 c250d6278f0b47a6439fb7592b08b58a55eb9f535aa49a1db63211c3f982b674 "ONNX Runtime license")
require_pinned_file("${ORT_ROOT}/ThirdPartyNotices.txt" 331175 fb0af774b4d7cffc5b9d046f2aaeade2f37df2f80abf8033c95dfffcc77a8866 "ONNX Runtime notices")
require_pinned_file("${VAD_MODEL_SOURCE}" 1245151 4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2 "faster-whisper Silero V6 model")
file(READ "${ORT_ROOT}/VERSION_NUMBER" ORT_VERSION_NUMBER)
file(READ "${ORT_ROOT}/GIT_COMMIT_ID" ORT_GIT_COMMIT_ID)
file(STRINGS "${ORT_ROOT}/include/onnxruntime_c_api.h" ORT_API_LINE REGEX "^#define ORT_API_VERSION 28$")
string(STRIP "${ORT_VERSION_NUMBER}" ORT_VERSION_NUMBER)
string(STRIP "${ORT_GIT_COMMIT_ID}" ORT_GIT_COMMIT_ID)
if(NOT ORT_VERSION_NUMBER STREQUAL "1.28.0"
    OR NOT ORT_GIT_COMMIT_ID STREQUAL "da9b5e364c465de65c49d91e696cd6485270757f"
    OR NOT ORT_API_LINE STREQUAL "#define ORT_API_VERSION 28")
  message(FATAL_ERROR "ONNX Runtime source/API identity drifted from Candidate B lock")
endif()

find_package(Git REQUIRED)
execute_process(
  COMMAND "${GIT_EXECUTABLE}" -C "${CT2_SOURCE_DIR}" rev-parse HEAD
  RESULT_VARIABLE CT2_GIT_RESULT
  OUTPUT_VARIABLE CT2_GIT_COMMIT
  ERROR_QUIET
  OUTPUT_STRIP_TRAILING_WHITESPACE)
execute_process(
  COMMAND "${GIT_EXECUTABLE}" -C "${CT2_SOURCE_DIR}" status --porcelain --untracked-files=no
  RESULT_VARIABLE CT2_STATUS_RESULT
  OUTPUT_VARIABLE CT2_GIT_STATUS
  ERROR_QUIET
  OUTPUT_STRIP_TRAILING_WHITESPACE)
if(NOT CT2_GIT_RESULT EQUAL 0
    OR NOT CT2_STATUS_RESULT EQUAL 0
    OR NOT CT2_GIT_COMMIT STREQUAL "54a546cec4262f9770d4674a0bfb4ac3c4f05698"
    OR NOT CT2_GIT_STATUS STREQUAL "")
  message(FATAL_ERROR "CTranslate2 source is not the clean pinned 4.8.0 commit")
endif()

set(WITH_MKL OFF CACHE BOOL "" FORCE)
set(WITH_DNNL ON CACHE BOOL "" FORCE)
set(DNNL_INCLUDE_DIR "${DNNL_ROOT}/include" CACHE PATH "" FORCE)
set(DNNL_LIBRARY "${DNNL_ROOT}/lib/dnnl.lib" CACHE FILEPATH "" FORCE)
set(WITH_OPENBLAS OFF CACHE BOOL "" FORCE)
set(WITH_RUY OFF CACHE BOOL "" FORCE)
if(HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT)
  if(NOT DEFINED ENV{CUDA_PATH} OR "$ENV{CUDA_PATH}" STREQUAL "")
    message(FATAL_ERROR "T07 CUDA development requires the locked CUDA_PATH")
  endif()
  file(TO_CMAKE_PATH "$ENV{CUDA_PATH}" CUDA_TOOLKIT_ROOT_NORMALIZED)
  set(CUDA_TOOLKIT_ROOT_DIR "${CUDA_TOOLKIT_ROOT_NORMALIZED}" CACHE PATH "" FORCE)
  set(WITH_CUDA ON CACHE BOOL "" FORCE)
  set(CUDA_DYNAMIC_LOADING ON CACHE BOOL "" FORCE)
  set(CUDA_ARCH_LIST "8.6" CACHE STRING "" FORCE)
  set(CUDA_NVCC_FLAGS "" CACHE STRING "" FORCE)
else()
  set(WITH_CUDA OFF CACHE BOOL "" FORCE)
  set(CUDA_DYNAMIC_LOADING OFF CACHE BOOL "" FORCE)
endif()
set(WITH_CUDNN OFF CACHE BOOL "" FORCE)
set(WITH_HIP OFF CACHE BOOL "" FORCE)
set(WITH_TENSOR_PARALLEL OFF CACHE BOOL "" FORCE)
set(WITH_FLASH_ATTN OFF CACHE BOOL "" FORCE)
set(BUILD_CLI OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(OPENMP_RUNTIME COMP CACHE STRING "" FORCE)
add_subdirectory("${CT2_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/ctranslate2" EXCLUDE_FROM_ALL)

find_program(CARGO_EXECUTABLE cargo REQUIRED)
set(TOKENIZER_MANIFEST "${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-ffi/Cargo.toml")
set(TOKENIZER_TARGET_DIR "${CMAKE_BINARY_DIR}/tokenizer")
set(TOKENIZER_DLL "${TOKENIZER_TARGET_DIR}/release/hikaru_asr_tokenizer.dll")
set(TOKENIZER_IMPLIB "${TOKENIZER_TARGET_DIR}/release/hikaru_asr_tokenizer.dll.lib")
add_custom_command(
  OUTPUT "${TOKENIZER_DLL}" "${TOKENIZER_IMPLIB}"
  COMMAND "${CMAKE_COMMAND}" -E env "CARGO_TARGET_DIR=${TOKENIZER_TARGET_DIR}"
          "${CARGO_EXECUTABLE}" build --locked --offline --release --manifest-path "${TOKENIZER_MANIFEST}"
  DEPENDS
    "${TOKENIZER_MANIFEST}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-ffi/Cargo.lock"
    "${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-ffi/src/lib.rs"
  VERBATIM)
add_custom_target(hikaru-asr-tokenizer-build DEPENDS "${TOKENIZER_DLL}" "${TOKENIZER_IMPLIB}")

add_library(hikaru-asr-ctranslate2 STATIC src/ctranslate2_whisper.cpp)
add_dependencies(hikaru-asr-ctranslate2 hikaru-asr-tokenizer-build)
if(HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT)
  target_compile_definitions(hikaru-asr-ctranslate2 PUBLIC HIKARU_ASR_CT2_WITH_CUDA=1)
  target_include_directories(hikaru-asr-ctranslate2 PRIVATE "${CUDA_TOOLKIT_ROOT_NORMALIZED}/include")
endif()
target_include_directories(hikaru-asr-ctranslate2
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src"
  PRIVATE "${POCKETFFT_SOURCE_DIR}" "${ORT_ROOT}/include")
target_include_directories(hikaru-asr-ctranslate2 SYSTEM PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
target_link_libraries(hikaru-asr-ctranslate2
  PUBLIC hikaru-asr-protocol
  PRIVATE
    hikaru-asr-wav-audio
    ctranslate2
    "${TOKENIZER_IMPLIB}"
    "${ORT_ROOT}/lib/onnxruntime.lib"
    bcrypt)

add_executable(hikaru-asr-worker src/main.cpp)
target_link_libraries(hikaru-asr-worker PRIVATE hikaru-asr-ctranslate2)
if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
  target_compile_definitions(hikaru-asr-worker PRIVATE HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=1)
  target_link_libraries(hikaru-asr-worker PRIVATE hikaru-asr-crispasr hikaru-asr-parakeet-family-policy)
  add_executable(hikaru-asr-crispasr-contract-worker src/main.cpp)
  set_target_properties(
    hikaru-asr-crispasr-contract-worker PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/contract-bin")
  foreach(configuration IN ITEMS DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set_target_properties(
      hikaru-asr-crispasr-contract-worker PROPERTIES
      RUNTIME_OUTPUT_DIRECTORY_${configuration} "${CMAKE_BINARY_DIR}/contract-bin")
  endforeach()
  target_compile_definitions(
    hikaru-asr-crispasr-contract-worker PRIVATE HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=1)
  target_link_libraries(
    hikaru-asr-crispasr-contract-worker
    PRIVATE hikaru-asr-ctranslate2 hikaru-asr-crispasr-test-adapter hikaru-asr-parakeet-family-policy)
  add_executable(hikaru-asr-crispasr-worker-contract-tests tests/crispasr_worker_contract_tests.cpp)
  target_include_directories(hikaru-asr-crispasr-worker-contract-tests SYSTEM PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  target_link_libraries(hikaru-asr-crispasr-worker-contract-tests PRIVATE hikaru-asr-protocol)
  add_custom_command(TARGET hikaru-asr-worker POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${HIKARU_ASR_CRISPASR_RUNTIME_FILE}" "$<TARGET_FILE_DIR:hikaru-asr-worker>/crispasr.dll")
endif()

add_executable(hikaru-asr-ctranslate2-tests tests/ctranslate2_whisper_tests.cpp)
target_link_libraries(hikaru-asr-ctranslate2-tests PRIVATE hikaru-asr-ctranslate2 bcrypt psapi version)
target_include_directories(hikaru-asr-ctranslate2-tests SYSTEM PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
file(TO_CMAKE_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-04-native-asr-ctranslate2-cuda-development/research/local"
  T07_LOCAL_ROOT)
file(TO_CMAKE_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local"
  T08_LOCAL_ROOT)
target_compile_definitions(hikaru-asr-ctranslate2-tests PRIVATE
  "T06_LOCAL_ROOT=\"${T06_LOCAL_ROOT_REAL}\""
  "T07_LOCAL_ROOT=\"${T07_LOCAL_ROOT}\""
  "T08_LOCAL_ROOT=\"${T08_LOCAL_ROOT}\"")

endif()

if(MSVC)
  foreach(target IN ITEMS
      hikaru-asr-protocol
      hikaru-asr-fake-worker
      hikaru-asr-protocol-tests
      hikaru-asr-wav-audio
      hikaru-asr-crispasr
      hikaru-asr-parakeet-family-policy
      hikaru-asr-crispasr-test-adapter
      hikaru-asr-fake-crispasr-abi
      hikaru-asr-fake-crispasr-cuda-marker
      hikaru-asr-fake-crispasr-abi-broken
      hikaru-asr-crispasr-tests
      hikaru-asr-parakeet-family-policy-tests)
    target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
  endforeach()
  if(HIKARU_ASR_BUILD_CT2_WORKER)
    foreach(target IN ITEMS
        hikaru-asr-ctranslate2
        hikaru-asr-worker
        hikaru-asr-ctranslate2-tests)
      target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
    endforeach()
    if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
      target_compile_options(hikaru-asr-crispasr-contract-worker PRIVATE /W4 /permissive- /utf-8)
    endif()
  endif()
  if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
    target_compile_options(hikaru-asr-crispasr-development-runner PRIVATE /W4 /permissive- /utf-8)
    target_compile_options(hikaru-asr-crispasr-worker-contract-tests PRIVATE /W4 /permissive- /utf-8)
  endif()
endif()

# The worker binaries import the same CT2/tokenizer/ORT DLLs even when a test exercises only CrispASR.
if(HIKARU_ASR_BUILD_CT2_WORKER)
  set(HIKARU_ASR_RUNTIME_TARGETS hikaru-asr-worker hikaru-asr-ctranslate2-tests)
  if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
    list(APPEND HIKARU_ASR_RUNTIME_TARGETS hikaru-asr-crispasr-contract-worker)
  endif()
  foreach(target IN LISTS HIKARU_ASR_RUNTIME_TARGETS)
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND "${CMAKE_COMMAND}" -E copy_if_different
              "$<TARGET_FILE:ctranslate2>" "$<TARGET_FILE_DIR:${target}>"
      COMMAND "${CMAKE_COMMAND}" -E copy_if_different
              "${TOKENIZER_DLL}" "$<TARGET_FILE_DIR:${target}>"
      COMMAND "${CMAKE_COMMAND}" -E copy_if_different
              "${ORT_ROOT}/lib/onnxruntime.dll" "$<TARGET_FILE_DIR:${target}>"
      COMMAND "${CMAKE_COMMAND}" -E copy_if_different
              "${ORT_ROOT}/lib/onnxruntime_providers_shared.dll" "$<TARGET_FILE_DIR:${target}>"
      COMMAND "${CMAKE_COMMAND}" -E copy_if_different
              "${VAD_MODEL_SOURCE}" "$<TARGET_FILE_DIR:${target}>")
  endforeach()
endif()

include(CTest)
if(BUILD_TESTING)
  add_test(NAME protocol-core COMMAND hikaru-asr-protocol-tests)
  add_test(NAME fake-worker-contract
           COMMAND hikaru-asr-protocol-tests --fake-contract $<TARGET_FILE:hikaru-asr-fake-worker>)
  add_test(NAME fake-worker-hang
           COMMAND hikaru-asr-protocol-tests --fake-hang $<TARGET_FILE:hikaru-asr-fake-worker> hang-after-ready)
  add_test(NAME fake-worker-child-hang
           COMMAND hikaru-asr-protocol-tests --fake-hang $<TARGET_FILE:hikaru-asr-fake-worker> child-process-hang)
  add_test(NAME crispasr-backend-core
           COMMAND hikaru-asr-crispasr-tests
                   $<TARGET_FILE:hikaru-asr-fake-crispasr-abi>
                   $<TARGET_FILE:hikaru-asr-fake-crispasr-abi-broken>
                   $<TARGET_FILE:hikaru-asr-fake-crispasr-cuda-marker>)
  add_test(NAME parakeet-family-policy COMMAND hikaru-asr-parakeet-family-policy-tests)
  set_tests_properties(protocol-core fake-worker-contract crispasr-backend-core parakeet-family-policy PROPERTIES TIMEOUT 30)
  set_tests_properties(fake-worker-hang fake-worker-child-hang PROPERTIES TIMEOUT 15)
  if(HIKARU_ASR_BUILD_CT2_WORKER)
    add_test(NAME ctranslate2-whisper-core COMMAND hikaru-asr-ctranslate2-tests --self-check)
    if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
      add_test(NAME crispasr-worker-contract
        COMMAND hikaru-asr-crispasr-worker-contract-tests
          $<TARGET_FILE:hikaru-asr-crispasr-contract-worker>
          $<TARGET_FILE:hikaru-asr-fake-crispasr-abi>)
      set_tests_properties(crispasr-worker-contract PROPERTIES TIMEOUT 30)
    else()
      find_package(Python3 REQUIRED COMPONENTS Interpreter)
      add_test(NAME crispasr-release-route-disabled
        COMMAND "${Python3_EXECUTABLE}"
          "${CMAKE_CURRENT_SOURCE_DIR}/tests/assert_crispasr_route_disabled.py"
          "$<TARGET_FILE:hikaru-asr-worker>")
      set_tests_properties(crispasr-release-route-disabled PROPERTIES TIMEOUT 30)
    endif()
    set_tests_properties(ctranslate2-whisper-core PROPERTIES TIMEOUT 30)
  endif()
endif()
