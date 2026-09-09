# Build metadata/path hygiene only; no source-list or inference changes.
if(MSVC)
    file(TO_NATIVE_PATH "${CMAKE_SOURCE_DIR}" source_native)
    file(TO_NATIVE_PATH "${CMAKE_BINARY_DIR}" build_native)
    foreach(flag /Brepro /experimental:deterministic
            "/pathmap:${source_native}=crispasr" "/pathmap:${CMAKE_SOURCE_DIR}=crispasr"
            "/pathmap:${build_native}=build" "/pathmap:${CMAKE_BINARY_DIR}=build")
        add_compile_options("$<$<COMPILE_LANGUAGE:C,CXX>:${flag}>"
                            "$<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=${flag}>")
    endforeach()
    add_link_options(/Brepro)
endif()
