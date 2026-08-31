param(
  [Parameter(Mandatory = $true)]
  [string]$BuildRoot,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$WorkRoot = ".cache/native-asr-cuda-runtime/package"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$lockPath = Join-Path $repoRoot "native-asr/runtime/windows-x64-cuda-lock.json"
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$build = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $BuildRoot))
$output = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
$work = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $WorkRoot))
$stageRoot = Join-Path $work "stage"
$runtimeRoot = Join-Path $stageRoot "windows-x64/cuda"

function Invoke-Checked([string]$File, [string[]]$Arguments) {
  Write-Host "> $File $($Arguments -join ' ')"
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-FileIdentity([string]$Path, [long]$SizeBytes, [string]$Sha256, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
  $item = Get-Item -LiteralPath $Path
  $actual = Get-Sha256 $Path
  if ($item.Length -ne $SizeBytes -or $actual -ne $Sha256) {
    throw "$Label identity mismatch: size=$($item.Length) sha256=$actual"
  }
}

function Import-VisualStudioEnvironment {
  $devCmd = "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat"
  if (-not (Test-Path -LiteralPath $devCmd)) { throw "Visual Studio 18 developer environment is unavailable" }
  $script = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), ".cmd")
  try {
    [System.IO.File]::WriteAllText(
      $script,
      "@echo off`r`ncall `"$devCmd`" -no_logo -arch=x64 -host_arch=x64 -vcvars_ver=14.44 >nul`r`nset`r`n",
      [System.Text.Encoding]::ASCII)
    $lines = & $env:ComSpec /d /c $script
    if ($LASTEXITCODE -ne 0) { throw "VsDevCmd.bat failed" }
  } finally {
    Remove-Item -LiteralPath $script -Force -ErrorAction SilentlyContinue
  }
  foreach ($line in $lines) {
    $separator = $line.IndexOf("=")
    if ($separator -gt 0) {
      Set-Item -Path "Env:$($line.Substring(0, $separator))" -Value $line.Substring($separator + 1)
    }
  }
  $cl = (& cl 2>&1 | Out-String)
  if ($cl -notmatch "19\.44\.35221" -or $env:VCToolsVersion.TrimEnd("\") -ne "14.44.35207") {
    throw "MSVC 14.44 identity drifted: $cl"
  }
}

function Replace-AsciiPrefix([string]$Path, [string]$OldPrefix, [string]$NewPrefix) {
  if ($NewPrefix.Length -gt $OldPrefix.Length) { throw "Replacement prefix is longer than source prefix" }
  $replacement = $NewPrefix.PadRight($OldPrefix.Length, "_")
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $old = [System.Text.Encoding]::ASCII.GetBytes($OldPrefix)
  $new = [System.Text.Encoding]::ASCII.GetBytes($replacement)
  $count = 0
  for ($i = 0; $i -le $bytes.Length - $old.Length; $i++) {
    $matches = $true
    for ($j = 0; $j -lt $old.Length; $j++) {
      if ($bytes[$i + $j] -ne $old[$j]) { $matches = $false; break }
    }
    if ($matches) {
      [Array]::Copy($new, 0, $bytes, $i, $new.Length)
      $count++
      $i += $old.Length - 1
    }
  }
  if ($count -le 0) { throw "Expected private diagnostic prefix was not found in $Path" }
  [System.IO.File]::WriteAllBytes($Path, $bytes)
  Write-Host "Normalized $count private diagnostic prefixes in $Path"
}

function Normalize-PrivateOneDnnPath([string]$Path) {
  $text = [System.Text.Encoding]::Latin1.GetString([System.IO.File]::ReadAllBytes($Path))
  $matches = [regex]::Matches(
    $text,
    '[A-Za-z]:\\Users\\[^\\\x00]+\\Documents\\codes\\hikaru-sub\\\.trellis\\tasks\\07-25-native-asr-ctranslate2-poc\\research\\local\\src\\oneDNN-3\.1\.1')
  $prefixes = @($matches | ForEach-Object { $_.Value } | Sort-Object -Unique)
  if ($prefixes.Count -ne 1) { throw "Expected exactly one private oneDNN prefix, found $($prefixes.Count)" }
  Replace-AsciiPrefix $Path $prefixes[0] "source\oneDNN-3.1.1"
}

function Normalize-PrivateCargoRegistryPath([string]$Path) {
  $text = [System.Text.Encoding]::Latin1.GetString([System.IO.File]::ReadAllBytes($Path))
  $matches = [regex]::Matches(
    $text,
    '[A-Za-z]:\\Users\\[^\\\x00]+\\\.cargo\\registry\\src\\index\.crates\.io-[0-9a-f]+')
  $prefixes = @($matches | ForEach-Object { $_.Value } | Sort-Object -Unique)
  if ($prefixes.Count -ne 1) { throw "Expected exactly one private Cargo registry prefix, found $($prefixes.Count)" }
  Replace-AsciiPrefix $Path $prefixes[0] "cargo\registry\src\index.crates.io"
}

function Get-PeImports([string]$Path) {
  $output = & dumpbin /dependents $Path
  if ($LASTEXITCODE -ne 0) { throw "dumpbin failed for $Path" }
  @($output | ForEach-Object { $_.Trim() } | Where-Object { $_ -match "^[A-Za-z0-9_.-]+\.[Dd][Ll][Ll]$" } | Sort-Object -Unique)
}

function Find-CargoLicense([object]$Metadata, [string]$PackageName) {
  $package = $Metadata.packages | Where-Object { $_.name -eq $PackageName } | Select-Object -First 1
  if (-not $package) { throw "Cargo package is missing: $PackageName" }
  $directory = Split-Path ([System.IO.Path]::GetFullPath($package.manifest_path))
  $license = Get-ChildItem -LiteralPath $directory -File | Where-Object { $_.Name -like "LICENSE*" } | Select-Object -First 1
  if (-not $license) { throw "Cargo package license is missing: $PackageName" }
  $license.FullName
}

function Assert-CudaFatbin([string]$DllPath) {
  $cuobjdump = Join-Path $repoRoot ".cache/native-asr-cuda-runtime/cuda-12.9.1/components/cuda_cuobjdump-windows-x86_64-12.9.82-archive/cuda_cuobjdump-windows-x86_64-12.9.82-archive/bin/cuobjdump.exe"
  Assert-FileIdentity $cuobjdump $lock.cudaFatbin.toolSizeBytes $lock.cudaFatbin.toolSha256 "locked CUDA 12.9 Update 1 cuobjdump"
  $elf = & $cuobjdump --list-elf $DllPath
  if ($LASTEXITCODE -ne 0) { throw "cuobjdump --list-elf failed" }
  $ptx = & $cuobjdump --list-ptx $DllPath
  if ($LASTEXITCODE -ne 0) { throw "cuobjdump --list-ptx failed" }
  $observedSass = @($elf | Select-String -AllMatches 'sm_[0-9]+' | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique)
  $observedPtx = @($ptx | Select-String -AllMatches 'sm_[0-9]+' | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique)
  if (($observedSass | ConvertTo-Json -Compress) -ne (($lock.cudaFatbin.requiredSass | Sort-Object) | ConvertTo-Json -Compress)) {
    throw "CUDA SASS target closure drifted: $($observedSass -join ', ')"
  }
  if (($observedPtx | ConvertTo-Json -Compress) -ne (($lock.cudaFatbin.observedPtxLabels | Sort-Object) | ConvertTo-Json -Compress)) {
    throw "CUDA PTX target closure drifted: $($observedPtx -join ', ')"
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $runtimeRoot "cuda-fatbin.json"),
    (($lock.cudaFatbin | ConvertTo-Json -Depth 8) + "`n"),
    [System.Text.UTF8Encoding]::new($false))
}

