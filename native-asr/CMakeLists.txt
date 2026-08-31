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
option(
  HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT
  "Enable the rejected task-local ONNX Runtime/Silero VAD Candidate B"
  OFF)
option(
  HIKARU_ASR_REPRODUCIBLE_BUILD
  "Enable deterministic compiler/linker flags for the final CPU runtime"
  OFF)
option(
  HIKARU_ASR_MVP_CPU_RUNTIME
  "Restrict the final CPU worker to released CTranslate2 CPU routes"
  OFF)
option(
  HIKARU_ASR_CUDA_RUNTIME
  "Build the optional release CUDA worker/runtime"
  OFF)
set(HIKARU_ASR_CRISPASR_RUNTIME_FILE "" CACHE FILEPATH "Locked CrispASR development runtime")
set(HIKARU_ASR_CRISPASR_RUNTIME_SIZE "" CACHE STRING "Locked CrispASR development runtime size")
set(HIKARU_ASR_CRISPASR_RUNTIME_SHA256 "" CACHE STRING "Locked CrispASR development runtime SHA-256")
set(HIKARU_ASR_CT2_SOURCE_DIR "" CACHE PATH "Pinned CTranslate2 4.8.0 source")
set(HIKARU_ASR_CUDA_TOOLKIT_ROOT "" CACHE PATH "Pinned CUDA 12.9 Update 1 toolkit overlay root")
set(HIKARU_ASR_REAL_NVCC "" CACHE FILEPATH "Pinned CUDA 12.9 Update 1 real nvcc executable")
set(HIKARU_ASR_REAL_NVCC_SIZE "" CACHE STRING "Pinned real nvcc size")
set(HIKARU_ASR_REAL_NVCC_SHA256 "" CACHE STRING "Pinned real nvcc SHA-256")
set(HIKARU_ASR_NVCC_LAUNCHER "" CACHE FILEPATH "Pinned deterministic per-source NVCC launcher")
set(HIKARU_ASR_NVCC_LAUNCHER_SIZE "" CACHE STRING "Pinned NVCC launcher size")
set(HIKARU_ASR_NVCC_LAUNCHER_SHA256 "" CACHE STRING "Pinned NVCC launcher SHA-256")
set(HIKARU_ASR_CUDA_SEED_MANIFEST "" CACHE FILEPATH "Locked CTranslate2 4.8.0 CUDA source seed manifest")
set(HIKARU_ASR_CUDA_SEED_MANIFEST_SHA256 "" CACHE STRING "Locked CUDA source seed manifest SHA-256")
set(HIKARU_ASR_CT2_SOURCE_REVISION "" CACHE STRING "Pinned CTranslate2 source revision")
set(HIKARU_ASR_POCKETFFT_SOURCE_DIR "" CACHE PATH "Pinned pocketfft source")
set(HIKARU_ASR_DNNL_ROOT "" CACHE PATH "Pinned oneDNN 3.1.1 static install")
set(HIKARU_ASR_DNNL_LIBRARY_SIZE "" CACHE STRING "Optional pinned oneDNN static library size")
set(HIKARU_ASR_DNNL_LIBRARY_SHA256 "" CACHE STRING "Optional pinned oneDNN static library SHA-256")
set(HIKARU_ASR_CANDIDATE_B_ROOT "" CACHE PATH "Locked Candidate B input root")
set(HIKARU_ASR_REPRODUCIBLE_PATH_ROOT "" CACHE PATH "Optional path-remap root for reproducible builds")
set(HIKARU_ASR_CT2_PREBUILT_ROOT "" CACHE PATH "Optional locked prebuilt CTranslate2 root")
set(HIKARU_ASR_CT2_PREBUILT_DLL_SIZE "" CACHE STRING "Pinned prebuilt CTranslate2 DLL size")
set(HIKARU_ASR_CT2_PREBUILT_DLL_SHA256 "" CACHE STRING "Pinned prebuilt CTranslate2 DLL SHA-256")
set(HIKARU_ASR_CT2_PREBUILT_IMPLIB_SIZE "" CACHE STRING "Pinned prebuilt CTranslate2 import library size")
set(HIKARU_ASR_CT2_PREBUILT_IMPLIB_SHA256 "" CACHE STRING "Pinned prebuilt CTranslate2 import library SHA-256")
option(
  HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY
  "Enable the task-local faster-whisper 1.2.1 fallback parity candidate"
  OFF)
option(
  HIKARU_ASR_ENABLE_WHISPER_PARITY_BISECT
  "Enable the task-local Whisper execution-parity discovery probe"
  OFF)
set(HIKARU_ASR_ZLIB_ARCHIVE "" CACHE FILEPATH "Exact task-local zlib 1.3.1 archive")
set(HIKARU_ASR_ZLIB_SOURCE_DIR "" CACHE PATH "Exact task-local zlib 1.3.1 source")

if(HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT AND NOT HIKARU_ASR_BUILD_CT2_WORKER)
  message(FATAL_ERROR "T07 CUDA development requires HIKARU_ASR_BUILD_CT2_WORKER=ON")
endif()
if(HIKARU_ASR_CUDA_RUNTIME AND NOT HIKARU_ASR_BUILD_CT2_WORKER)
  message(FATAL_ERROR "The release CUDA runtime requires HIKARU_ASR_BUILD_CT2_WORKER=ON")
endif()
if(HIKARU_ASR_CUDA_RUNTIME AND HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT)
  message(FATAL_ERROR "Release CUDA and CUDA development modes are independent")
endif()
if(HIKARU_ASR_CUDA_RUNTIME AND HIKARU_ASR_MVP_CPU_RUNTIME)
  message(FATAL_ERROR "CPU and CUDA release runtimes must be built independently")
endif()
if(HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT AND NOT HIKARU_ASR_BUILD_CT2_WORKER)
  message(FATAL_ERROR "Candidate B development requires HIKARU_ASR_BUILD_CT2_WORKER=ON")
endif()
if(HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY
    AND (NOT HIKARU_ASR_BUILD_CT2_WORKER
         OR NOT HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT))
  message(FATAL_ERROR "Whisper fallback parity requires the Candidate B development runtime")
endif()
if(HIKARU_ASR_ENABLE_WHISPER_PARITY_BISECT
    AND (NOT HIKARU_ASR_BUILD_CT2_WORKER
         OR NOT HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT))
  message(FATAL_ERROR "Whisper execution-parity discovery requires the task-local CUDA build")
endif()
if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT AND NOT HIKARU_ASR_BUILD_CT2_WORKER)
  message(FATAL_ERROR "T09 CrispASR development requires HIKARU_ASR_BUILD_CT2_WORKER=ON")
endif()
if(HIKARU_ASR_MVP_CPU_RUNTIME
    AND (HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT
         OR HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT
         OR HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT
         OR HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY
         OR HIKARU_ASR_ENABLE_WHISPER_PARITY_BISECT))
  message(FATAL_ERROR "The final MVP CPU runtime cannot enable development capabilities")
endif()
if(HIKARU_ASR_CUDA_RUNTIME
    AND (HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT
         OR HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT
         OR HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY
         OR HIKARU_ASR_ENABLE_WHISPER_PARITY_BISECT))
  message(FATAL_ERROR "The release CUDA runtime cannot enable development capabilities")
