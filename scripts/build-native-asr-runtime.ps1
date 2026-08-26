param(
  [Parameter(Mandatory = $true)]
  [string]$WorkRoot,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$CacheRoot = ".cache/native-asr-runtime/downloads",
  [string]$CTranslate2Root = "",
  [switch]$Resume,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$lockPath = Join-Path $repoRoot "native-asr/runtime/windows-x64-cpu-lock.json"
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$work = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $WorkRoot))
$output = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
$cache = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $CacheRoot))

function Invoke-Checked {
  param([string]$File, [string[]]$Arguments)
  Write-Host "> $File $($Arguments -join ' ')"
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$File failed with exit code $LASTEXITCODE"
  }
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-FileIdentity {
  param([string]$Path, [long]$SizeBytes, [string]$Sha256, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label is missing: $Path"
  }
  $file = Get-Item -LiteralPath $Path
  $actualHash = Get-Sha256 $Path
  if ($file.Length -ne $SizeBytes -or $actualHash -ne $Sha256) {
    throw "$Label identity mismatch: size=$($file.Length) sha256=$actualHash"
  }
}

function Assert-FileSha256 {
  param([string]$Path, [string]$Sha256, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label is missing: $Path"
  }
  $actualHash = Get-Sha256 $Path
  if ($actualHash -ne $Sha256) {
    throw "$Label SHA-256 mismatch: $actualHash"
  }
}

function Assert-NoPrivateBuildPath {
  param([string]$Path, [string]$Label)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $texts = @(
    [System.Text.Encoding]::Latin1.GetString($bytes).ToLowerInvariant(),
    [System.Text.Encoding]::Unicode.GetString($bytes).ToLowerInvariant())
  foreach ($text in $texts) {
    if ($text -match '[a-z]:\\users\\' -or
        $text.Contains('/users/') -or
        $text.Contains('.trellis\tasks') -or
        $text.Contains('.trellis/tasks') -or
        $text.Contains('research\local') -or
        $text.Contains('research/local')) {
      throw "$Label contains a private build path"
    }
  }
}

