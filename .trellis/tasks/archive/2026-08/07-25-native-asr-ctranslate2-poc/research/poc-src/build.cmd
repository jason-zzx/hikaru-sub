@echo off
setlocal
pushd "%~dp0" || exit /b 2
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath`) do set "VSROOT=%%i"
if not defined VSROOT (
  echo Visual Studio was not found. 1>&2
  exit /b 2
)
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b
set "PATH=%VSROOT%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;%VSROOT%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;%PATH%"
set "STEP=%~1"
if "%STEP%"=="" set "STEP=all"
if "%STEP%"=="configure" goto configure
if "%STEP%"=="build" goto build
if "%STEP%"=="test" goto test
if not "%STEP%"=="all" (
  echo Usage: build.cmd [configure^|build^|test^|all] 1>&2
  exit /b 2
)
:configure
cmake --preset windows-x64-cpu-poc || exit /b
if "%STEP%"=="configure" exit /b 0
:build
cmake --build --preset windows-x64-cpu-poc-release || exit /b
if "%STEP%"=="build" exit /b 0
:test
ctest --preset windows-x64-cpu-poc-release --output-on-failure || exit /b
