#!/usr/bin/env bash
# 安装 asr-service Python 依赖（创建 .venv、faster-whisper 引擎、可选 Parakeet / Qwen3-ASR）。
#
#   ./scripts/setup-asr.sh                    # 默认：faster-whisper（requirements.txt）
#   ./scripts/setup-asr.sh parakeet           # 额外安装 Parakeet（按 GPU 选 CPU/CUDA torch）
#   ./scripts/setup-asr.sh parakeet-cuda
#   ./scripts/setup-asr.sh qwen3              # 额外安装 Qwen3-ASR（按 GPU 选 CPU/CUDA torch）
#   ./scripts/setup-asr.sh qwen3-cuda
#   ./scripts/setup-asr.sh --recreate         # 重建 .venv 后安装默认引擎
#
# 环境变量：
#   PYTHON=python3.11   指定用于创建 venv 的解释器

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASR_DIR="$(cd "$SCRIPT_DIR/../asr-service" && pwd)"
PYTHON="${PYTHON:-python3}"
RECREATE=0

usage() {
  cat <<'EOF'
用法: setup-asr.sh [选项] [引擎...]

默认（无引擎参数）安装 faster-whisper 及 sidecar 运行依赖。
仅当显式声明 Parakeet 引擎时，才会额外安装 NeMo / PyTorch。

引擎（可组合，默认 faster-whisper 始终会安装）：
  parakeet       安装 Parakeet；torch 按 GPU 自动选择 CPU / CUDA
  parakeet-cpu   安装 Parakeet（CPU 版 torch，无 nvidia-cudnn 等）
  parakeet-cuda  安装 Parakeet（CUDA 12.6 torch）
  qwen3          安装 Qwen3-ASR；torch 按 GPU 自动选择 CPU / CUDA
  qwen3-cpu      安装 Qwen3-ASR（CPU 版 torch）
  qwen3-cuda     安装 Qwen3-ASR（CUDA 12.6 torch）

选项：
  --recreate     删除已有 asr-service/.venv 后重建
  -h, --help     显示此帮助

示例：
  ./scripts/setup-asr.sh
  ./scripts/setup-asr.sh parakeet-cuda
  ./scripts/setup-asr.sh --recreate parakeet
  ./scripts/setup-asr.sh qwen3-cuda
  ./scripts/setup-asr.sh qwen3
  pnpm asr:setup
  pnpm asr:setup -- parakeet-cuda
EOF
}

log() {
  printf '==> %s\n' "$*"
}

has_nvidia_gpu() {
  command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1
}

ensure_python() {
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "未找到 Python 解释器: $PYTHON" >&2
    exit 1
  fi
  local version
  version="$("$PYTHON" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  log "使用 Python $version ($PYTHON)"
}

create_venv() {
  cd "$ASR_DIR"
  if [[ "$RECREATE" -eq 1 && -d .venv ]]; then
    log "删除已有虚拟环境: $ASR_DIR/.venv"
    rm -rf .venv
  fi
  if [[ ! -d .venv ]]; then
    log "创建虚拟环境: $ASR_DIR/.venv"
    "$PYTHON" -m venv .venv
  else
    log "复用虚拟环境: $ASR_DIR/.venv"
  fi
  # shellcheck disable=SC1091
  source .venv/bin/activate
  python -m pip install --upgrade pip
}

install_faster_whisper() {
  log "安装 faster-whisper 引擎 (requirements.txt)"
  pip install -r requirements.txt
}

install_parakeet_profile() {
  local profile="$1"
  case "$profile" in
    parakeet-cpu)
      log "安装 Parakeet 引擎 (CPU torch + NeMo)"
      pip install -r requirements-parakeet-cpu.txt
      ;;
    parakeet-cuda)
      if ! has_nvidia_gpu; then
        echo "警告: 未检测到 NVIDIA GPU，仍将安装 CUDA 版 torch（体积大且可能无法加速）。" >&2
        echo "      非 N 卡环境请改用: ./scripts/setup-asr.sh parakeet-cpu" >&2
      fi
      log "安装 Parakeet 引擎 (CUDA 12.6 torch + NeMo)"
      pip install -r requirements-parakeet-cuda.txt
      ;;
    *)
      echo "内部错误: 未知 Parakeet profile: $profile" >&2
      exit 1
      ;;
  esac
}

install_qwen3_profile() {
  local profile="$1"
  case "$profile" in
    qwen3-cpu)
      log "安装 Qwen3-ASR 引擎 (CPU torch + qwen-asr)"
      pip install -r requirements-qwen3-cpu.txt
      ;;
    qwen3-cuda)
      if ! has_nvidia_gpu; then
        echo "警告: 未检测到 NVIDIA GPU，仍将安装 CUDA 版 torch（体积大且可能无法加速）。" >&2
        echo "      非 N 卡环境请改用: ./scripts/setup-asr.sh qwen3-cpu" >&2
      fi
      log "安装 Qwen3-ASR 引擎 (CUDA 12.6 torch + qwen-asr)"
      pip install -r requirements-qwen3-cuda.txt
      ;;
    *)
      echo "内部错误: 未知 Qwen3 profile: $profile" >&2
      exit 1
      ;;
  esac
}

