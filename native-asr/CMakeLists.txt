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

if(MSVC)
  foreach(target IN ITEMS hikaru-asr-protocol hikaru-asr-fake-worker hikaru-asr-protocol-tests)
    target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
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
  set_tests_properties(protocol-core fake-worker-contract PROPERTIES TIMEOUT 30)
  set_tests_properties(fake-worker-hang fake-worker-child-hang PROPERTIES TIMEOUT 15)
endif()
