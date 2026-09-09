@echo off
setlocal
rem Run inside an x64 VS Developer prompt. Separate CPU/CUDA build roots required.
rem Usage: build.cmd source-root build-root cpu^|cuda [CUDA-toolkit-root]
if "%~3"=="cpu" goto cpu
if "%~3"=="cuda" goto cuda
exit /b 2
:cpu
set GPU=-DGGML_CUDA=OFF
if not "%~4"=="" exit /b 2
goto configure
:cuda
if "%~4"=="" exit /b 2
set GPU=-DGGML_CUDA=ON -DCUDAToolkit_ROOT="%~4" -DCMAKE_CUDA_COMPILER="%~4/bin/nvcc.exe" -UCMAKE_CUDA_ARCHITECTURES -DCMAKE_CUDA_FLAGS=-allow-unsupported-compiler
:configure
rem Use pinned GGML's non-native multi-generation defaults, not the sm86 smoke override.
rem This archive is nested below the app checkout; never label it with the app HEAD.
for %%I in ("%~1\..") do set GIT_CEILING_DIRECTORIES=%%~fI
cmake -S "%~1" -B "%~2" -G Ninja -DCMAKE_PROJECT_INCLUDE="%~dp0delivery.cmake" -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS=/utf-8 -DCMAKE_CXX_FLAGS="/utf-8 /EHsc" -DBUILD_SHARED_LIBS=OFF -DCRISPASR_BUILD_EXAMPLES=ON -DCRISPASR_BUILD_TESTS=OFF -DCRISPASR_BUILD_SERVER=OFF -DCRISPASR_CURL=OFF -DCRISPASR_FFMPEG=OFF -DCRISPASR_SDL2=OFF -DCRISPASR_OPUS=OFF -DCRISPASR_AMR=OFF -DCRISPASR_C2PA_FETCH=OFF -DCRISPASR_NO_C2PA_NATIVE=ON -DCRISPASR_WITH_ESPEAK_NG=OFF -DCRISPASR_COREML=OFF -DCRISPASR_OPENVINO=OFF -DGGML_BACKEND_DL=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_CCACHE=OFF -DGGML_BLAS=OFF -DGGML_VULKAN=OFF -DGGML_METAL=OFF -DGGML_HIP=OFF -DGGML_SYCL=OFF -DGGML_OPENCL=OFF -DGGML_RPC=OFF -DGGML_MUSA=OFF %GPU% || exit /b 1
cmake --build "%~2" --config Release --target crispasr-cli -j 8 || exit /b 1
