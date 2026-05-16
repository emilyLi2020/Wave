#!/usr/bin/env bash
# v6 — 1-epoch fast iteration. Same hyperparams as v5 (batch 8, lr 5e-5,
# lora r=8/alpha=16) but ONE epoch (~476 steps, ~11 min on B200) to see if
# the v6 dataset shape (plain-text endConversation{...}\n<reply>) is being
# learned before committing to 3 epochs.
#
# After training: merge adapter, then probe BOTH base Gemma 4 and merged v6
# on the same 3 ending check_in rows so we can compare side-by-side.

set -euo pipefail
cd /workspace/wave/models
mkdir -p runs

export HF_HOME=/workspace/.hf_home
export HF_TOKEN=$(cat /workspace/.hf_token 2>/dev/null || echo "")
export HUGGINGFACE_HUB_TOKEN="$HF_TOKEN"

RUN_DIR=runs/lora-wave-session-toolcall-v6-1ep
MERGE_DIR=runs/merge-toolcall-v6-1ep

echo "============================================================"
echo "v6 1-epoch run starting $(date -u)"
echo "============================================================"

rm -rf "${RUN_DIR}" "${MERGE_DIR}"

# --- Train ---
uv run python finetune/train_wave_session_lora.py \
  --data datasets/lora-wave-session-toolcall-v6.jsonl \
  --output-dir "${RUN_DIR}" \
  --model-id unsloth/gemma-4-E2B-it \
  --backend unsloth \
  --seed 7 \
  --epochs 1.0 \
  --batch-size 8 \
  --gradient-accumulation-steps 1 \
  --learning-rate 5e-5 \
  --weight-decay 0.001 \
  --max-grad-norm 0.3 \
  --lora-r 8 \
  --lora-alpha 16 \
  --lora-dropout 0.0 \
  --max-seq-length 3072 \
  --max-new-tokens 420 \
  --save-steps 100 \
  --save-total-limit 2 \
  --validation-size 0.05 \
  --test-size 0.05 \
  --validation-eval-mode completion \
  --final-eval-mode completion \
  --skip-generation-eval 2>&1 | tee /workspace/wave/v6-1ep-train.log

echo "[v6] train done $(date -u)"

# --- Find adapter ---
ADAPTER_DIR=$(find "${RUN_DIR}" -name "adapter_config.json" -not -path "*checkpoints*" -exec dirname {} \; | head -1)
if [ -z "${ADAPTER_DIR}" ]; then
  # fallback: latest checkpoint
  ADAPTER_DIR=$(find "${RUN_DIR}/checkpoints" -name "adapter_config.json" -exec dirname {} \; | sort | tail -1)
fi
echo "[v6] adapter at ${ADAPTER_DIR}"

# --- Merge ---
uv run python finetune/merge_lora_peft.py \
  --base unsloth/gemma-4-E2B-it \
  --adapter "${ADAPTER_DIR}" \
  --out-dir "${MERGE_DIR}" \
  --device cpu \
  --dtype bfloat16 2>&1 | tail -10

# Back-fill tokenizer aux files
cp -n "${ADAPTER_DIR}/chat_template.jinja" "${MERGE_DIR}/" 2>/dev/null || true
cp -n "${ADAPTER_DIR}/processor_config.json" "${MERGE_DIR}/" 2>/dev/null || true
echo "[v6] merge done $(date -u)"

# --- Probe BASE on same 3 rows ---
echo
echo "============================================================"
echo "PROBE: BASE Gemma 4 (no LoRA)"
echo "============================================================"
uv run python finetune/probe_base_gemma_native.py \
  --source-repo unsloth/gemma-4-E2B-it \
  --dataset datasets/lora-wave-session-toolcall-v6.jsonl \
  --num-rows 3 \
  --max-new-tokens 200 2>&1 | tee /workspace/wave/v6-1ep-probe-base.log

# --- Probe v6 MERGED on same 3 rows ---
echo
echo "============================================================"
echo "PROBE: v6 MERGED (1 epoch)"
echo "============================================================"
uv run python finetune/probe_base_gemma_native.py \
  --source-repo "${MERGE_DIR}" \
  --dataset datasets/lora-wave-session-toolcall-v6.jsonl \
  --num-rows 3 \
  --max-new-tokens 200 2>&1 | tee /workspace/wave/v6-1ep-probe-merged.log

echo
echo "============================================================"
echo "v6 1-epoch run COMPLETE $(date -u)"
echo "  train log : /workspace/wave/v6-1ep-train.log"
echo "  base probe: /workspace/wave/v6-1ep-probe-base.log"
echo "  v6 probe  : /workspace/wave/v6-1ep-probe-merged.log"
echo "  adapter   : ${ADAPTER_DIR}"
echo "  merged    : ${MERGE_DIR}"
echo "============================================================"