endif()

if(MSVC AND HIKARU_ASR_REPRODUCIBLE_BUILD)
  file(TO_NATIVE_PATH "${CMAKE_BINARY_DIR}" HIKARU_ASR_REPRODUCIBLE_BUILD_NATIVE_PATH)
  file(TO_NATIVE_PATH "${CMAKE_CURRENT_SOURCE_DIR}" HIKARU_ASR_NATIVE_SOURCE_NATIVE_PATH)
  add_compile_options(
    /Brepro
    /experimental:deterministic
    "/pathmap:${HIKARU_ASR_REPRODUCIBLE_BUILD_NATIVE_PATH}=build"
    "/pathmap:${HIKARU_ASR_NATIVE_SOURCE_NATIVE_PATH}=native-asr")
  if(HIKARU_ASR_REPRODUCIBLE_PATH_ROOT)
    file(TO_NATIVE_PATH
      "${HIKARU_ASR_REPRODUCIBLE_PATH_ROOT}"
      HIKARU_ASR_REPRODUCIBLE_SOURCE_NATIVE_PATH)
    add_compile_options("/pathmap:${HIKARU_ASR_REPRODUCIBLE_SOURCE_NATIVE_PATH}=source")
  endif()
  add_link_options(/Brepro)
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
target_compile_definitions(hikaru-asr-crispasr-test-adapter PRIVATE
  HIKARU_ASR_CRISPASR_TEST_RUNTIME_IDENTITY_BYPASS=1
  HIKARU_ASR_CRISPASR_TEST_VAD_IDENTITY_BYPASS=1)

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
if(HIKARU_ASR_MVP_CPU_RUNTIME OR HIKARU_ASR_CUDA_RUNTIME)
  set_target_properties(
    hikaru-asr-fake-worker
    hikaru-asr-crispasr
    hikaru-asr-parakeet-family-policy
    hikaru-asr-crispasr-test-adapter
    hikaru-asr-fake-crispasr-abi
    hikaru-asr-fake-crispasr-cuda-marker
    hikaru-asr-fake-crispasr-abi-broken
    hikaru-asr-crispasr-tests
    hikaru-asr-parakeet-family-policy-tests
    PROPERTIES EXCLUDE_FROM_ALL TRUE)
endif()
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
  file(TO_CMAKE_PATH
    "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local"
    T10R_LOCAL_ROOT)
  set(T10R_VAD_MODEL "${T10R_LOCAL_ROOT}/vad/ggml-silero-v6.2.0.bin")
  set(T10R_VAD_MODEL_AVAILABLE OFF)
  if(EXISTS "${T10R_VAD_MODEL}")
    file(SIZE "${T10R_VAD_MODEL}" T10R_VAD_MODEL_SIZE)
    file(SHA256 "${T10R_VAD_MODEL}" T10R_VAD_MODEL_SHA256)
    if(NOT T10R_VAD_MODEL_SIZE EQUAL 885098
        OR NOT T10R_VAD_MODEL_SHA256 STREQUAL
          "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987")
      message(FATAL_ERROR "ReazonSpeech R2 Silero VAD identity drifted")
    endif()
    set(T10R_VAD_MODEL_AVAILABLE ON)
  endif()
  target_compile_definitions(hikaru-asr-crispasr-development-runner PRIVATE
    "T09_LOCAL_ROOT=\"${T09_LOCAL_ROOT}\""
    "T10_LOCAL_ROOT=\"${T10_LOCAL_ROOT}\""
    "T10R_LOCAL_ROOT=\"${T10R_LOCAL_ROOT}\"")
  target_link_libraries(hikaru-asr-crispasr-development-runner
    PRIVATE hikaru-asr-crispasr hikaru-asr-parakeet-family-policy bcrypt psapi)
endif()

if(HIKARU_ASR_BUILD_CT2_WORKER)
if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "The production CTranslate2 worker currently supports Windows x64 only")
endif()

foreach(required_variable IN ITEMS
    HIKARU_ASR_CT2_SOURCE_DIR
    HIKARU_ASR_CT2_SOURCE_REVISION
    HIKARU_ASR_POCKETFFT_SOURCE_DIR)
  if("${${required_variable}}" STREQUAL "")
    message(FATAL_ERROR "${required_variable} is required for a CTranslate2 worker build")
  endif()
endforeach()
if(NOT HIKARU_ASR_CT2_SOURCE_REVISION STREQUAL "54a546cec4262f9770d4674a0bfb4ac3c4f05698")
  message(FATAL_ERROR "CTranslate2 source revision drifted from the pinned 4.8.0 commit")
endif()
file(REAL_PATH "${HIKARU_ASR_CT2_SOURCE_DIR}" CT2_SOURCE_DIR)
file(REAL_PATH "${HIKARU_ASR_POCKETFFT_SOURCE_DIR}" POCKETFFT_SOURCE_DIR)
if(NOT HIKARU_ASR_CT2_PREBUILT_ROOT)
  if(NOT HIKARU_ASR_DNNL_ROOT)
    message(FATAL_ERROR "HIKARU_ASR_DNNL_ROOT is required when building CTranslate2 from source")
  endif()
  file(REAL_PATH "${HIKARU_ASR_DNNL_ROOT}" DNNL_ROOT)
endif()
if(NOT EXISTS "${CT2_SOURCE_DIR}/include/ctranslate2/models/whisper.h")
  message(FATAL_ERROR "Missing pinned CTranslate2 source")
endif()
if(NOT EXISTS "${POCKETFFT_SOURCE_DIR}/pocketfft_hdronly.h")
  message(FATAL_ERROR "Missing pinned pocketfft source")
endif()
if(NOT HIKARU_ASR_CT2_PREBUILT_ROOT
    AND (NOT EXISTS "${DNNL_ROOT}/include/dnnl.h"
         OR NOT EXISTS "${DNNL_ROOT}/lib/dnnl.lib"))
  message(FATAL_ERROR "Missing pinned oneDNN static install")
endif()
if(HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT)
  if(NOT HIKARU_ASR_CANDIDATE_B_ROOT)
    message(FATAL_ERROR "Candidate B development requires HIKARU_ASR_CANDIDATE_B_ROOT")
  endif()
  file(REAL_PATH "${HIKARU_ASR_CANDIDATE_B_ROOT}" CANDIDATE_B_ROOT)
  set(ORT_ROOT "${CANDIDATE_B_ROOT}/extracted/onnxruntime-win-x64-1.28.0")
  set(ORT_ARCHIVE "${CANDIDATE_B_ROOT}/downloads/onnxruntime-win-x64-1.28.0.zip")
  set(VAD_MODEL_SOURCE "${CANDIDATE_B_ROOT}/model/silero_vad_v6.onnx")
  get_filename_component(T06_LOCAL_ROOT_REAL "${CANDIDATE_B_ROOT}" DIRECTORY)
