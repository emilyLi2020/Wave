#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/wave/models
export HF_TOKEN=$(cat /home/ubuntu/.hf_token)
export HUGGINGFACE_HUB_TOKEN="$HF_TOKEN"

ADAPTER_DIR=/home/ubuntu/wave/models/runs/lora-wave-session-toolcall-v3/adapter
MERGE_DIR=/home/ubuntu/wave/models/runs/merge-toolcall-v3

echo "[merge] starting at $(date -u)"
# CPU merge avoids GPU contention with the still-running trainer eval.
uv run python finetune/merge_lora_peft.py \
  --base unsloth/gemma-4-E2B-it \
  --adapter "$ADAPTER_DIR" \
  --out-dir "$MERGE_DIR" \
  --device cpu \
  --dtype bfloat16
echo "[merge] done at $(date -u)"

# Wait for any leftover trainer process to release the GPU before diagnose/probe.
echo "[merge] waiting for trainer to release GPU…"
while pgrep -af 'python.*train_wave_session_lora.py' >/dev/null; do
  sleep 10
done
echo "[merge] GPU free at $(date -u)"

cp -n "$ADAPTER_DIR/chat_template.jinja" "$MERGE_DIR/" 2>/dev/null || true
cp -n "$ADAPTER_DIR/processor_config.json" "$MERGE_DIR/" 2>/dev/null || true
ls -la "$MERGE_DIR/"

echo "[diagnose] running smoke test on merge"
uv run python finetune/diagnose_merged_base.py \
  --source-repo "$MERGE_DIR" \
  --prompts "I'm feeling anxious right now. What's one small thing I can do?" \
            "What is the capital of France? Answer in one sentence." \
  --max-new-tokens 48 \
  --device cuda \
  --dtype bfloat16
echo "[diagnose] done at $(date -u)"

echo "[probe] running tool-emission probe"
uv run python finetune/test_tool_calling.py \
  --source-repo "$MERGE_DIR" \
  --max-new-tokens 200
echo "[probe] done at $(date -u)"
