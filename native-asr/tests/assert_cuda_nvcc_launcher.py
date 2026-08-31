#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(message)


def same_path(left: str | Path, right: str | Path) -> bool:
    return str(Path(left).resolve()).casefold() == str(Path(right).resolve()).casefold()


def run(argv: list[str], expected: int = 0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(argv, text=True, capture_output=True, check=False)
    if result.returncode != expected:
        fail(
            f"unexpected exit {result.returncode} for {argv!r}; "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )
    return result


def cache_path(cache_text: str, name: str) -> Path:
    match = re.search(rf"^{re.escape(name)}:(?:FILEPATH|PATH|INTERNAL)=(.+)$", cache_text, re.MULTILINE)
    if not match:
        fail(f"CMake cache path is missing: {name}")
    return Path(match.group(1)).resolve()


def native_path(path: str | Path) -> str:
    return str(Path(path).resolve())


def cmake_path(path: str | Path) -> str:
    return Path(path).resolve().as_posix()


def unescape_cmake_value(value: str) -> str:
    return value.replace("\\\\", "\\")


def ordinary_ctranslate2_host_flags(build_dir: Path) -> str:
    lines = (build_dir / "build.ninja").read_text(encoding="utf-8", errors="strict").splitlines()
    for index, line in enumerate(lines):
        normalized = line.casefold()
        if (
            line.startswith("build ctranslate2\\CMakeFiles\\ctranslate2.dir\\")
            and ".cc.obj:" in normalized
        ):
            for detail in lines[index + 1 : index + 8]:
                if detail.startswith("  FLAGS = "):
                    return detail.removeprefix("  FLAGS = ")
            fail(f"ordinary CTranslate2 host compile flags are missing after: {line}")
    fail("ordinary CTranslate2 host compile command is missing from build.ninja")


def ninja_path(path: str | Path) -> str:
    return str(Path(path).resolve()).replace(":", "$:")


def assert_reproducible_tokenizer_command(
    build_dir: Path, native_asr_source: Path, reproducible_source: Path
) -> None:
    lines = (build_dir / "build.ninja").read_text(encoding="utf-8", errors="strict").split("\n")
    commands = [line for line in lines if "CARGO_TARGET_DIR=" in line and " cargo" in line.casefold()]
    if len(commands) != 1:
        fail(f"expected one generated tokenizer Cargo command, found {len(commands)}")
    command = commands[0]
    expected_flags = [
        "-Clink-arg=/Brepro",
        f"--remap-path-prefix={cmake_path(build_dir)}=build",
        f"--remap-path-prefix={cmake_path(native_asr_source)}=native-asr",
        f"--remap-path-prefix={cmake_path(reproducible_source)}=source",
    ]
    expected_encoded = "\x1f".join(expected_flags)
    expected_assignment = f"CARGO_ENCODED_RUSTFLAGS={expected_encoded}"
    if command.count(expected_assignment) != 1:
        fail(f"generated tokenizer Rust flags drifted: {command!r}")
    if any(command.count(flag) != 1 for flag in expected_flags):
        fail(f"generated tokenizer Rust flags are not exact and unique: {command!r}")
    if " RUSTFLAGS=" in command:
        fail(f"generated tokenizer command uses ambiguous RUSTFLAGS: {command!r}")
    if any(option in command.casefold() for option in ("/incremental", "/timestamp", "/debug:fastlink")):
        fail(f"generated tokenizer command contains a time-dependent linker option: {command!r}")
    required_cargo = " build --locked --offline --release --manifest-path "
    if required_cargo not in command:
        fail(f"generated tokenizer Cargo invocation drifted: {command!r}")


def assert_stable_isa_wrappers(build_dir: Path, native_asr_source: Path) -> None:
    lines = (build_dir / "build.ninja").read_text(encoding="utf-8", errors="strict").splitlines()
    expected = {
        "kernels_avx.cc": "/arch:AVX",
        "kernels_avx2.cc": "/arch:AVX2",
        "kernels_avx512.cc": "/arch:AVX512",
    }
    for file_name, arch_flag in expected.items():
        wrapper = ninja_path(native_asr_source / "src" / "ctranslate2" / file_name).casefold()
        generated = ninja_path(build_dir / "ctranslate2" / file_name).casefold()
        matches = [
            (index, line)
            for index, line in enumerate(lines)
            if line.startswith("build ctranslate2\\CMakeFiles\\ctranslate2.dir\\")
            and f"{file_name}.obj:" in line.casefold()
        ]
        if len(matches) != 1:
            fail(f"expected one CTranslate2 ISA wrapper object for {file_name}, found {len(matches)}")
        index, line = matches[0]
        normalized = line.casefold()
        if wrapper not in normalized:
            fail(f"CTranslate2 ISA object does not compile the stable wrapper: {line}")
        if generated in normalized:
            fail(f"CTranslate2 ISA object still compiles the generated build-root copy: {line}")
        flags = next(
            (
                detail.removeprefix("  FLAGS = ")
                for detail in lines[index + 1 : index + 8]
                if detail.startswith("  FLAGS = ")
            ),
            None,
        )
        if flags is None:
            fail(f"CTranslate2 ISA wrapper flags are missing after: {line}")
        arch_flags = re.findall(r"/arch:AVX(?:2|512)?", flags)
        if arch_flags != [arch_flag]:
            fail(f"CTranslate2 ISA wrapper architecture flag drifted: {file_name}: {flags!r}")


def main() -> int:
    if len(sys.argv) != 5:
        fail("usage: assert_cuda_nvcc_launcher.py BUILD_DIR LAUNCHER REAL_NVCC CT2_SOURCE_ROOT")

    build_dir = Path(sys.argv[1]).resolve()
    launcher = Path(sys.argv[2]).resolve()
    real_nvcc = Path(sys.argv[3]).resolve()
    source_root = Path(sys.argv[4]).resolve()

    if launcher.name.casefold() != "nvcc.exe":
        fail(f"canonical toolkit nvcc is not the launcher: {launcher}")
    if real_nvcc.name.casefold() != "nvcc-real.exe" or real_nvcc.parent != launcher.parent:
        fail(f"real nvcc is not separately adjacent and locked: {real_nvcc}")

    config = launcher.parent / "hikaru-nvcc-launcher.cfg"

    cache_text = (build_dir / "CMakeCache.txt").read_text(encoding="utf-8", errors="strict")
    cache_match = re.search(r"^CUDA_NVCC_EXECUTABLE:FILEPATH=(.+)$", cache_text, re.MULTILINE)
    if not cache_match or not same_path(cache_match.group(1), launcher):
        fail("FindCUDA cache did not select the canonical launcher")

    native_asr_source = cache_path(cache_text, "CMAKE_HOME_DIRECTORY")
    reproducible_source = cache_path(cache_text, "HIKARU_ASR_REPRODUCIBLE_PATH_ROOT")
    assert_reproducible_tokenizer_command(build_dir, native_asr_source, reproducible_source)
    assert_stable_isa_wrappers(build_dir, native_asr_source)
    expected_config = (
        "schemaVersion=2\n"
        f"ct2SourceRoot={cmake_path(source_root)}\n"
        f"pathmap0Label=build\npathmap0Root={cmake_path(build_dir)}\n"
        f"pathmap1Label=native-asr\npathmap1Root={cmake_path(native_asr_source)}\n"
        f"pathmap2Label=source\npathmap2Root={cmake_path(reproducible_source)}\n"
    )
    if config.read_text(encoding="utf-8") != expected_config:
        fail(f"launcher config drifted: {config}")

    expected_host_flags = [
        "-Xcompiler=/Brepro",
        "-Xcompiler=/experimental:deterministic",
        f"-Xcompiler=/pathmap:{cmake_path(build_dir)}=build",
        f"-Xcompiler=/pathmap:{cmake_path(native_asr_source)}=native-asr",
        f"-Xcompiler=/pathmap:{cmake_path(reproducible_source)}=source",
    ]
    ordinary_host_flags = ordinary_ctranslate2_host_flags(build_dir)
    expected_ordinary_pathmaps = [
        f"/pathmap:{native_path(build_dir)}=build",
        f"/pathmap:{native_path(native_asr_source)}=native-asr",
        f"/pathmap:{native_path(reproducible_source)}=source",
    ]
    ordinary_pathmap_positions = [ordinary_host_flags.find(flag) for flag in expected_ordinary_pathmaps]
    if any(position < 0 for position in ordinary_pathmap_positions):
        fail(
            "ordinary CTranslate2 host compile pathmaps are incomplete: "
            f"expected={expected_ordinary_pathmaps!r} flags={ordinary_host_flags!r}"
        )
    if ordinary_pathmap_positions != sorted(ordinary_pathmap_positions):
        fail(
            "ordinary CTranslate2 host compile pathmaps are out of order: "
            f"expected={expected_ordinary_pathmaps!r} flags={ordinary_host_flags!r}"
        )
    if any(ordinary_host_flags.count(flag) != 1 for flag in expected_ordinary_pathmaps):
        fail(f"ordinary CTranslate2 host compile pathmaps are not unique: {ordinary_host_flags!r}")
    forward_ordinary_pathmaps = [flag.removeprefix("-Xcompiler=") for flag in expected_host_flags[2:]]
    if any(flag in ordinary_host_flags for flag in forward_ordinary_pathmaps):
        fail(
            "ordinary CTranslate2 host compile pathmaps still use forward-slash roots: "
            f"flags={ordinary_host_flags!r}"
        )
    expected_arch_fragments = {
        "-gencode=arch=compute_120,code=sm_120",
        "-gencode=arch=compute_120,code=compute_120",
        "-gencode;arch=compute_61,code=sm_61",
        "-gencode;arch=compute_75,code=sm_75",
        "-gencode;arch=compute_86,code=sm_86",
        "-gencode;arch=compute_89,code=sm_89",
    }

    generated = sorted(
        (build_dir / "ctranslate2" / "CMakeFiles" / "ctranslate2.dir").rglob(
            "ctranslate2_generated_*.cmake"
        )
    )
    if len(generated) != 25:
        fail(f"expected 25 generated CUDA commands, found {len(generated)}")
    launcher_pattern = re.compile(r'^set\(CUDA_NVCC_EXECUTABLE "([^"]+)"\) # path$', re.MULTILINE)
    flags_pattern = re.compile(r"^set\(CUDA_NVCC_FLAGS (.+) ;; \) # list$", re.MULTILINE)
    build_identity = cmake_path(build_dir).casefold()
    for path in generated:
        text = path.read_text(encoding="utf-8", errors="strict")
        launcher_match = launcher_pattern.search(text)
        if not launcher_match or not same_path(launcher_match.group(1), launcher):
            fail(f"generated FindCUDA command bypasses the launcher: {path}")
        flags_match = flags_pattern.search(text)
        if not flags_match:
            fail(f"generated FindCUDA flags are missing: {path}")
        flags_text = flags_match.group(1)
        effective_flags = [unescape_cmake_value(flag) for flag in flags_text.split(";")]
        host_flags = [flag for flag in effective_flags if flag.startswith("-Xcompiler=")]
        reproducibility_flags = [
            flag
            for flag in host_flags
            if flag in {"-Xcompiler=/Brepro", "-Xcompiler=/experimental:deterministic"}
            or flag.startswith("-Xcompiler=/pathmap:")
        ]
        if reproducibility_flags != expected_host_flags:
            fail(
                f"generated host reproducibility flags drifted: {path}: "
                f"{reproducibility_flags!r}"
            )
        missing_arch = sorted(fragment for fragment in expected_arch_fragments if fragment not in flags_text)
        if missing_arch:
            fail(f"generated CUDA architecture flags drifted: {path}: {missing_arch!r}")
        build_mentions = [flag for flag in host_flags if build_identity in flag.casefold()]
        expected_build_map = f"-Xcompiler=/pathmap:{cmake_path(build_dir)}=build"
        if build_mentions != [expected_build_map]:
            fail(f"absolute build root is not normalized exactly once: {path}: {build_mentions!r}")

    self_test = run([str(launcher), "--hikaru-self-test"])
    if self_test.stdout.strip() != "ok sources=25":
        fail(f"launcher self-test output drifted: {self_test.stdout!r}")

    known = run([str(launcher), "--hikaru-seed-for", "src/cuda/primitives.cu"])
    if known.stdout.strip() != "0x1ebb9bcd":
        fail(f"known source seed drifted: {known.stdout!r}")
    run([str(launcher), "--hikaru-seed-for", "src/unknown.cu"], expected=86)

    known_source = source_root / "src/cuda/primitives.cu"
    second_source = source_root / "src/cuda/random.cu"
    forward_pathmaps = expected_host_flags[2:]
    native_pathmaps = [
        f"-Xcompiler=/pathmap:{native_path(build_dir)}=build",
        f"-Xcompiler=/pathmap:{native_path(native_asr_source)}=native-asr",
        f"-Xcompiler=/pathmap:{native_path(reproducible_source)}=source",
    ]
    untouched = "--keep-literal=/pathmap:C:/not-a-host-map=unchanged"
    dry_run = run(
        [
            str(launcher),
            "--hikaru-dry-run",
            str(known_source),
            untouched,
            *forward_pathmaps,
        ]
    )
    forwarded = dry_run.stdout.splitlines()
    if forwarded != [
        str(known_source),
        untouched,
        *native_pathmaps,
        "--frandom-seed=0x1ebb9bcd",
    ]:
        fail(f"launcher dry-run forwarding drifted: {forwarded!r}")
    if any("\\" in flag for flag in forward_pathmaps):
        fail(f"generated CMake pathmaps are not parse-safe forward-slash flags: {forward_pathmaps!r}")
    if any("\\" not in flag.partition("=")[2].rsplit("=", 1)[0] for flag in native_pathmaps):
        fail(f"forwarded NVCC pathmaps are not native-backslash flags: {native_pathmaps!r}")

    malformed = ["-Xcompiler=/pathmap:relative=build", *forward_pathmaps[1:]]
    duplicate = [forward_pathmaps[0], forward_pathmaps[0], forward_pathmaps[2]]
    unexpected_label = [forward_pathmaps[0].rsplit("=", 1)[0] + "=other", *forward_pathmaps[1:]]
    for rejected in (malformed, duplicate, unexpected_label):
        run(
            [str(launcher), "--hikaru-dry-run", str(known_source), *rejected],
            expected=86,
        )

    run([str(launcher), str(known_source), "--frandom-seed=0x1"], expected=86)
    run([str(launcher), str(known_source), str(second_source)], expected=86)
    run([str(launcher), str(source_root / "src/unknown.cu")], expected=86)

    version = run([str(launcher), "--version"])
    if "release 12.9, V12.9.86" not in version.stdout + version.stderr:
        fail("launcher did not forward non-source discovery to the pinned real nvcc")

    print(
        f"ok generated={len(generated)} launcher={launcher} "
        f"ordinary-host-flags={ordinary_host_flags}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