else()
  set(T06_LOCAL_ROOT_REAL "")
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
if(NOT HIKARU_ASR_CT2_PREBUILT_ROOT)
  require_pinned_file(
    "${DNNL_ROOT}/include/dnnl.h"
    826
    23e40186069086c288f70b397485a20b59a8fedce33194ea70e107d91fddaae4
    "oneDNN header")
  if(HIKARU_ASR_DNNL_LIBRARY_SIZE OR HIKARU_ASR_DNNL_LIBRARY_SHA256)
    if(NOT HIKARU_ASR_DNNL_LIBRARY_SIZE OR NOT HIKARU_ASR_DNNL_LIBRARY_SHA256)
      message(FATAL_ERROR "Both oneDNN static library size and SHA-256 are required together")
    endif()
    require_pinned_file(
      "${DNNL_ROOT}/lib/dnnl.lib"
      "${HIKARU_ASR_DNNL_LIBRARY_SIZE}"
      "${HIKARU_ASR_DNNL_LIBRARY_SHA256}"
      "oneDNN static library")
  endif()
endif()

if(HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT)
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
endif()
if(HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY)
  if(NOT HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT
      OR NOT HIKARU_ASR_ZLIB_ARCHIVE
      OR NOT HIKARU_ASR_ZLIB_SOURCE_DIR)
    message(FATAL_ERROR "Fallback parity is task-local CUDA-only and requires exact zlib inputs")
  endif()
  enable_language(C)
  require_pinned_file(
    "${HIKARU_ASR_ZLIB_ARCHIVE}"
    1512791
    9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
    "official zlib 1.3.1 archive")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/LICENSE" 1002 845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243 "zlib 1.3.1 license")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/zlib.h" 96829 8a5579af72ea4f427ff00a4150f0ccb3fc5c1e4379f726e101133b1ab9fc600c "zlib 1.3.1 header")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/zconf.h" 16500 f5134250a67d57459234b63858f0d9d3ef8dcc48e9e1028d3f4fdcf6eae677ae "zlib 1.3.1 config header")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/adler32.c" 4964 9cd1443a24ff2a3053961695bd432035c58347386a420d3388232376ebabe211 "zlib 1.3.1 adler32")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/compress.c" 2613 86f802c16a965e7a28737e3730b4e576c5ba40981753967e3e30916f4dc1b4b1 "zlib 1.3.1 compress")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/crc32.c" 31605 8fd16f0a7714d51c89c2eb37eb98ec15e8a4dc57ba343e7b7398b19144039fda "zlib 1.3.1 crc32")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/deflate.c" 81731 3b956337350f94c34987750f785587ef33d9c89ceaebb7c2afb189c956360cbe "zlib 1.3.1 deflate")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/trees.c" 40937 f63c68c16c05fcd196050529d1a0e7657960e4136b9987d90a6ac3e58a964b0f "zlib 1.3.1 trees")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/zutil.c" 7179 8ced40d8c88588811edd2bdb35b7439983d5e1f8e9e32b8a3b244731f3c317b7 "zlib 1.3.1 zutil")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/zutil.h" 6677 dddb2dc7a1dc339ecf2c8e089b366f08bb731c0839c7110240d17ce731bb4fea "zlib 1.3.1 zutil header")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/deflate.h" 14041 48baf016326d8d5e3e32ac8153cc7e22f854b8e6834830b167b998a7fb1e7989 "zlib 1.3.1 deflate header")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/trees.h" 8472 bb0a9d3ca88ee00c81adb7c636e73b97085f6ef1b52d6d58edbe2b6dc3adeb4d "zlib 1.3.1 trees header")
  require_pinned_file("${HIKARU_ASR_ZLIB_SOURCE_DIR}/crc32.h" 591749 9a2223575183ac2ee8a247f20bf3ac066e8bd0140369556bdbdffc777435749e "zlib 1.3.1 crc32 table")
  add_library(hikaru-asr-zlib-static STATIC
    "${HIKARU_ASR_ZLIB_SOURCE_DIR}/adler32.c"
    "${HIKARU_ASR_ZLIB_SOURCE_DIR}/compress.c"
    "${HIKARU_ASR_ZLIB_SOURCE_DIR}/crc32.c"
    "${HIKARU_ASR_ZLIB_SOURCE_DIR}/deflate.c"
    "${HIKARU_ASR_ZLIB_SOURCE_DIR}/trees.c"
    "${HIKARU_ASR_ZLIB_SOURCE_DIR}/zutil.c")
  target_include_directories(hikaru-asr-zlib-static PUBLIC "${HIKARU_ASR_ZLIB_SOURCE_DIR}")
endif()
if(HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT)
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
endif()

if(EXISTS "${CT2_SOURCE_DIR}/.git")
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
      OR NOT CT2_GIT_COMMIT STREQUAL HIKARU_ASR_CT2_SOURCE_REVISION
      OR NOT CT2_GIT_STATUS STREQUAL "")
    message(FATAL_ERROR "CTranslate2 source is not the clean pinned 4.8.0 commit")
  endif()
endif()

set(WITH_MKL OFF CACHE BOOL "" FORCE)
set(WITH_DNNL ON CACHE BOOL "" FORCE)
if(NOT HIKARU_ASR_CT2_PREBUILT_ROOT)
  set(DNNL_INCLUDE_DIR "${DNNL_ROOT}/include" CACHE PATH "" FORCE)
  set(DNNL_LIBRARY "${DNNL_ROOT}/lib/dnnl.lib" CACHE FILEPATH "" FORCE)
