#!/usr/bin/env bash
# 安装 asr-service Python 依赖（创建 .venv、faster-whisper / kotoba-faster-whisper、可选 Parakeet / Qwen3-ASR / ReazonSpeech）。
#
#   ./scripts/setup-asr.sh                    # faster-whisper / kotoba-faster-whisper 依赖
#   ./scripts/setup-asr.sh parakeet           # 额外安装 Parakeet（按 GPU 选 CPU/CUDA torch）
#   ./scripts/setup-asr.sh parakeet-cuda
#   ./scripts/setup-asr.sh qwen3              # 额外安装 Qwen3-ASR（按 GPU 选 CPU/CUDA torch）
#   ./scripts/setup-asr.sh qwen3-cuda
#   ./scripts/setup-asr.sh reazonspeech       # 额外安装 ReazonSpeech（按 GPU 选 CPU/CUDA torch）
#   ./scripts/setup-asr.sh reazonspeech-cuda
#   ./scripts/setup-asr.sh --recreate         # 重建 .venv 后安装共用依赖
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

默认（无引擎参数）安装 faster-whisper / kotoba-faster-whisper 依赖。
仅当显式声明 Parakeet / Qwen3-ASR / ReazonSpeech 引擎时，才会额外安装对应依赖。

引擎（可组合，faster-whisper / kotoba-faster-whisper 依赖始终会安装）：
  parakeet          安装 Parakeet；torch 按 GPU 自动选择 CPU / CUDA
  parakeet-cpu      安装 Parakeet（CPU 版 torch，无 nvidia-cudnn 等）
  parakeet-cuda     安装 Parakeet（CUDA 12.6 torch）
  qwen3             安装 Qwen3-ASR；torch 按 GPU 自动选择 CPU / CUDA
  qwen3-cpu         安装 Qwen3-ASR（CPU 版 torch）
  qwen3-cuda        安装 Qwen3-ASR（CUDA 12.6 torch）
  reazonspeech      安装 ReazonSpeech；torch 按 GPU 自动选择 CPU / CUDA
  reazonspeech-cpu  安装 ReazonSpeech（CPU 版 torch，无 torchaudio 直接依赖）
  reazonspeech-cuda 安装 ReazonSpeech（CUDA 12.6 torch）

选项：
  --recreate     删除已有 asr-service/.venv 后重建
  -h, --help     显示此帮助

示例：
  ./scripts/setup-asr.sh
  ./scripts/setup-asr.sh parakeet-cuda
  ./scripts/setup-asr.sh --recreate parakeet
  ./scripts/setup-asr.sh qwen3-cuda
  ./scripts/setup-asr.sh reazonspeech-cuda
  ./scripts/setup-asr.sh reazonspeech
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
  log "安装 faster-whisper / kotoba-faster-whisper 依赖 (requirements.txt)"
  pip install -r requirements.txt
}

resolve_engine_profile() {
  local prefix="$1"
  shift
  local want_auto=0 want_cpu=0 want_cuda=0 engine

  for engine in "$@"; do
    if [[ "$engine" == "$prefix" ]]; then
      want_auto=1
    elif [[ "$engine" == "$prefix-cpu" ]]; then
      want_cpu=1
    elif [[ "$engine" == "$prefix-cuda" ]]; then
      want_cuda=1
    fi
  done

  if [[ "$want_cpu" -eq 1 && "$want_cuda" -eq 1 ]]; then
    echo "不能同时指定 $prefix-cpu 与 $prefix-cuda。" >&2
    exit 1
  fi
  if [[ "$want_cuda" -eq 1 ]]; then
    echo "$prefix-cuda"
  elif [[ "$want_cpu" -eq 1 ]]; then
    echo "$prefix-cpu"
  elif [[ "$want_auto" -eq 1 ]]; then
    if has_nvidia_gpu; then
      echo "$prefix-cuda"
    else
      echo "$prefix-cpu"
    fi
  fi
}

install_engine_profile() {
  local prefix="$1" label="$2" dependency="$3" profile="$4"
  local device="${profile##*-}"
  local requirement="requirements-${profile}.txt"

  if [[ "$device" == "cuda" ]]; then
    if ! has_nvidia_gpu; then
      echo "警告: 未检测到 NVIDIA GPU，仍将安装 CUDA 版 torch（体积大且可能无法加速）。" >&2
      echo "      非 N 卡环境请改用: ./scripts/setup-asr.sh $prefix-cpu" >&2
    fi
    device="CUDA 12.6"
  else
    device="CPU"
  fi
  if [[ "$prefix" == "reazonspeech" ]]; then
    requirement="requirements-reazonspeech.txt"
  fi

  log "安装 $label 引擎 ($device torch + $dependency)"
  pip install -r "$requirement"
}

install_requested_engine() {
  local prefix="$1" label="$2" dependency="$3"
  shift 3
  local profile

  profile="$(resolve_engine_profile "$prefix" "$@")"
  if [[ -z "$profile" ]]; then
    return
  fi
  if [[ " $* " == *" $prefix "* ]]; then
    log "$label torch 配置: ${profile#"$prefix-"}"
  fi
  install_engine_profile "$prefix" "$label" "$dependency" "$profile"
}

install_engines() {
  local -a engines=("$@")
  local engine

  for engine in "${engines[@]}"; do
    case "$engine" in
      parakeet | parakeet-cpu | parakeet-cuda) ;;
      qwen3 | qwen3-cpu | qwen3-cuda) ;;
      reazonspeech | reazonspeech-cpu | reazonspeech-cuda) ;;
      base)
        echo "提示: 引擎参数 'base' 已弃用，默认即安装 faster-whisper / kotoba-faster-whisper 依赖；可省略该参数。" >&2
        ;;
      *)
        echo "未知引擎: $engine" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  install_faster_whisper

  install_requested_engine parakeet Parakeet NeMo "${engines[@]}"
  install_requested_engine qwen3 Qwen3-ASR qwen-asr "${engines[@]}"
  install_requested_engine reazonspeech ReazonSpeech NeMo "${engines[@]}"
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
      parakeet | parakeet-cpu | parakeet-cuda | qwen3 | qwen3-cpu | qwen3-cuda | reazonspeech | reazonspeech-cpu | reazonspeech-cuda | base)
        engines+=("$1")
        shift
        ;;
      auto)
        echo "提示: 模式 'auto' 已移除；默认安装 faster-whisper / kotoba-faster-whisper 依赖。" >&2
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
    log "将安装 faster-whisper / kotoba-faster-whisper 依赖"
  else
    log "将安装 faster-whisper / kotoba-faster-whisper 依赖 + 额外引擎: ${engines[*]}"
  fi

  create_venv
  install_engines "${engines[@]}"

  log "完成。激活虚拟环境："
  printf '    source %s/.venv/bin/activate\n' "$ASR_DIR"
}

main "$@"