function Import-VisualStudioEnvironment {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio/Installer/vswhere.exe"
  if (-not (Test-Path -LiteralPath $vswhere)) {
    throw "vswhere.exe is unavailable"
  }
  $vsRoot = (& $vswhere -latest -products * -property installationPath).Trim()
  if (-not $vsRoot) {
    throw "Visual Studio was not found"
  }
  $devCmd = Join-Path $vsRoot "VC/Auxiliary/Build/vcvars64.bat"
  $environmentScript = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), ".cmd")
  try {
    [System.IO.File]::WriteAllText(
      $environmentScript,
      "@echo off`r`ncall `"$devCmd`" >nul`r`nset`r`n",
      [System.Text.Encoding]::ASCII)
    $lines = & $env:ComSpec /d /c $environmentScript
    if ($LASTEXITCODE -ne 0) {
      throw "vcvars64.bat failed"
    }
  } finally {
    Remove-Item -LiteralPath $environmentScript -Force -ErrorAction SilentlyContinue
  }
  foreach ($line in $lines) {
    $separator = $line.IndexOf("=")
    if ($separator -gt 0) {
      $name = $line.Substring(0, $separator)
      $value = $line.Substring($separator + 1)
      Set-Item -Path "Env:$name" -Value $value
    }
  }
  return $vsRoot
}

function Assert-Toolchain([string]$VsRoot) {
  if ((Split-Path $VsRoot -Leaf) -ne "Community" -or $env:VSCMD_VER -ne $lock.toolchain.visualStudioVersion) {
    throw "Visual Studio identity drifted: root=$VsRoot version=$env:VSCMD_VER"
  }
  $cmake = Join-Path $VsRoot "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
  $ninja = Join-Path $VsRoot "Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe"
  if (-not (Test-Path -LiteralPath $cmake) -or -not (Test-Path -LiteralPath $ninja)) {
    throw "Visual Studio CMake/Ninja is unavailable"
  }
  $env:Path = "$(Split-Path $cmake);$(Split-Path $ninja);$env:Path"

  $clOutput = (& cl 2>&1 | Out-String)
  if ($clOutput -notmatch "19\.50\.35722") {
    throw "MSVC compiler identity drifted: $clOutput"
  }
  if ($env:VCToolsVersion.TrimEnd("\") -ne $lock.toolchain.msvcToolsVersion) {
    throw "MSVC tools version drifted: $env:VCToolsVersion"
  }
  if ($env:WindowsSDKVersion.TrimEnd("\") -ne $lock.toolchain.windowsSdkVersion) {
    throw "Windows SDK version drifted: $env:WindowsSDKVersion"
  }
  $cmakeVersion = (& $cmake --version | Select-Object -First 1) -replace "^cmake version ", ""
  if ($cmakeVersion -ne $lock.toolchain.cmakeVersion) {
    throw "CMake version drifted: $cmakeVersion"
  }
  $ninjaVersion = (& $ninja --version).Trim()
  if ($ninjaVersion -ne $lock.toolchain.ninjaVersion) {
    throw "Ninja version drifted: $ninjaVersion"
  }
  $rust = & rustc -Vv
  $rustRelease = (($rust | Where-Object { $_ -like "release:*" }) -split ":", 2)[1].Trim()
  $rustCommit = (($rust | Where-Object { $_ -like "commit-hash:*" }) -split ":", 2)[1].Trim()
  if ($rustRelease -ne $lock.toolchain.rustcVersion -or $rustCommit -ne $lock.toolchain.rustcCommit) {
    throw "Rust toolchain identity drifted: release=$rustRelease commit=$rustCommit"
  }
  $cargoVersion = ((& cargo --version) -split ' ')[1]
  if ($cargoVersion -ne $lock.toolchain.cargoVersion) {
    throw "Cargo version drifted: $cargoVersion"
  }
  $nodeVersion = (& node --version).Trim().TrimStart("v")
  if ($nodeVersion -ne $lock.toolchain.nodeVersion) {
    throw "Node version drifted: $nodeVersion"
  }
  if ($PSVersionTable.PSVersion.ToString() -ne $lock.toolchain.powershellVersion) {
    throw "PowerShell version drifted: $($PSVersionTable.PSVersion)"
  }
  return @{ cmake = $cmake; ninja = $ninja }
}

function Get-LockedArchive($Source) {
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  $destination = Join-Path $cache $Source.archiveName
  if (Test-Path -LiteralPath $destination) {
    try {
      Assert-FileIdentity $destination $Source.sizeBytes $Source.sha256 $Source.archiveName
      return $destination
    } catch {
      Remove-Item -LiteralPath $destination -Force
    }
  }
  $temporary = "$destination.part"
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  Write-Host "Downloading $($Source.url)"
  Invoke-WebRequest -Uri $Source.url -OutFile $temporary -UseBasicParsing
  Assert-FileIdentity $temporary $Source.sizeBytes $Source.sha256 $Source.archiveName
  Move-Item -LiteralPath $temporary -Destination $destination
  return $destination
}

function Expand-LockedArchive([string]$Archive, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Invoke-Checked (Join-Path $env:SystemRoot "System32/tar.exe") @("-xf", $Archive, "-C", $Destination)
}

function Expand-LockedZip([string]$ArchivePath, [string]$Destination, [string[]]$ExpectedEntries) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $actualEntries = @($archive.Entries | ForEach-Object { $_.FullName } | Sort-Object)
    if (($actualEntries | ConvertTo-Json -Compress) -ne (($ExpectedEntries | Sort-Object) | ConvertTo-Json -Compress)) {
      throw "Locked build-input ZIP entry closure drifted"
    }
    $prefix = [System.IO.Path]::GetFullPath($Destination).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName.Contains("\") -or $entry.FullName.Contains("..") -or $entry.FullName.Contains(":")) {
        throw "Unsafe build-input ZIP entry: $($entry.FullName)"
      }
      $target = [System.IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
      if (-not $target.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Build-input ZIP entry escaped destination"
      }
      New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
  } finally {
    $archive.Dispose()
  }
}

function Copy-License([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "License file is missing: $Source"
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Get-PeImports([string]$Path) {
  $output = & dumpbin /dependents $Path
  if ($LASTEXITCODE -ne 0) {
    throw "dumpbin failed for $Path"
  }
  return @(
    $output |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -match "^[A-Za-z0-9_.-]+\.[Dd][Ll][Ll]$" } |
      Sort-Object -Unique
  )
}

function Find-CargoLicense([object]$Metadata, [string]$PackageName) {
  $package = $Metadata.packages | Where-Object { $_.name -eq $PackageName } | Select-Object -First 1
  if (-not $package) {
    throw "Cargo package is missing from locked metadata: $PackageName"
  }
  $directory = Split-Path ([System.IO.Path]::GetFullPath($package.manifest_path))
  $license = Get-ChildItem -LiteralPath $directory -File | Where-Object { $_.Name -like "LICENSE*" } | Select-Object -First 1
  if (-not $license) {
    throw "Cargo package license is missing: $PackageName"
  }
  return $license.FullName
}

function Assert-RestrictedLaunch([string]$RuntimeRoot) {
  $request = @{
    protocolVersion = 1
    jobId = "runtime-package-smoke"
    engine = "faster-whisper"
    backend = "ctranslate2"
    modelPaths = @(@{ role = "model"; path = "C:\missing-model" })
    audioPath = "C:\missing.wav"
    device = "cpu"
    language = "ja"
    useVad = $true
  } | ConvertTo-Json -Compress -Depth 8
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = Join-Path $RuntimeRoot "hikaru-asr-worker.exe"
  $info.WorkingDirectory = $RuntimeRoot
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  $info.Environment["PATH"] = "$RuntimeRoot;$env:SystemRoot\System32"
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) {
    throw "Packaged worker could not start"
  }
  Start-Sleep -Milliseconds 200
  $runtimePrefix = [System.IO.Path]::GetFullPath($RuntimeRoot).TrimEnd("\") + "\"
  $windowsPrefix = [System.IO.Path]::GetFullPath($env:SystemRoot).TrimEnd("\") + "\"
  foreach ($module in $process.Modules) {
    $modulePath = [System.IO.Path]::GetFullPath($module.FileName)
    if (-not $modulePath.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $modulePath.StartsWith($windowsPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      $process.Kill($true)
      throw "Packaged worker loaded a non-system module outside the runtime root: $modulePath"
    }
  }
  $process.StandardInput.WriteLine($request)
  $process.StandardInput.Close()
  if (-not $process.WaitForExit(15000)) {
    $process.Kill($true)
    throw "Packaged worker restricted launch timed out"
  }
  $stdout = $process.StandardOutput.ReadToEnd().Trim()
  $stderr = $process.StandardError.ReadToEnd().Trim()
  if ($process.ExitCode -ne 20 -or -not $stdout) {
    throw "Packaged worker restricted launch failed: exit=$($process.ExitCode) stdout=$stdout stderr=$stderr"
  }
  $event = $stdout.Split("`n", [System.StringSplitOptions]::RemoveEmptyEntries)[0] | ConvertFrom-Json
  if ($event.event -ne "error" -or $event.code -ne "vad_not_built") {
    throw "Packaged worker did not fail closed for excluded VAD: $stdout"
  }
}

if ($IsWindows -ne $true) {
  throw "The Native ASR CPU runtime can only be built on Windows"
}

$vsRoot = Import-VisualStudioEnvironment
$tools = Assert-Toolchain $vsRoot
Invoke-Checked "node.exe" @(
  (Join-Path $repoRoot "scripts/verify-native-asr-runtime.mjs"),
  "--lock", $lockPath,
  "--lock-only"
)
Assert-FileIdentity (Join-Path $repoRoot "native-asr/tokenizer-ffi/Cargo.lock") $lock.sources.tokenizer.cargoLockSizeBytes $lock.sources.tokenizer.cargoLockSha256 "tokenizer Cargo.lock"
Assert-FileSha256 (Join-Path $repoRoot "native-asr/third_party/nlohmann/provenance.json") $lock.sources.nlohmannJson.provenanceSha256 "nlohmann/json provenance"
Assert-FileSha256 (Join-Path $repoRoot "native-asr/third_party/nlohmann/json.hpp") $lock.sources.nlohmannJson.headerSha256 "nlohmann/json header"
Assert-FileSha256 (Join-Path $repoRoot "native-asr/third_party/nlohmann/LICENSE.MIT") $lock.sources.nlohmannJson.licenseSha256 "nlohmann/json license"
$msRuntimeLicense = Get-LockedArchive $lock.sources.microsoftVisualCppRuntimeLicense

if (-not $Resume) {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $work | Out-Null
$sourcesRoot = Join-Path $work "sources"
$buildRoot = Join-Path $work "build"
$stageRoot = Join-Path $work "stage"
$runtimeRoot = Join-Path $stageRoot "windows-x64/cpu"
$ct2Source = Join-Path $sourcesRoot "CTranslate2-4.8.0"
$onednnSource = Join-Path $sourcesRoot "oneDNN-3.1.1"
$pocketfftSource = Join-Path $sourcesRoot "pocketfft-$($lock.sources.pocketfft.revision)"
New-Item -ItemType Directory -Force -Path $sourcesRoot, $buildRoot | Out-Null

if (-not $Resume) {
  $ct2Archive = Get-LockedArchive $lock.sources.ctranslate2
  $cpuFeaturesArchive = Get-LockedArchive $lock.sources.ctranslate2CpuFeatures
  $spdlogArchive = Get-LockedArchive $lock.sources.ctranslate2Spdlog
  $onednnArchive = Get-LockedArchive $lock.sources.onednn
  $pocketfftArchive = Get-LockedArchive $lock.sources.pocketfft
  Expand-LockedArchive $ct2Archive $sourcesRoot
  Expand-LockedArchive $cpuFeaturesArchive $sourcesRoot
  Expand-LockedArchive $spdlogArchive $sourcesRoot
  Expand-LockedArchive $onednnArchive $sourcesRoot
  Expand-LockedArchive $pocketfftArchive $sourcesRoot

  $cpuFeaturesSource = Join-Path $sourcesRoot "cpu_features-$($lock.sources.ctranslate2CpuFeatures.revision)"
  $spdlogSource = Join-Path $sourcesRoot "spdlog-$($lock.sources.ctranslate2Spdlog.revision)"
  Remove-Item -LiteralPath (Join-Path $ct2Source "third_party/cpu_features") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $ct2Source "third_party/spdlog") -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $cpuFeaturesSource -Destination (Join-Path $ct2Source "third_party/cpu_features")
  Move-Item -LiteralPath $spdlogSource -Destination (Join-Path $ct2Source "third_party/spdlog")
}
Assert-FileIdentity (Join-Path $pocketfftSource "pocketfft_hdronly.h") 120735 $lock.sources.pocketfft.headerSha256 "pocketfft header"

$nativeBuild = Join-Path $buildRoot "native-asr"
$configureArgs = @(
  "-S", (Join-Path $repoRoot "native-asr"),
  "-B", $nativeBuild,
  "-G", "Ninja",
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
  "-DBUILD_TESTING=ON",
  "-DHIKARU_ASR_BUILD_CT2_WORKER=ON",
  "-DHIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT=OFF",
  "-DHIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=OFF",
  "-DHIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT=OFF",
  "-DHIKARU_ASR_MVP_CPU_RUNTIME=ON",
  "-DHIKARU_ASR_REPRODUCIBLE_BUILD=ON",
  "-DHIKARU_ASR_REPRODUCIBLE_PATH_ROOT=$repoRoot",
  "-DHIKARU_ASR_CT2_SOURCE_DIR=$ct2Source",
  "-DHIKARU_ASR_CT2_SOURCE_REVISION=$($lock.sources.ctranslate2.revision)",
  "-DHIKARU_ASR_POCKETFFT_SOURCE_DIR=$pocketfftSource"
)
if ($CTranslate2Root) {
  $pinnedCt2 = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $CTranslate2Root))
} else {
  $buildInputArchive = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $lock.buildInput.path))
  Assert-FileIdentity $buildInputArchive $lock.buildInput.sizeBytes $lock.buildInput.sha256 "CTranslate2 build-input ZIP"
  $pinnedCt2 = Join-Path $work "build-inputs/ctranslate2"
  Expand-LockedZip $buildInputArchive $pinnedCt2 @($lock.buildInput.entries)
}
$ct2Input = Join-Path $work "inputs/ctranslate2"
Assert-FileIdentity (Join-Path $pinnedCt2 "bin/ctranslate2.dll") $lock.sources.ctranslate2.runtimeBinary.dllSizeBytes $lock.sources.ctranslate2.runtimeBinary.dllSha256 "CTranslate2 DLL"
Assert-FileIdentity (Join-Path $pinnedCt2 "ctranslate2/ctranslate2.lib") $lock.sources.ctranslate2.runtimeBinary.importLibrarySizeBytes $lock.sources.ctranslate2.runtimeBinary.importLibrarySha256 "CTranslate2 import library"
Assert-NoPrivateBuildPath (Join-Path $pinnedCt2 "bin/ctranslate2.dll") "CTranslate2 DLL"
Assert-NoPrivateBuildPath (Join-Path $pinnedCt2 "ctranslate2/ctranslate2.lib") "CTranslate2 import library"
New-Item -ItemType Directory -Force -Path (Join-Path $ct2Input "bin"), (Join-Path $ct2Input "ctranslate2") | Out-Null
Copy-Item -LiteralPath (Join-Path $pinnedCt2 "bin/ctranslate2.dll") -Destination (Join-Path $ct2Input "bin/ctranslate2.dll") -Force
Copy-Item -LiteralPath (Join-Path $pinnedCt2 "ctranslate2/ctranslate2.lib") -Destination (Join-Path $ct2Input "ctranslate2/ctranslate2.lib") -Force
$configureArgs += @(
  "-DHIKARU_ASR_CT2_PREBUILT_ROOT=$ct2Input",
  "-DHIKARU_ASR_CT2_PREBUILT_DLL_SIZE=$($lock.sources.ctranslate2.runtimeBinary.dllSizeBytes)",
  "-DHIKARU_ASR_CT2_PREBUILT_DLL_SHA256=$($lock.sources.ctranslate2.runtimeBinary.dllSha256)",
  "-DHIKARU_ASR_CT2_PREBUILT_IMPLIB_SIZE=$($lock.sources.ctranslate2.runtimeBinary.importLibrarySizeBytes)",
  "-DHIKARU_ASR_CT2_PREBUILT_IMPLIB_SHA256=$($lock.sources.ctranslate2.runtimeBinary.importLibrarySha256)"
)
$oldRustFlags = $env:RUSTFLAGS
try {
  $env:RUSTFLAGS = "--remap-path-prefix=$repoRoot=source --remap-path-prefix=$work=runtime --remap-path-prefix=$env:USERPROFILE=user -C link-arg=/Brepro"
  Invoke-Checked $tools.cmake $configureArgs
  Invoke-Checked $tools.cmake @("--build", $nativeBuild, "--parallel", "16")
  if (-not $SkipTests) {
    Invoke-Checked "ctest.exe" @("--test-dir", $nativeBuild, "--output-on-failure")
  }
} finally {
  $env:RUSTFLAGS = $oldRustFlags
}

Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$binaryRoot = Join-Path $nativeBuild "bin"
foreach ($fileName in @("hikaru-asr-worker.exe", "ctranslate2.dll", "hikaru_asr_tokenizer.dll")) {
  Copy-Item -LiteralPath (Join-Path $binaryRoot $fileName) -Destination (Join-Path $runtimeRoot $fileName)
}