endif()
set(WITH_OPENBLAS OFF CACHE BOOL "" FORCE)
set(WITH_RUY OFF CACHE BOOL "" FORCE)
if(HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT OR HIKARU_ASR_CUDA_RUNTIME)
  if(HIKARU_ASR_CUDA_RUNTIME)
    if(NOT HIKARU_ASR_CUDA_TOOLKIT_ROOT)
      message(FATAL_ERROR "The release CUDA runtime requires HIKARU_ASR_CUDA_TOOLKIT_ROOT")
    endif()
    file(TO_CMAKE_PATH "${HIKARU_ASR_CUDA_TOOLKIT_ROOT}" CUDA_TOOLKIT_ROOT_NORMALIZED)
    foreach(required_cuda_build_input IN ITEMS
        HIKARU_ASR_REAL_NVCC
        HIKARU_ASR_REAL_NVCC_SIZE
        HIKARU_ASR_REAL_NVCC_SHA256
        HIKARU_ASR_NVCC_LAUNCHER
        HIKARU_ASR_NVCC_LAUNCHER_SIZE
        HIKARU_ASR_NVCC_LAUNCHER_SHA256
        HIKARU_ASR_CUDA_SEED_MANIFEST
        HIKARU_ASR_CUDA_SEED_MANIFEST_SHA256)
      if("${${required_cuda_build_input}}" STREQUAL "")
        message(FATAL_ERROR "${required_cuda_build_input} is required for the release CUDA runtime")
      endif()
    endforeach()
    file(REAL_PATH "${HIKARU_ASR_REAL_NVCC}" CUDA_REAL_NVCC)
    file(REAL_PATH "${HIKARU_ASR_NVCC_LAUNCHER}" CUDA_NVCC_LAUNCHER)
    file(REAL_PATH "${HIKARU_ASR_CUDA_SEED_MANIFEST}" CUDA_SEED_MANIFEST)
    file(REAL_PATH "${CUDA_TOOLKIT_ROOT_NORMALIZED}" CUDA_TOOLKIT_ROOT_REAL)
    file(REAL_PATH "${CUDA_TOOLKIT_ROOT_REAL}/bin/nvcc.exe" CUDA_CANONICAL_NVCC)
    file(REAL_PATH "${CUDA_TOOLKIT_ROOT_REAL}/bin/nvcc-real.exe" CUDA_CANONICAL_REAL_NVCC)
    if(NOT CUDA_NVCC_LAUNCHER STREQUAL CUDA_CANONICAL_NVCC)
      message(FATAL_ERROR "The CUDA toolkit overlay bin/nvcc.exe must be the deterministic launcher")
    endif()
    if(NOT CUDA_REAL_NVCC STREQUAL CUDA_CANONICAL_REAL_NVCC)
      message(FATAL_ERROR "The official real nvcc must be locked separately at bin/nvcc-real.exe")
    endif()
    require_pinned_file(
      "${CUDA_REAL_NVCC}"
      "${HIKARU_ASR_REAL_NVCC_SIZE}"
      "${HIKARU_ASR_REAL_NVCC_SHA256}"
      "official real nvcc")
    require_pinned_file(
      "${CUDA_NVCC_LAUNCHER}"
      "${HIKARU_ASR_NVCC_LAUNCHER_SIZE}"
      "${HIKARU_ASR_NVCC_LAUNCHER_SHA256}"
      "deterministic NVCC launcher")
    file(SHA256 "${CUDA_SEED_MANIFEST}" CUDA_SEED_MANIFEST_ACTUAL_SHA256)
    if(NOT CUDA_SEED_MANIFEST_ACTUAL_SHA256 STREQUAL HIKARU_ASR_CUDA_SEED_MANIFEST_SHA256)
      message(FATAL_ERROR "CUDA seed manifest identity drifted")
    endif()
    execute_process(
      COMMAND "${CUDA_REAL_NVCC}" --version
      RESULT_VARIABLE CUDA_NVCC_VERSION_RESULT
      OUTPUT_VARIABLE CUDA_NVCC_VERSION_OUTPUT
      ERROR_VARIABLE CUDA_NVCC_VERSION_ERROR)
    string(CONCAT CUDA_NVCC_VERSION_TEXT "${CUDA_NVCC_VERSION_OUTPUT}" "${CUDA_NVCC_VERSION_ERROR}")
    if(NOT CUDA_NVCC_VERSION_RESULT EQUAL 0
        OR NOT CUDA_NVCC_VERSION_TEXT MATCHES "release 12\\.9, V12\\.9\\.86")
      message(FATAL_ERROR "Expected the pinned CUDA 12.9 Update 1 nvcc 12.9.86")
    endif()
    file(READ "${CUDA_SEED_MANIFEST}" CUDA_SEED_JSON)
    string(JSON CUDA_SEED_SCHEMA GET "${CUDA_SEED_JSON}" schemaVersion)
    string(JSON CUDA_SEED_ALGORITHM GET "${CUDA_SEED_JSON}" algorithm)
    string(JSON CUDA_SEED_PREFIX GET "${CUDA_SEED_JSON}" canonicalSourcePrefix)
    string(JSON CUDA_SEED_COUNT LENGTH "${CUDA_SEED_JSON}" sources)
    if(NOT CUDA_SEED_SCHEMA EQUAL 1
        OR NOT CUDA_SEED_ALGORITHM STREQUAL "sha256-utf8-canonical-identity-first-u32-hex-v1"
        OR NOT CUDA_SEED_PREFIX STREQUAL "ctranslate2-4.8.0/"
        OR NOT CUDA_SEED_COUNT EQUAL 25)
      message(FATAL_ERROR "CUDA seed manifest contract drifted")
    endif()
    math(EXPR CUDA_SEED_LAST "${CUDA_SEED_COUNT} - 1")
    set(CUDA_SEED_PATHS "")
    set(CUDA_SEED_VALUES "")
    set(CUDA_SEED_PREVIOUS_PATH "")
    foreach(CUDA_SEED_INDEX RANGE 0 ${CUDA_SEED_LAST})
      string(JSON CUDA_SEED_PATH GET "${CUDA_SEED_JSON}" sources ${CUDA_SEED_INDEX} path)
      string(JSON CUDA_SEED_VALUE GET "${CUDA_SEED_JSON}" sources ${CUDA_SEED_INDEX} seed)
      string(LENGTH "${CUDA_SEED_VALUE}" CUDA_SEED_VALUE_LENGTH)
      if(CUDA_SEED_PATH MATCHES "(^|/)\\.\\.(/|$)"
          OR CUDA_SEED_PATH MATCHES "^/"
          OR CUDA_SEED_PATH MATCHES "\\\\"
          OR NOT CUDA_SEED_PATH MATCHES "\\.cu$"
          OR NOT CUDA_SEED_VALUE MATCHES "^0x[0-9a-f]+$"
          OR NOT CUDA_SEED_VALUE_LENGTH EQUAL 10
          OR CUDA_SEED_VALUE STREQUAL "0x00000000")
        message(FATAL_ERROR "Invalid CUDA source seed mapping: ${CUDA_SEED_PATH} ${CUDA_SEED_VALUE}")
      endif()
      if(CUDA_SEED_PREVIOUS_PATH AND NOT CUDA_SEED_PREVIOUS_PATH STRLESS CUDA_SEED_PATH)
        message(FATAL_ERROR "CUDA source seed mappings must be uniquely sorted")
      endif()
      if(NOT EXISTS "${CT2_SOURCE_DIR}/${CUDA_SEED_PATH}")
        message(FATAL_ERROR "Locked CUDA source is missing: ${CUDA_SEED_PATH}")
      endif()
      list(FIND CUDA_SEED_VALUES "${CUDA_SEED_VALUE}" CUDA_DUPLICATE_SEED_INDEX)
      if(NOT CUDA_DUPLICATE_SEED_INDEX EQUAL -1)
        message(FATAL_ERROR "Duplicate CUDA source seed: ${CUDA_SEED_VALUE}")
      endif()
      string(SHA256 CUDA_SEED_DERIVED "${CUDA_SEED_PREFIX}${CUDA_SEED_PATH}")
      string(SUBSTRING "${CUDA_SEED_DERIVED}" 0 8 CUDA_SEED_DERIVED_PREFIX)
      if(NOT CUDA_SEED_VALUE STREQUAL "0x${CUDA_SEED_DERIVED_PREFIX}")
        message(FATAL_ERROR "CUDA source seed does not match the locked derivation: ${CUDA_SEED_PATH}")
      endif()
      execute_process(
        COMMAND "${CUDA_NVCC_LAUNCHER}" --hikaru-seed-for "${CUDA_SEED_PATH}"
        RESULT_VARIABLE CUDA_LAUNCHER_SEED_RESULT
        OUTPUT_VARIABLE CUDA_LAUNCHER_SEED_OUTPUT
        ERROR_VARIABLE CUDA_LAUNCHER_SEED_ERROR
        OUTPUT_STRIP_TRAILING_WHITESPACE)
      if(NOT CUDA_LAUNCHER_SEED_RESULT EQUAL 0
          OR NOT CUDA_LAUNCHER_SEED_OUTPUT STREQUAL CUDA_SEED_VALUE)
        message(FATAL_ERROR "NVCC launcher mapping disagrees for ${CUDA_SEED_PATH}: ${CUDA_LAUNCHER_SEED_ERROR}")
      endif()
      list(APPEND CUDA_SEED_PATHS "${CUDA_SEED_PATH}")
      list(APPEND CUDA_SEED_VALUES "${CUDA_SEED_VALUE}")
      set(CUDA_SEED_PREVIOUS_PATH "${CUDA_SEED_PATH}")
    endforeach()
    file(REAL_PATH "${CT2_SOURCE_DIR}" CUDA_CT2_SOURCE_ROOT)
    file(REAL_PATH "${CMAKE_BINARY_DIR}" CUDA_REPRODUCIBLE_BUILD_ROOT)
    file(REAL_PATH "${CMAKE_CURRENT_SOURCE_DIR}" CUDA_NATIVE_ASR_SOURCE_ROOT)
    file(REAL_PATH "${HIKARU_ASR_REPRODUCIBLE_PATH_ROOT}" CUDA_REPRODUCIBLE_SOURCE_ROOT)
    file(TO_CMAKE_PATH "${CUDA_CT2_SOURCE_ROOT}" CUDA_CT2_SOURCE_ROOT_CONFIG)
    file(TO_CMAKE_PATH "${CUDA_REPRODUCIBLE_BUILD_ROOT}" CUDA_REPRODUCIBLE_BUILD_PATH)
    file(TO_CMAKE_PATH "${CUDA_NATIVE_ASR_SOURCE_ROOT}" CUDA_NATIVE_ASR_SOURCE_PATH)
    file(TO_CMAKE_PATH "${CUDA_REPRODUCIBLE_SOURCE_ROOT}" CUDA_REPRODUCIBLE_SOURCE_PATH)
    set(CUDA_NVCC_LAUNCHER_CONFIG "${CUDA_TOOLKIT_ROOT_REAL}/bin/hikaru-nvcc-launcher.cfg")
    file(WRITE "${CUDA_NVCC_LAUNCHER_CONFIG}"
      "schemaVersion=2\n"
      "ct2SourceRoot=${CUDA_CT2_SOURCE_ROOT_CONFIG}\n"
      "pathmap0Label=build\npathmap0Root=${CUDA_REPRODUCIBLE_BUILD_PATH}\n"
      "pathmap1Label=native-asr\npathmap1Root=${CUDA_NATIVE_ASR_SOURCE_PATH}\n"
      "pathmap2Label=source\npathmap2Root=${CUDA_REPRODUCIBLE_SOURCE_PATH}\n")
    execute_process(
      COMMAND "${CUDA_NVCC_LAUNCHER}" --hikaru-self-test
      RESULT_VARIABLE CUDA_LAUNCHER_SELF_TEST_RESULT
      OUTPUT_VARIABLE CUDA_LAUNCHER_SELF_TEST_OUTPUT
      ERROR_VARIABLE CUDA_LAUNCHER_SELF_TEST_ERROR
      OUTPUT_STRIP_TRAILING_WHITESPACE)
    if(NOT CUDA_LAUNCHER_SELF_TEST_RESULT EQUAL 0
        OR NOT CUDA_LAUNCHER_SELF_TEST_OUTPUT STREQUAL "ok sources=25")
      message(FATAL_ERROR "NVCC launcher self-test failed: ${CUDA_LAUNCHER_SELF_TEST_ERROR}")
    endif()
  else()
    if(NOT DEFINED ENV{CUDA_PATH} OR "$ENV{CUDA_PATH}" STREQUAL "")
      message(FATAL_ERROR "T07 CUDA development requires the locked CUDA_PATH")
    endif()
    file(TO_CMAKE_PATH "$ENV{CUDA_PATH}" CUDA_TOOLKIT_ROOT_NORMALIZED)
  endif()
  set(CUDA_TOOLKIT_ROOT_DIR "${CUDA_TOOLKIT_ROOT_NORMALIZED}" CACHE PATH "" FORCE)
  set(WITH_CUDA ON CACHE BOOL "" FORCE)
  set(CUDA_DYNAMIC_LOADING ON CACHE BOOL "" FORCE)
  if(HIKARU_ASR_CUDA_RUNTIME)
    if(NOT HIKARU_ASR_REPRODUCIBLE_BUILD OR NOT HIKARU_ASR_REPRODUCIBLE_PATH_ROOT)
      message(FATAL_ERROR "The release CUDA runtime requires reproducible source and build path mapping")
    endif()
    set(CUDA_ARCH_LIST "6.1;7.5;8.6;8.9" CACHE STRING "" FORCE)
    set(CUDA_NVCC_FLAGS
      "-gencode=arch=compute_120,code=sm_120"
      "-gencode=arch=compute_120,code=compute_120"
      "-Xcompiler=/Brepro"
      "-Xcompiler=/experimental:deterministic"
      "-Xcompiler=/pathmap:${CUDA_REPRODUCIBLE_BUILD_PATH}=build"
      "-Xcompiler=/pathmap:${CUDA_NATIVE_ASR_SOURCE_PATH}=native-asr"
      "-Xcompiler=/pathmap:${CUDA_REPRODUCIBLE_SOURCE_PATH}=source"
      CACHE STRING "" FORCE)
    set(CUDA_USE_STATIC_CUDA_RUNTIME ON CACHE BOOL "" FORCE)
  else()
    set(CUDA_ARCH_LIST "8.6" CACHE STRING "" FORCE)
    set(CUDA_NVCC_FLAGS "" CACHE STRING "" FORCE)
  endif()
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
if(HIKARU_ASR_CT2_PREBUILT_ROOT)
  foreach(required_identity IN ITEMS
      HIKARU_ASR_CT2_PREBUILT_DLL_SIZE
      HIKARU_ASR_CT2_PREBUILT_DLL_SHA256
      HIKARU_ASR_CT2_PREBUILT_IMPLIB_SIZE
      HIKARU_ASR_CT2_PREBUILT_IMPLIB_SHA256)
    if("${${required_identity}}" STREQUAL "")
      message(FATAL_ERROR "${required_identity} is required with HIKARU_ASR_CT2_PREBUILT_ROOT")
    endif()
  endforeach()
  set(CT2_PREBUILT_DLL "${HIKARU_ASR_CT2_PREBUILT_ROOT}/bin/ctranslate2.dll")
  set(CT2_PREBUILT_IMPLIB "${HIKARU_ASR_CT2_PREBUILT_ROOT}/ctranslate2/ctranslate2.lib")
  require_pinned_file(
    "${CT2_PREBUILT_DLL}"
    "${HIKARU_ASR_CT2_PREBUILT_DLL_SIZE}"
    "${HIKARU_ASR_CT2_PREBUILT_DLL_SHA256}"
    "prebuilt CTranslate2 DLL")
  require_pinned_file(
    "${CT2_PREBUILT_IMPLIB}"
    "${HIKARU_ASR_CT2_PREBUILT_IMPLIB_SIZE}"
    "${HIKARU_ASR_CT2_PREBUILT_IMPLIB_SHA256}"
    "prebuilt CTranslate2 import library")
  add_library(ctranslate2 SHARED IMPORTED GLOBAL)
  set_target_properties(ctranslate2 PROPERTIES
    IMPORTED_LOCATION "${CT2_PREBUILT_DLL}"
    IMPORTED_IMPLIB "${CT2_PREBUILT_IMPLIB}"
    INTERFACE_INCLUDE_DIRECTORIES "${CT2_SOURCE_DIR}/include")
