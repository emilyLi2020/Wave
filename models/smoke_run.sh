#!/usr/bin/env bash
# Smoke harness — runs the three v4 sanity tests before committing to full
# v4 training. Each smoke trains for very few steps, merges the adapter, and
# probes with test_tool_calling.py. If smoke C passes, we have evidence the
# v4 plan will produce a working LoRA when run for 3 full epochs.
#
# Run from /home/ubuntu/wave/models on the H200 after `uv sync` finishes.
#
#   bash /home/ubuntu/smoke_run.sh A         # 1-step on 1 row
#   bash /home/ubuntu/smoke_run.sh B         # 1 epoch on 4-surface mix
#   bash /home/ubuntu/smoke_run.sh C         # 0.1 epoch on full v4
#   bash /home/ubuntu/smoke_run.sh all       # A then B then C
set -euo pipefail
cd /home/ubuntu/wave/models
export HF_TOKEN=$(cat /home/ubuntu/.hf_token)
export HUGGINGFACE_HUB_TOKEN="$HF_TOKEN"

run_one_smoke() {
  local label="$1"
  local data_file="$2"
  local epochs="$3"
  local extra_flags="${4:-}"

  local run_dir="runs/smoke-${label}"
  local merge_dir="runs/smoke-${label}-merged"

  echo
  echo "============================================================"
  echo "SMOKE ${label}: data=${data_file} epochs=${epochs}"
  echo "============================================================"
  echo "[smoke ${label}] start $(date -u)"

  rm -rf "${run_dir}" "${merge_dir}"

  # Train.
  uv run python finetune/train_wave_session_lora.py \
    --data "${data_file}" \
    --output-dir "${run_dir}" \
    --model-id unsloth/gemma-4-E2B-it \
    --backend unsloth \
    --seed 7 \
    --epochs "${epochs}" \
    --batch-size 1 \
    --gradient-accumulation-steps 8 \
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
    --skip-generation-eval \
    ${extra_flags} 2>&1 | tee "${run_dir}-train.log"
  echo "[smoke ${label}] train done $(date -u)"

  # Find the saved adapter (trainer writes timestamped subdir).
  local adapter_dir
  adapter_dir=$(find "${run_dir}" -name "adapter_config.json" -exec dirname {} \; | head -1)
  if [ -z "${adapter_dir}" ]; then
    echo "[smoke ${label}] ERROR — no adapter saved"
    return 1
  fi
  echo "[smoke ${label}] adapter at ${adapter_dir}"

  # Merge (CPU is fine, fast for a tiny adapter).
  uv run python finetune/merge_lora_peft.py \
    --base unsloth/gemma-4-E2B-it \
    --adapter "${adapter_dir}" \
    --out-dir "${merge_dir}" \
    --device cpu \
    --dtype bfloat16 2>&1 | tail -5

  # Back-fill the tokenizer aux files our merge script can't copy from local paths.
  cp -n "${adapter_dir}/chat_template.jinja" "${merge_dir}/" 2>/dev/null || true
  cp -n "${adapter_dir}/processor_config.json" "${merge_dir}/" 2>/dev/null || true
  echo "[smoke ${label}] merge done $(date -u)"

  # Probe 1: tool-call gate (the make-or-bust check)
  echo
  echo "--- TOOL-CALL PROBE ---"
  uv run python finetune/test_tool_calling.py \
    --source-repo "${merge_dir}" --max-new-tokens 200 2>&1 | tail -30 \
    | tee "${run_dir}-probe.log"

  # Probe 2: regression (only for B and C — A only has ending check_in rows)
  if [ "${label}" != "A" ]; then
    echo
    echo "--- PHASE/REFLECTION REGRESSION PROBE ---"
    # Find a test.jsonl with phase/reflection rows. For smoke runs we use the
    # full v4 split's test set so the probe has rows to evaluate.
    local v4_test
    v4_test=$(find runs/lora-wave-session-toolcall-v4 -name "test.jsonl" 2>/dev/null | head -1)
    if [ -z "${v4_test}" ]; then
      # Smoke run's own test.jsonl probably lacks phase/reflection — use dry-v4
      v4_test=$(find runs/dry-v4 -name "test.jsonl" 2>/dev/null | head -1)
    fi
    if [ -n "${v4_test}" ]; then
      uv run python finetune/test_regression_phase_reflection.py \
        --source-repo "${merge_dir}" \
        --test-jsonl "${v4_test}" \
        --per-surface 5 2>&1 | tail -30 | tee "${run_dir}-regression.log"
    else
      echo "[smoke ${label}] no test.jsonl available for regression probe; skipping"
    fi
  fi

  echo
  echo "[smoke ${label}] complete $(date -u)"
  echo "  Train log : ${run_dir}-train.log"
  echo "  Probe log : ${run_dir}-probe.log"
}

case "${1:-all}" in
  A)
    run_one_smoke A datasets/lora-wave-session-toolcall-v4-smokeA.jsonl 1.0
    ;;
  B)
    run_one_smoke B datasets/lora-wave-session-toolcall-v4-smokeB.jsonl 1.0
    ;;
  C)
    # Generate the dry-v4 split first so the regression probe has phase/reflection rows.
    if [ ! -f runs/dry-v4/test.jsonl ]; then
      uv run python finetune/train_wave_session_lora.py \
        --data datasets/lora-wave-session-toolcall-v4.jsonl \
        --output-dir runs/dry-v4 --dry-run 2>&1 | tail -3
    fi
    run_one_smoke C datasets/lora-wave-session-toolcall-v4.jsonl 0.1
    ;;
  all)
    "$0" A
    "$0" B
    "$0" C
    ;;
  *)
    echo "usage: $0 {A|B|C|all}"
    exit 1
    ;;
esac