$redistBase = Join-Path $vsRoot "VC/Redist/MSVC"
$redistCandidates = Get-ChildItem -LiteralPath $redistBase -Directory | Sort-Object Name -Descending
foreach ($redist in $lock.redistributables) {
  $match = $null
  foreach ($candidate in $redistCandidates) {
    $candidatePath = if ($redist.fileName -eq "vcomp140.dll") {
      Join-Path $candidate.FullName "x64/Microsoft.VC145.OpenMP/$($redist.fileName)"
    } else {
      Join-Path $candidate.FullName "x64/Microsoft.VC145.CRT/$($redist.fileName)"
    }
    if (Test-Path -LiteralPath $candidatePath) {
      try {
        Assert-FileIdentity $candidatePath $redist.sizeBytes $redist.sha256 $redist.fileName
        $match = $candidatePath
        break
      } catch {}
    }
  }
  if (-not $match) {
    throw "Pinned Microsoft redistributable is unavailable: $($redist.fileName)"
  }
  Copy-Item -LiteralPath $match -Destination (Join-Path $runtimeRoot $redist.fileName)
}

$licenses = Join-Path $runtimeRoot "licenses"
New-Item -ItemType Directory -Force -Path $licenses | Out-Null
Copy-License (Join-Path $ct2Source "LICENSE") (Join-Path $licenses "CTranslate2-MIT.txt")
Copy-License (Join-Path $onednnSource "LICENSE") (Join-Path $licenses "oneDNN-Apache-2.0.txt")
Copy-License (Join-Path $pocketfftSource "LICENSE.md") (Join-Path $licenses "pocketfft-BSD-3-Clause.txt")
Copy-License (Join-Path $repoRoot "native-asr/third_party/nlohmann/LICENSE.MIT") (Join-Path $licenses "nlohmann-json-MIT.txt")