else()
  set(CT2_BINARY_DIR "${CMAKE_BINARY_DIR}/ctranslate2")
  add_subdirectory("${CT2_SOURCE_DIR}" "${CT2_BINARY_DIR}" EXCLUDE_FROM_ALL)
  if(MSVC AND HIKARU_ASR_REPRODUCIBLE_BUILD AND ENABLE_CPU_DISPATCH)
    set(CT2_GENERATED_ISA_SOURCES
      "${CT2_BINARY_DIR}/kernels_avx.cc"
      "${CT2_BINARY_DIR}/kernels_avx2.cc"
      "${CT2_BINARY_DIR}/kernels_avx512.cc")
    set(CT2_STABLE_ISA_SOURCES
      "${CMAKE_CURRENT_SOURCE_DIR}/src/ctranslate2/kernels_avx.cc"
      "${CMAKE_CURRENT_SOURCE_DIR}/src/ctranslate2/kernels_avx2.cc"
      "${CMAKE_CURRENT_SOURCE_DIR}/src/ctranslate2/kernels_avx512.cc")
    get_target_property(CT2_TARGET_SOURCES ctranslate2 SOURCES)
    foreach(CT2_GENERATED_ISA_SOURCE IN LISTS CT2_GENERATED_ISA_SOURCES)
      set(CT2_GENERATED_ISA_SOURCE_COUNT 0)
      foreach(CT2_TARGET_SOURCE IN LISTS CT2_TARGET_SOURCES)
        if(CT2_TARGET_SOURCE STREQUAL CT2_GENERATED_ISA_SOURCE)
          math(EXPR CT2_GENERATED_ISA_SOURCE_COUNT "${CT2_GENERATED_ISA_SOURCE_COUNT} + 1")
        endif()
      endforeach()
      if(NOT CT2_GENERATED_ISA_SOURCE_COUNT EQUAL 1)
        message(FATAL_ERROR
          "Expected exactly one generated CTranslate2 ISA source: ${CT2_GENERATED_ISA_SOURCE}")
      endif()
    endforeach()
    list(REMOVE_ITEM CT2_TARGET_SOURCES ${CT2_GENERATED_ISA_SOURCES})
    set_property(TARGET ctranslate2 PROPERTY SOURCES "${CT2_TARGET_SOURCES}")
    target_sources(ctranslate2 PRIVATE ${CT2_STABLE_ISA_SOURCES})
    set_source_files_properties(
      "${CMAKE_CURRENT_SOURCE_DIR}/src/ctranslate2/kernels_avx.cc"
      TARGET_DIRECTORY ctranslate2
      PROPERTIES COMPILE_FLAGS "/arch:AVX")
    set_source_files_properties(
      "${CMAKE_CURRENT_SOURCE_DIR}/src/ctranslate2/kernels_avx2.cc"
      TARGET_DIRECTORY ctranslate2
      PROPERTIES COMPILE_FLAGS "/arch:AVX2")
    set_source_files_properties(
      "${CMAKE_CURRENT_SOURCE_DIR}/src/ctranslate2/kernels_avx512.cc"
      TARGET_DIRECTORY ctranslate2
      PROPERTIES COMPILE_FLAGS "/arch:AVX512")
    get_target_property(CT2_REPLACED_TARGET_SOURCES ctranslate2 SOURCES)
    foreach(CT2_GENERATED_ISA_SOURCE IN LISTS CT2_GENERATED_ISA_SOURCES)
      if(CT2_GENERATED_ISA_SOURCE IN_LIST CT2_REPLACED_TARGET_SOURCES)
        message(FATAL_ERROR
          "Generated CTranslate2 ISA source remained in the target: ${CT2_GENERATED_ISA_SOURCE}")
      endif()
    endforeach()
    foreach(CT2_STABLE_ISA_SOURCE IN LISTS CT2_STABLE_ISA_SOURCES)
      set(CT2_STABLE_ISA_SOURCE_COUNT 0)
      foreach(CT2_TARGET_SOURCE IN LISTS CT2_REPLACED_TARGET_SOURCES)
        if(CT2_TARGET_SOURCE STREQUAL CT2_STABLE_ISA_SOURCE)
          math(EXPR CT2_STABLE_ISA_SOURCE_COUNT "${CT2_STABLE_ISA_SOURCE_COUNT} + 1")
        endif()
      endforeach()
      if(NOT CT2_STABLE_ISA_SOURCE_COUNT EQUAL 1)
        message(FATAL_ERROR
          "Stable CTranslate2 ISA wrapper is not unique in the target: ${CT2_STABLE_ISA_SOURCE}")
      endif()
    endforeach()
  endif()
