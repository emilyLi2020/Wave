#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/wave/models
export HF_TOKEN=$(cat /home/ubuntu/.hf_token)
export HUGGINGFACE_HUB_TOKEN="$HF_TOKEN"
echo "[setup] starting uv sync at $(date -u)"
uv sync 2>&1
echo "[setup] uv sync done at $(date -u)"
echo "[setup] verifying torch/cuda"
uv run python -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), 'device', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none')"
echo "[setup] verifying unsloth import"
uv run python -c "import unsloth; print('unsloth', unsloth.__version__)"
echo "[setup] done at $(date -u)"