resolve_parakeet_profile() {
  if has_nvidia_gpu; then
    echo "parakeet-cuda"
  else
    echo "parakeet-cpu"
  fi
}

resolve_parakeet_profiles() {
  local -a engines=("$@")
  local want_auto=0
  local want_cpu=0
  local want_cuda=0
  local engine

  for engine in "${engines[@]}"; do
    case "$engine" in
      parakeet) want_auto=1 ;;
      parakeet-cpu) want_cpu=1 ;;
      parakeet-cuda) want_cuda=1 ;;
    esac
  done

  if [[ "$want_cpu" -eq 1 && "$want_cuda" -eq 1 ]]; then
    echo "不能同时指定 parakeet-cpu 与 parakeet-cuda。" >&2
    exit 1
  fi
  if [[ "$want_cuda" -eq 1 ]]; then
    echo "parakeet-cuda"
    return
  fi
  if [[ "$want_cpu" -eq 1 ]]; then
    echo "parakeet-cpu"
    return
  fi
  if [[ "$want_auto" -eq 1 ]]; then
    resolve_parakeet_profile
  fi
}

resolve_qwen3_profile() {
  if has_nvidia_gpu; then
    echo "qwen3-cuda"
  else
    echo "qwen3-cpu"
  fi
}

resolve_qwen3_profiles() {
  local -a engines=("$@")
  local want_auto=0
  local want_cpu=0
  local want_cuda=0
  local engine

  for engine in "${engines[@]}"; do
    case "$engine" in
      qwen3) want_auto=1 ;;
      qwen3-cpu) want_cpu=1 ;;
      qwen3-cuda) want_cuda=1 ;;
    esac
  done

  if [[ "$want_cpu" -eq 1 && "$want_cuda" -eq 1 ]]; then
    echo "不能同时指定 qwen3-cpu 与 qwen3-cuda。" >&2
    exit 1
  fi
  if [[ "$want_cuda" -eq 1 ]]; then
    echo "qwen3-cuda"
    return
  fi
  if [[ "$want_cpu" -eq 1 ]]; then
    echo "qwen3-cpu"
    return
  fi
  if [[ "$want_auto" -eq 1 ]]; then
    resolve_qwen3_profile
  fi
}

install_engines() {
  local -a engines=("$@")
  local engine profile

  for engine in "${engines[@]}"; do
    case "$engine" in
      parakeet | parakeet-cpu | parakeet-cuda) ;;
      qwen3 | qwen3-cpu | qwen3-cuda) ;;
      base)
        echo "提示: 引擎参数 'base' 已弃用，默认即安装 faster-whisper；可省略该参数。" >&2
        ;;
      *)
        echo "未知引擎: $engine" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  install_faster_whisper

  profile="$(resolve_parakeet_profiles "${engines[@]}")"
  if [[ -n "$profile" ]]; then
    if [[ " ${engines[*]} " == *" parakeet "* ]]; then
      log "Parakeet torch 配置: ${profile#parakeet-}"
    fi
    install_parakeet_profile "$profile"
  fi

  profile="$(resolve_qwen3_profiles "${engines[@]}")"
  if [[ -n "$profile" ]]; then
    if [[ " ${engines[*]} " == *" qwen3 "* ]]; then
      log "Qwen3-ASR torch 配置: ${profile#qwen3-}"
    fi
    install_qwen3_profile "$profile"
  fi
}

main() {
  local -a engines=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      --recreate)
        RECREATE=1
        shift
        ;;
      parakeet | parakeet-cpu | parakeet-cuda | qwen3 | qwen3-cpu | qwen3-cuda | base)
        engines+=("$1")
        shift
        ;;
      auto)
        echo "提示: 模式 'auto' 已移除；默认仅安装 faster-whisper。" >&2
        echo "      需要 Parakeet 时请显式传入 parakeet / parakeet-cpu / parakeet-cuda。" >&2
        shift
        ;;
      *)
        echo "未知参数: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  ensure_python

  if [[ ${#engines[@]} -eq 0 ]]; then
    log "将安装默认引擎: faster-whisper"
  else
    log "将安装 faster-whisper + 额外引擎: ${engines[*]}"
  fi

  create_venv
  install_engines "${engines[@]}"

  log "完成。激活虚拟环境："
  printf '    source %s/.venv/bin/activate\n' "$ASR_DIR"
}

main "$@"