endif()

find_program(CARGO_EXECUTABLE cargo REQUIRED)
set(TOKENIZER_MANIFEST "${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-ffi/Cargo.toml")
set(TOKENIZER_TARGET_DIR "${CMAKE_BINARY_DIR}/tokenizer")
set(TOKENIZER_DLL "${TOKENIZER_TARGET_DIR}/release/hikaru_asr_tokenizer.dll")
set(TOKENIZER_IMPLIB "${TOKENIZER_TARGET_DIR}/release/hikaru_asr_tokenizer.dll.lib")
set(TOKENIZER_CARGO_ENV
  "CARGO_TARGET_DIR=${TOKENIZER_TARGET_DIR}"
  "CARGO_INCREMENTAL=0")
if(MSVC AND HIKARU_ASR_REPRODUCIBLE_BUILD)
  if(DEFINED ENV{RUSTFLAGS} AND NOT "$ENV{RUSTFLAGS}" STREQUAL "")
    message(FATAL_ERROR
      "Reproducible tokenizer builds cannot safely parse RUSTFLAGS; use CARGO_ENCODED_RUSTFLAGS instead")
  endif()
  set(TOKENIZER_RUSTFLAGS
    "-Clink-arg=/Brepro"
    "--remap-path-prefix=${CMAKE_BINARY_DIR}=build"
    "--remap-path-prefix=${CMAKE_CURRENT_SOURCE_DIR}=native-asr")
  if(HIKARU_ASR_REPRODUCIBLE_PATH_ROOT)
    list(APPEND TOKENIZER_RUSTFLAGS
      "--remap-path-prefix=${HIKARU_ASR_REPRODUCIBLE_PATH_ROOT}=source")
  endif()
  string(ASCII 31 TOKENIZER_RUSTFLAG_SEPARATOR)
  string(JOIN "${TOKENIZER_RUSTFLAG_SEPARATOR}"
    TOKENIZER_ENCODED_RUSTFLAGS ${TOKENIZER_RUSTFLAGS})
  if(DEFINED ENV{CARGO_ENCODED_RUSTFLAGS}
      AND NOT "$ENV{CARGO_ENCODED_RUSTFLAGS}" STREQUAL "")
    string(TOLOWER "$ENV{CARGO_ENCODED_RUSTFLAGS}" TOKENIZER_USER_ENCODED_RUSTFLAGS_LOWER)
    if("$ENV{CARGO_ENCODED_RUSTFLAGS}" MATCHES ";"
        OR TOKENIZER_USER_ENCODED_RUSTFLAGS_LOWER MATCHES
          "(/incremental|/timestamp|/debug:fastlink|-clink-arg=/brepro|--remap-path-prefix=)")
      message(FATAL_ERROR
        "CARGO_ENCODED_RUSTFLAGS contains ambiguous or conflicting reproducibility flags")
    endif()
    set(TOKENIZER_ENCODED_RUSTFLAGS
      "$ENV{CARGO_ENCODED_RUSTFLAGS}${TOKENIZER_RUSTFLAG_SEPARATOR}${TOKENIZER_ENCODED_RUSTFLAGS}")
  endif()
  list(APPEND TOKENIZER_CARGO_ENV
    "CARGO_ENCODED_RUSTFLAGS=${TOKENIZER_ENCODED_RUSTFLAGS}")
