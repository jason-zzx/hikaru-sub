cmake_minimum_required(VERSION 3.24)
project(hikaru_ct2_poc LANGUAGES CXX)

if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "This PoC is Windows x64 only")
endif()

set(CT2_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../local/src/CTranslate2" CACHE PATH "Pinned CTranslate2 v4.8.0 source")
set(POCKETFFT_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../local/src/pocketfft" CACHE PATH "Pinned pocketfft source")
set(DNNL_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../local/installed/onednn-3.1.1" CACHE PATH "Pinned oneDNN 3.1.1 install")
if(NOT EXISTS "${CT2_SOURCE_DIR}/include/ctranslate2/models/whisper.h")
  message(FATAL_ERROR "Missing pinned CTranslate2 source at ${CT2_SOURCE_DIR}")
endif()
if(NOT EXISTS "${POCKETFFT_SOURCE_DIR}/pocketfft_hdronly.h")
  message(FATAL_ERROR "Missing pinned pocketfft source at ${POCKETFFT_SOURCE_DIR}")
endif()
if(NOT EXISTS "${DNNL_ROOT}/include/dnnl.h" OR NOT EXISTS "${DNNL_ROOT}/lib/dnnl.lib")
  message(FATAL_ERROR "Missing pinned oneDNN install at ${DNNL_ROOT}")
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
set(CARGO_TARGET_DIR "${CMAKE_BINARY_DIR}/cargo")
set(TOKENIZER_DLL "${CARGO_TARGET_DIR}/release/poc_tokenizer.dll")
set(TOKENIZER_IMPLIB "${CARGO_TARGET_DIR}/release/poc_tokenizer.dll.lib")
add_custom_command(
  OUTPUT "${TOKENIZER_DLL}" "${TOKENIZER_IMPLIB}"
  COMMAND "${CMAKE_COMMAND}" -E env "CARGO_TARGET_DIR=${CARGO_TARGET_DIR}" "${CARGO_EXECUTABLE}" build --locked --release --manifest-path "${TOKENIZER_MANIFEST}"
  DEPENDS
    "${TOKENIZER_MANIFEST}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-ffi/Cargo.lock"
    "${CMAKE_CURRENT_SOURCE_DIR}/tokenizer-ffi/src/lib.rs"
  VERBATIM)
add_custom_target(poc_tokenizer_build DEPENDS "${TOKENIZER_DLL}" "${TOKENIZER_IMPLIB}")

add_executable(hikaru-ct2-poc src/main.cpp)
add_dependencies(hikaru-ct2-poc poc_tokenizer_build)
target_compile_features(hikaru-ct2-poc PRIVATE cxx_std_17)
target_include_directories(hikaru-ct2-poc PRIVATE "${POCKETFFT_SOURCE_DIR}")
target_link_libraries(hikaru-ct2-poc PRIVATE ctranslate2 "${TOKENIZER_IMPLIB}" bcrypt psapi)
file(REAL_PATH "${CMAKE_CURRENT_SOURCE_DIR}/../local" POC_LOCAL_ROOT_REAL)
target_compile_definitions(hikaru-ct2-poc PRIVATE
  NOMINMAX
  WIN32_LEAN_AND_MEAN
  "POC_LOCAL_ROOT=\"${POC_LOCAL_ROOT_REAL}\"")
if(MSVC)
  target_compile_options(hikaru-ct2-poc PRIVATE /W4 /utf-8)
endif()
add_custom_command(TARGET hikaru-ct2-poc POST_BUILD
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different "$<TARGET_FILE:ctranslate2>" "$<TARGET_FILE_DIR:hikaru-ct2-poc>"
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different "${TOKENIZER_DLL}" "$<TARGET_FILE_DIR:hikaru-ct2-poc>")

enable_testing()
add_test(NAME poc-self-check COMMAND hikaru-ct2-poc --self-check)

set(INPUT_LOCK "${CMAKE_CURRENT_SOURCE_DIR}/../inputs.lock.json" CACHE FILEPATH "Tracked immutable PoC input lock")
set(LARGE_V3_MODEL "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../src-tauri/target/debug/deps/models/huggingface/hub/models--Systran--faster-whisper-large-v3/snapshots/edaa852ec7e145841d8ffdb056a99866b5f0a478" CACHE PATH "Immutable large-v3 snapshot")
set(KOTOBA_MODEL "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../src-tauri/target/debug/deps/models/huggingface/hub/models--kotoba-tech--kotoba-whisper-v2.0-faster/snapshots/f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc" CACHE PATH "Immutable Kotoba snapshot")
file(REAL_PATH "${LARGE_V3_MODEL}" LARGE_V3_MODEL_REAL)
file(REAL_PATH "${KOTOBA_MODEL}" KOTOBA_MODEL_REAL)
if(EXISTS "${LARGE_V3_MODEL_REAL}/tokenizer.json" AND EXISTS "${INPUT_LOCK}")
  add_test(NAME large-v3-contract COMMAND hikaru-ct2-poc --contract-test --engine faster-whisper --model "${LARGE_V3_MODEL_REAL}" --lock "${INPUT_LOCK}")
endif()
if(EXISTS "${KOTOBA_MODEL_REAL}/tokenizer.json" AND EXISTS "${INPUT_LOCK}")
  add_test(NAME kotoba-contract COMMAND hikaru-ct2-poc --contract-test --engine kotoba-faster-whisper --model "${KOTOBA_MODEL_REAL}" --lock "${INPUT_LOCK}")
endif()