function Assert-RestrictedProbe([string]$Root) {
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = Join-Path $Root "hikaru-asr-worker.exe"
  $info.ArgumentList.Add("--probe-cuda")
  $info.WorkingDirectory = $Root
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  $info.Environment["PATH"] = "$Root;$env:SystemRoot\System32"
  $info.Environment.Remove("CUDA_PATH") | Out-Null
  $info.Environment.Remove("CUDA_HOME") | Out-Null
  $info.Environment.Remove("CT2_CUDA_ALLOW_FP16") | Out-Null
  $info.Environment["HIKARU_ASR_CUDA_PROBE_HOLD_MS"] = "1000"
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "CUDA probe could not start" }
  Start-Sleep -Milliseconds 200
  $runtimePrefix = [System.IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
  $windowsPrefix = [System.IO.Path]::GetFullPath($env:SystemRoot).TrimEnd("\") + "\"
  $modules = @()
  foreach ($module in $process.Modules) {
    $modulePath = [System.IO.Path]::GetFullPath($module.FileName)
    if (-not $modulePath.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $modulePath.StartsWith($windowsPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      $process.Kill($true)
      throw "CUDA probe loaded a non-system module outside the runtime root: $modulePath"
    }
    $modules += $module.ModuleName.ToLowerInvariant()
  }
  $modules = @($modules | Sort-Object -Unique)
  if ($lock.PSObject.Properties.Name -contains "cudaModules") {
    foreach ($required in @($lock.cudaModules.probeRequiredRuntimeRoot) + @($lock.cudaModules.probeRequiredSystem)) {
      if ($modules -notcontains $required) {
        $process.Kill($true)
        throw "CUDA required module was not loaded: $required"
      }
    }
    foreach ($forbidden in @($lock.cudaModules.forbidden)) {
      if ($modules -contains $forbidden) {
        $process.Kill($true)
        throw "CUDA forbidden module was loaded: $forbidden"
      }
    }
  }
  Write-Host "CUDA probe modules: $($modules -join ', ')"
  $stdout = $process.StandardOutput.ReadToEnd().Trim()
  $stderr = $process.StandardError.ReadToEnd().Trim()
  if (-not $process.WaitForExit(15000)) { $process.Kill($true); throw "CUDA probe timed out" }
  if ($process.ExitCode -ne 0) { throw "CUDA probe failed: exit=$($process.ExitCode) stdout=$stdout stderr=$stderr" }
  $probe = $stdout | ConvertFrom-Json
  if (-not $probe.available -or $probe.deviceIndex -ne 0 -or $probe.computeCapability -ne "8.6" -or $probe.computeType -ne "float16") {
    throw "CUDA probe identity drifted: $stdout"
  }
}

if ($IsWindows -ne $true) { throw "The Native ASR CUDA runtime can only be packaged on Windows" }
Import-VisualStudioEnvironment

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$binaryRoot = Join-Path $build "bin"
foreach ($name in @("hikaru-asr-worker.exe", "ctranslate2.dll", "hikaru_asr_tokenizer.dll")) {
  $relative = "bin/$name"
  $row = $lock.finalBuildIdentity.outputs | Where-Object { $_.path -eq $relative } | Select-Object -First 1
  if (-not $row) { throw "Final build output identity is missing from the lock: $relative" }
  $source = Join-Path $build $relative
  Assert-FileIdentity $source $row.sizeBytes $row.sha256 "final build output $relative"
  Copy-Item -LiteralPath $source -Destination (Join-Path $runtimeRoot $name)
}
Normalize-PrivateOneDnnPath (Join-Path $runtimeRoot "ctranslate2.dll")
Normalize-PrivateCargoRegistryPath (Join-Path $runtimeRoot "hikaru_asr_tokenizer.dll")

$nvidiaRoot = Join-Path $repoRoot ".cache/native-asr-cuda-runtime/cuda-12.9.1/components/libcublas-windows-x86_64-12.9.1.4-archive/libcublas-windows-x86_64-12.9.1.4-archive"
foreach ($name in @("cublas64_12.dll", "cublasLt64_12.dll")) {
  $row = $lock.redistributables | Where-Object { $_.fileName -eq $name } | Select-Object -First 1
  $source = Join-Path $nvidiaRoot "bin/$name"
  Assert-FileIdentity $source $row.sizeBytes $row.sha256 $name
  Copy-Item -LiteralPath $source -Destination (Join-Path $runtimeRoot $name)
}

$msRoot = "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Redist\MSVC\14.44.35112\x64"
foreach ($name in @("msvcp140.dll", "vcomp140.dll", "vcruntime140.dll", "vcruntime140_1.dll")) {
  $row = $lock.redistributables | Where-Object { $_.fileName -eq $name } | Select-Object -First 1
  $family = if ($name -eq "vcomp140.dll") { "Microsoft.VC143.OpenMP" } else { "Microsoft.VC143.CRT" }
  $source = Join-Path $msRoot "$family/$name"
  Assert-FileIdentity $source $row.sizeBytes $row.sha256 $name
  Copy-Item -LiteralPath $source -Destination (Join-Path $runtimeRoot $name)
}

$licenses = Join-Path $runtimeRoot "licenses"
New-Item -ItemType Directory -Force -Path $licenses | Out-Null
Copy-Item (Join-Path $repoRoot ".cache/native-asr-cuda-runtime/manual/sources/CTranslate2-4.8.0/LICENSE") (Join-Path $licenses "CTranslate2-MIT.txt")
Copy-Item (Join-Path $repoRoot ".cache/native-asr-runtime/build/sources/oneDNN-3.1.1/LICENSE") (Join-Path $licenses "oneDNN-Apache-2.0.txt")
Copy-Item (Join-Path $repoRoot ".cache/native-asr-cuda-runtime/manual/sources/pocketfft-c90e55b3d529f8efa40ed01a20de22405f45fc65/LICENSE.md") (Join-Path $licenses "pocketfft-BSD-3-Clause.txt")
Copy-Item (Join-Path $repoRoot "native-asr/third_party/nlohmann/LICENSE.MIT") (Join-Path $licenses "nlohmann-json-MIT.txt")

$cargoMetadataPath = Join-Path $work "cargo-metadata.json"
$cargoMetadataText = & cargo metadata --locked --offline --format-version 1 --manifest-path (Join-Path $repoRoot "native-asr/tokenizer-ffi/Cargo.toml")
if ($LASTEXITCODE -ne 0) { throw "cargo metadata failed" }
[System.IO.File]::WriteAllText($cargoMetadataPath, $cargoMetadataText, [System.Text.UTF8Encoding]::new($false))
$cargoMetadata = $cargoMetadataText | ConvertFrom-Json
Copy-Item (Find-CargoLicense $cargoMetadata "tokenizers") (Join-Path $licenses "tokenizers-Apache-2.0.txt")
Copy-Item (Find-CargoLicense $cargoMetadata "onig") (Join-Path $licenses "onig-MIT.txt")
Copy-Item (Find-CargoLicense $cargoMetadata "onig_sys") (Join-Path $licenses "onig-sys-MIT.txt")

$nvidia = $lock.sources.nvidiaCudaLicense
$nvidiaLicenseSource = Join-Path $nvidiaRoot $nvidia.sourceArchivePath
Assert-FileIdentity $nvidiaLicenseSource $nvidia.sizeBytes $nvidia.sha256 "NVIDIA CUDA 12.9 Update 1 license"
Copy-Item $nvidiaLicenseSource (Join-Path $runtimeRoot $nvidia.runtimePath)
$nvidiaNotice = @(
  $nvidia.projectLicenseExclusion,
  "",
  "Official CUDA terms: $($nvidia.termsUrl)",
  "Redistributable metadata: $($nvidia.redistributableMetadataUrl)",
  "Files: $((@($nvidia.files) | Sort-Object) -join ', ')"
) -join "`n"
[System.IO.File]::WriteAllText((Join-Path $runtimeRoot $nvidia.noticePath), $nvidiaNotice, [System.Text.UTF8Encoding]::new($false))

$ms = $lock.sources.microsoftVisualCppRuntimeLicense
Copy-Item (Join-Path $repoRoot ".cache/native-asr-runtime/downloads/Visual-C-V14-License-Redistributable_and_Runtime-2026-ENU.docx") (Join-Path $runtimeRoot $ms.runtimePath)
$msNotice = @"
The bundled Microsoft Visual C++ Redistributable runtime files are excluded from
Hikaru Sub's Apache-2.0 project license and are governed by the official Microsoft
Visual C++ V14 Redistributable and Runtime 2026 terms included unchanged at:
$($ms.runtimePath)

Official terms: $($ms.termsUrl)
VS 18 redistribution list: $($ms.redistributionUrl)
Acceptance stated by Microsoft: $($ms.acceptance)
Files: $((@($lock.redistributables | Where-Object { $_.fileName -notlike 'cublas*' } | ForEach-Object { $_.fileName }) | Sort-Object) -join ', ')
"@
[System.IO.File]::WriteAllText((Join-Path $licenses "Microsoft-Visual-Cpp-Runtime.txt"), $msNotice.Replace("`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))

Assert-CudaFatbin (Join-Path $runtimeRoot "ctranslate2.dll")
$imports = [ordered]@{}
foreach ($owner in $lock.importOwners) { $imports[$owner] = @(Get-PeImports (Join-Path $runtimeRoot $owner)) }
$importsPath = Join-Path $work "imports.json"
[System.IO.File]::WriteAllText($importsPath, (($imports | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))

$candidate = "$output.candidate-$PID.zip"
Invoke-Checked "node.exe" @(
  (Join-Path $repoRoot "scripts/package-native-asr-runtime.mjs"),
  "--stage", $stageRoot,
  "--lock", $lockPath,
  "--cargo-metadata", $cargoMetadataPath,
  "--imports", $importsPath,
  "--output", $candidate
)
Assert-RestrictedProbe $runtimeRoot
$size = (Get-Item -LiteralPath $candidate).Length
$sha256 = Get-Sha256 $candidate
if ($null -ne $lock.artifact.sizeBytes -and ($size -ne $lock.artifact.sizeBytes -or $sha256 -ne $lock.artifact.sha256)) {
  throw "CUDA artifact drifted from lock: size=$size sha256=$sha256"
}
New-Item -ItemType Directory -Force -Path (Split-Path $output) | Out-Null
Move-Item -LiteralPath $candidate -Destination $output -Force
[ordered]@{ archive = $output; sizeBytes = $size; sha256 = $sha256; runtimeRoot = $runtimeRoot } | ConvertTo-Json