endif()
add_custom_command(
  OUTPUT "${TOKENIZER_DLL}" "${TOKENIZER_IMPLIB}"
  COMMAND "${CMAKE_COMMAND}" -E env
          ${TOKENIZER_CARGO_ENV}
          "${CARGO_EXECUTABLE}" build --locked --offline --release --manifest-path "${TOKENIZER_MANIFEST}"
  DEPENDS
    "${TOKENIZER_MANIFEST}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-ffi/Cargo.lock"
    "${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-ffi/src/lib.rs"
  VERBATIM)
add_custom_target(hikaru-asr-tokenizer-build DEPENDS "${TOKENIZER_DLL}" "${TOKENIZER_IMPLIB}")

add_library(hikaru-asr-ctranslate2 STATIC src/ctranslate2_whisper.cpp)
add_dependencies(hikaru-asr-ctranslate2 hikaru-asr-tokenizer-build)
if(HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT OR HIKARU_ASR_CUDA_RUNTIME)
  target_compile_definitions(hikaru-asr-ctranslate2 PUBLIC HIKARU_ASR_CT2_WITH_CUDA=1)
  target_include_directories(hikaru-asr-ctranslate2 PRIVATE "${CUDA_TOOLKIT_ROOT_NORMALIZED}/include")
endif()
if(HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY)
  target_compile_definitions(hikaru-asr-ctranslate2 PUBLIC HIKARU_ASR_WHISPER_FALLBACK_PARITY=1)
  target_include_directories(hikaru-asr-ctranslate2 PRIVATE
    "${HIKARU_ASR_ZLIB_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/zlib")
endif()
if(HIKARU_ASR_ENABLE_WHISPER_PARITY_BISECT)
  target_compile_definitions(hikaru-asr-ctranslate2 PUBLIC HIKARU_ASR_WHISPER_PARITY_BISECT=1)
endif()
if(HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT)
  target_compile_definitions(
    hikaru-asr-ctranslate2 PUBLIC HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT=1)
  target_include_directories(hikaru-asr-ctranslate2 PRIVATE "${ORT_ROOT}/include")
endif()
target_include_directories(hikaru-asr-ctranslate2
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src"
  PRIVATE "${POCKETFFT_SOURCE_DIR}")
