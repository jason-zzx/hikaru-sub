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
set(WITH_CUDA OFF CACHE BOOL "" FORCE)
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
target_include_directories(hikaru-asr-ctranslate2
  PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src"
  PRIVATE "${POCKETFFT_SOURCE_DIR}" "${ORT_ROOT}/include")
target_include_directories(hikaru-asr-ctranslate2 SYSTEM PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
target_link_libraries(hikaru-asr-ctranslate2
  PUBLIC hikaru-asr-protocol
  PRIVATE
    ctranslate2
    "${TOKENIZER_IMPLIB}"
    "${ORT_ROOT}/lib/onnxruntime.lib"
    bcrypt)

add_executable(hikaru-asr-worker src/main.cpp)
target_link_libraries(hikaru-asr-worker PRIVATE hikaru-asr-ctranslate2)

add_executable(hikaru-asr-ctranslate2-tests tests/ctranslate2_whisper_tests.cpp)
target_link_libraries(hikaru-asr-ctranslate2-tests PRIVATE hikaru-asr-ctranslate2 bcrypt psapi)
target_include_directories(hikaru-asr-ctranslate2-tests SYSTEM PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
target_compile_definitions(hikaru-asr-ctranslate2-tests PRIVATE
  "T06_LOCAL_ROOT=\"${T06_LOCAL_ROOT_REAL}\"")

foreach(target IN ITEMS hikaru-asr-worker hikaru-asr-ctranslate2-tests)
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

if(MSVC)
  foreach(target IN ITEMS
      hikaru-asr-protocol
      hikaru-asr-fake-worker
      hikaru-asr-protocol-tests)
    target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
  endforeach()
  if(HIKARU_ASR_BUILD_CT2_WORKER)
    foreach(target IN ITEMS
        hikaru-asr-ctranslate2
        hikaru-asr-worker
        hikaru-asr-ctranslate2-tests)
      target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
    endforeach()
  endif()
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
  set_tests_properties(protocol-core fake-worker-contract PROPERTIES TIMEOUT 30)
  set_tests_properties(fake-worker-hang fake-worker-child-hang PROPERTIES TIMEOUT 15)
  if(HIKARU_ASR_BUILD_CT2_WORKER)
    add_test(NAME ctranslate2-whisper-core COMMAND hikaru-asr-ctranslate2-tests --self-check)
    set_tests_properties(ctranslate2-whisper-core PROPERTIES TIMEOUT 30)
  endif()
endif()