$cargoMetadataPath = Join-Path $work "cargo-metadata.json"
$cargoMetadataText = & cargo metadata --locked --offline --format-version 1 --manifest-path (Join-Path $repoRoot "native-asr/tokenizer-ffi/Cargo.toml")
if ($LASTEXITCODE -ne 0) {
  throw "cargo metadata failed"
}
[System.IO.File]::WriteAllText($cargoMetadataPath, $cargoMetadataText, [System.Text.UTF8Encoding]::new($false))
$cargoMetadata = $cargoMetadataText | ConvertFrom-Json
Copy-License (Find-CargoLicense $cargoMetadata "tokenizers") (Join-Path $licenses "tokenizers-Apache-2.0.txt")
Copy-License (Find-CargoLicense $cargoMetadata "onig") (Join-Path $licenses "onig-MIT.txt")
Copy-License (Find-CargoLicense $cargoMetadata "onig_sys") (Join-Path $licenses "onig-sys-MIT.txt")
$msLicense = $lock.sources.microsoftVisualCppRuntimeLicense
$msComponent = $lock.licenseInventory.components | Where-Object { $_.name -eq "Microsoft Visual C++ Redistributable" } | Select-Object -First 1
if (-not $msComponent) {
  throw "Microsoft runtime license inventory component is missing"
}
$msRuntimeLicenseDestination = Join-Path $runtimeRoot $msLicense.runtimePath
Copy-License $msRuntimeLicense $msRuntimeLicenseDestination
Assert-FileIdentity $msRuntimeLicenseDestination $msLicense.sizeBytes $msLicense.sha256 "Microsoft Visual C++ Runtime 2026 license"
$msNotice = @"
The bundled Microsoft Visual C++ Redistributable runtime files are excluded from
Hikaru Sub's Apache-2.0 project license and are governed by the official Microsoft
Visual C++ V14 Redistributable and Runtime 2026 terms included unchanged at:
$($msLicense.runtimePath)

