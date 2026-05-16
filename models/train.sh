#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/wave/models
export HF_TOKEN=$(cat /home/ubuntu/.hf_token)
export HUGGINGFACE_HUB_TOKEN="$HF_TOKEN"
echo "[train] starting at $(date -u)"
uv run python finetune/train_wave_session_lora.py \
  --data datasets/lora-wave-session-toolcall.jsonl \
  --output-dir runs/lora-wave-session-toolcall-v3 \
  --model-id unsloth/gemma-4-E2B-it \
  --backend unsloth \
  --seed 7 \
  --epochs 1 \
  --batch-size 1 \
  --gradient-accumulation-steps 8 \
  --learning-rate 2e-4 \
  --weight-decay 0.001 \
  --max-grad-norm 0.3 \
  --lora-r 16 \
  --lora-alpha 32 \
  --lora-dropout 0.0 \
  --max-seq-length 3072 \
  --max-new-tokens 420 \
  --save-steps 50 \
  --save-total-limit 5 \
  --validation-size 0.10 \
  --test-size 0.10 \
  --validation-eval-mode completion \
  --final-eval-mode completion \
  --skip-generation-eval 2>&1
echo "[train] finished at $(date -u)"