target_include_directories(hikaru-asr-ctranslate2 SYSTEM PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
target_link_libraries(hikaru-asr-ctranslate2
  PUBLIC hikaru-asr-protocol
  PRIVATE
    hikaru-asr-wav-audio
    ctranslate2
    "${TOKENIZER_IMPLIB}"
    bcrypt)
if(HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT)
  target_link_libraries(
    hikaru-asr-ctranslate2 PRIVATE "${ORT_ROOT}/lib/onnxruntime.lib")
endif()
if(HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY)
  target_link_libraries(hikaru-asr-ctranslate2 PRIVATE hikaru-asr-zlib-static)
endif()

add_executable(hikaru-asr-worker src/main.cpp)
target_link_libraries(hikaru-asr-worker PRIVATE hikaru-asr-ctranslate2)
if(HIKARU_ASR_MVP_CPU_RUNTIME)
  target_compile_definitions(hikaru-asr-worker PRIVATE HIKARU_ASR_MVP_CPU_RUNTIME=1)
endif()
if(HIKARU_ASR_CUDA_RUNTIME)
  target_compile_definitions(hikaru-asr-worker PRIVATE HIKARU_ASR_CUDA_RUNTIME=1)
endif()
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
  target_compile_definitions(hikaru-asr-crispasr-contract-worker PRIVATE
    HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=1
    HIKARU_ASR_CRISPASR_WORKER_CONTRACT_TEST=1)
  target_link_libraries(
    hikaru-asr-crispasr-contract-worker
    PRIVATE hikaru-asr-ctranslate2 hikaru-asr-crispasr-test-adapter hikaru-asr-parakeet-family-policy)
  add_executable(hikaru-asr-crispasr-vad-identity-contract-worker src/main.cpp)
  set_target_properties(
    hikaru-asr-crispasr-vad-identity-contract-worker PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/identity-contract-bin")
  foreach(configuration IN ITEMS DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set_target_properties(
      hikaru-asr-crispasr-vad-identity-contract-worker PROPERTIES
      RUNTIME_OUTPUT_DIRECTORY_${configuration} "${CMAKE_BINARY_DIR}/identity-contract-bin")
  endforeach()
  target_compile_definitions(
    hikaru-asr-crispasr-vad-identity-contract-worker
    PRIVATE HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=1)
  target_link_libraries(
    hikaru-asr-crispasr-vad-identity-contract-worker
    PRIVATE hikaru-asr-ctranslate2 hikaru-asr-crispasr hikaru-asr-parakeet-family-policy)
  add_executable(hikaru-asr-crispasr-worker-contract-tests tests/crispasr_worker_contract_tests.cpp)
  target_include_directories(hikaru-asr-crispasr-worker-contract-tests SYSTEM PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
  target_link_libraries(hikaru-asr-crispasr-worker-contract-tests PRIVATE hikaru-asr-protocol)
  add_custom_command(TARGET hikaru-asr-worker POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${HIKARU_ASR_CRISPASR_RUNTIME_FILE}" "$<TARGET_FILE_DIR:hikaru-asr-worker>/crispasr.dll")
  if(T10R_VAD_MODEL_AVAILABLE)
    add_custom_command(TARGET hikaru-asr-worker POST_BUILD
      COMMAND "${CMAKE_COMMAND}" -E copy_if_different
              "${T10R_VAD_MODEL}" "$<TARGET_FILE_DIR:hikaru-asr-worker>/ggml-silero-v6.2.0.bin")
  endif()
endif()

add_executable(hikaru-asr-ctranslate2-tests tests/ctranslate2_whisper_tests.cpp)
target_link_libraries(hikaru-asr-ctranslate2-tests PRIVATE hikaru-asr-ctranslate2 bcrypt psapi version)
target_include_directories(hikaru-asr-ctranslate2-tests SYSTEM PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
file(TO_CMAKE_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-04-native-asr-ctranslate2-cuda-development/research/local"
  T07_LOCAL_ROOT)
file(TO_CMAKE_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-20-native-asr-whisper-quality-revision/research/local"
  T06R_LOCAL_ROOT)
file(TO_CMAKE_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-25-native-asr-whisper-execution-parity-discovery/research/local"
  T06D_LOCAL_ROOT)
file(TO_CMAKE_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/../.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local"
  T08_LOCAL_ROOT)
target_compile_definitions(hikaru-asr-ctranslate2-tests PRIVATE
  "T06_LOCAL_ROOT=\"${T06_LOCAL_ROOT_REAL}\""
  "T07_LOCAL_ROOT=\"${T07_LOCAL_ROOT}\""
  "T06R_LOCAL_ROOT=\"${T06R_LOCAL_ROOT}\""
  "T06D_LOCAL_ROOT=\"${T06D_LOCAL_ROOT}\""
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
      target_compile_options(hikaru-asr-crispasr-vad-identity-contract-worker PRIVATE /W4 /permissive- /utf-8)
    endif()
  endif()
  if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
    target_compile_options(hikaru-asr-crispasr-development-runner PRIVATE /W4 /permissive- /utf-8)
    target_compile_options(hikaru-asr-crispasr-worker-contract-tests PRIVATE /W4 /permissive- /utf-8)
  endif()
endif()

# Every worker binary imports the same CT2/tokenizer runtime. Candidate B adds ORT/VAD only
# to its explicit development builds; the final MVP CPU runtime never copies those files.
if(HIKARU_ASR_BUILD_CT2_WORKER)
  set(HIKARU_ASR_RUNTIME_TARGETS hikaru-asr-worker hikaru-asr-ctranslate2-tests)
  if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
    list(APPEND HIKARU_ASR_RUNTIME_TARGETS
      hikaru-asr-crispasr-contract-worker
      hikaru-asr-crispasr-vad-identity-contract-worker)
  endif()
  foreach(target IN LISTS HIKARU_ASR_RUNTIME_TARGETS)
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND "${CMAKE_COMMAND}" -E copy_if_different
              "$<TARGET_FILE:ctranslate2>" "$<TARGET_FILE_DIR:${target}>"
      COMMAND "${CMAKE_COMMAND}" -E copy_if_different
              "${TOKENIZER_DLL}" "$<TARGET_FILE_DIR:${target}>")
    if(HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT)
      add_custom_command(TARGET ${target} POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${ORT_ROOT}/lib/onnxruntime.dll" "$<TARGET_FILE_DIR:${target}>"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${ORT_ROOT}/lib/onnxruntime_providers_shared.dll" "$<TARGET_FILE_DIR:${target}>"
        COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                "${VAD_MODEL_SOURCE}" "$<TARGET_FILE_DIR:${target}>")
    endif()
  endforeach()
endif()

include(CTest)
if(BUILD_TESTING)
  add_test(NAME protocol-core COMMAND hikaru-asr-protocol-tests)
  set_tests_properties(protocol-core PROPERTIES TIMEOUT 30)
  if(NOT HIKARU_ASR_MVP_CPU_RUNTIME AND NOT HIKARU_ASR_CUDA_RUNTIME)
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
    set_tests_properties(fake-worker-contract crispasr-backend-core parakeet-family-policy PROPERTIES TIMEOUT 30)
    set_tests_properties(fake-worker-hang fake-worker-child-hang PROPERTIES TIMEOUT 15)
  endif()
  if(HIKARU_ASR_BUILD_CT2_WORKER)
    add_test(NAME ctranslate2-whisper-core COMMAND hikaru-asr-ctranslate2-tests --self-check)
    if(HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT)
      add_test(NAME crispasr-worker-contract
        COMMAND hikaru-asr-crispasr-worker-contract-tests
          $<TARGET_FILE:hikaru-asr-crispasr-contract-worker>
          $<TARGET_FILE:hikaru-asr-fake-crispasr-abi>
          $<TARGET_FILE:hikaru-asr-crispasr-vad-identity-contract-worker>)
      set_tests_properties(crispasr-worker-contract PROPERTIES TIMEOUT 30)
    else()
      find_package(Python3 REQUIRED COMPONENTS Interpreter)
      add_test(NAME crispasr-release-route-disabled
        COMMAND "${Python3_EXECUTABLE}"
          "${CMAKE_CURRENT_SOURCE_DIR}/tests/assert_crispasr_route_disabled.py"
          "$<TARGET_FILE:hikaru-asr-worker>")
      set_tests_properties(crispasr-release-route-disabled PROPERTIES TIMEOUT 30)
    endif()
    if(HIKARU_ASR_MVP_CPU_RUNTIME)
      add_test(NAME release-route-contract
        COMMAND "${Python3_EXECUTABLE}"
          "${CMAKE_CURRENT_SOURCE_DIR}/tests/assert_mvp_route_disabled.py"
          "$<TARGET_FILE:hikaru-asr-worker>")
      set_tests_properties(release-route-contract PROPERTIES TIMEOUT 30)
    elseif(HIKARU_ASR_CUDA_RUNTIME)
      add_test(NAME cuda-nvcc-launcher-config
        COMMAND "${Python3_EXECUTABLE}"
          "${CMAKE_CURRENT_SOURCE_DIR}/tests/assert_cuda_nvcc_launcher.py"
          "${CMAKE_BINARY_DIR}"
          "${CUDA_NVCC_LAUNCHER}"
          "${CUDA_REAL_NVCC}"
          "${CUDA_CT2_SOURCE_ROOT}")
      add_test(NAME cuda-release-route-contract
        COMMAND "${Python3_EXECUTABLE}"
          "${CMAKE_CURRENT_SOURCE_DIR}/tests/assert_cuda_release_route.py"
          "$<TARGET_FILE:hikaru-asr-worker>")
      set_tests_properties(cuda-nvcc-launcher-config cuda-release-route-contract PROPERTIES TIMEOUT 30)
    endif()
    set_tests_properties(ctranslate2-whisper-core PROPERTIES TIMEOUT 30)
    if(HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY)
      add_test(NAME ctranslate2-whisper-fallback-parity
        COMMAND hikaru-asr-ctranslate2-tests --fallback-self-check)
      set_tests_properties(ctranslate2-whisper-fallback-parity PROPERTIES TIMEOUT 30)
    endif()
    if(HIKARU_ASR_ENABLE_WHISPER_PARITY_BISECT)
      add_test(NAME ctranslate2-whisper-execution-parity
        COMMAND hikaru-asr-ctranslate2-tests --execution-parity-self-check)
      set_tests_properties(ctranslate2-whisper-execution-parity PROPERTIES TIMEOUT 30)
    endif()
  endif()
endif()