Official terms: $($msLicense.termsUrl)
VS 18 redistribution list: $($msLicense.redistributionUrl)
Acceptance stated by Microsoft: $($msLicense.acceptance)
Files: $((@($lock.redistributables | ForEach-Object { $_.fileName }) | Sort-Object) -join ', ')
"@
[System.IO.File]::WriteAllText(
  (Join-Path $licenses "Microsoft-Visual-Cpp-Runtime.txt"),
  $msNotice.Replace("`r`n", "`n"),
  [System.Text.UTF8Encoding]::new($false))

$imports = [ordered]@{
  "hikaru-asr-worker.exe" = @(Get-PeImports (Join-Path $runtimeRoot "hikaru-asr-worker.exe"))
  "ctranslate2.dll" = @(Get-PeImports (Join-Path $runtimeRoot "ctranslate2.dll"))
  "hikaru_asr_tokenizer.dll" = @(Get-PeImports (Join-Path $runtimeRoot "hikaru_asr_tokenizer.dll"))
}
$importsPath = Join-Path $work "imports.json"
[System.IO.File]::WriteAllText(
  $importsPath,
  (($imports | ConvertTo-Json -Depth 8) + "`n"),
  [System.Text.UTF8Encoding]::new($false))

$candidateOutput = "$output.candidate-$PID.zip"
Remove-Item -LiteralPath $candidateOutput -Force -ErrorAction SilentlyContinue
try {
  Invoke-Checked "node.exe" @(
    (Join-Path $repoRoot "scripts/package-native-asr-runtime.mjs"),
    "--stage", $stageRoot,
    "--lock", $lockPath,
    "--cargo-metadata", $cargoMetadataPath,
    "--imports", $importsPath,
    "--output", $candidateOutput
  )
  Assert-RestrictedLaunch $runtimeRoot
  $candidateSize = (Get-Item -LiteralPath $candidateOutput).Length
  $candidateSha256 = Get-Sha256 $candidateOutput
  if ($null -ne $lock.artifact.sizeBytes -and
      ($candidateSize -ne $lock.artifact.sizeBytes -or $candidateSha256 -ne $lock.artifact.sha256)) {
    throw "Built artifact drifted from the attested lock: size=$candidateSize sha256=$candidateSha256"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $output) | Out-Null
  Move-Item -LiteralPath $candidateOutput -Destination $output -Force
} finally {
  Remove-Item -LiteralPath $candidateOutput -Force -ErrorAction SilentlyContinue
}

$result = [ordered]@{
  archive = $output
  sizeBytes = (Get-Item -LiteralPath $output).Length
  sha256 = Get-Sha256 $output
  runtimeRoot = $runtimeRoot
}
$result | ConvertTo-Json -Compress
