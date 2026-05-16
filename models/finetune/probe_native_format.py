"""Probe v3 LoRA using the EXACT training data format.

Loads an ending check_in row from the held-out test set, renders it the same
way the trainer did (system + structured user block, apply_chat_template with
tools=[endConversation]), and checks whether the model emits
<|tool_call>...<tool_call|> when generating from the model turn.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, "/home/ubuntu/wave/models/finetune")
sys.path.insert(0, "/home/ubuntu/wave/models")

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from train_wave_session_lora import (
    Example,
    build_prompt_messages,
    render_chat_text,
    tools_for_example,
)

MERGE_DIR = "/home/ubuntu/wave/models/runs/merge-toolcall-v3"
TEST_JSONL = Path("/home/ubuntu/wave/models/runs/lora-wave-session-toolcall-v3/test.jsonl")

# Find an ending check_in row in the test set. The trainer's test.jsonl is the
# post-normalize Example shape, so we can construct Example directly.
target = None
with TEST_JSONL.open("r", encoding="utf-8") as f:
    for line in f:
        row = json.loads(line)
        if row["surface"] != "check_in":
            continue
        if row["output_payload"].get("endConversation") is None:
            continue
        target = Example(
            example_id=row["example_id"],
            surface=row["surface"],
            prompt=row["prompt"],
            output_payload=row["output_payload"],
            metadata=row["metadata"],
            messages=row["messages"],
            split_key=row["split_key"],
        )
        break
assert target is not None, "no ending check_in in test set"
print(f"Using test row id={target.example_id}")
print(f"Expected ending: {target.output_payload}")

# Load model + tokenizer with the base chat template (matches trainer fix).
tok = AutoTokenizer.from_pretrained(MERGE_DIR)
model = AutoModelForCausalLM.from_pretrained(MERGE_DIR, torch_dtype=torch.bfloat16, device_map="cuda")
model.eval()

# Render the prompt the same way the trainer would (system + user, tools= for check_in).
prompt_text = render_chat_text(
    tok,
    build_prompt_messages(target),
    add_generation_prompt=True,
    tools=tools_for_example(target),
).removeprefix("<bos>")

print(f"\n--- Rendered prompt (last 600 chars) ---")
print(prompt_text[-600:])
print("--- end prompt ---")

inputs = tok(prompt_text, return_tensors="pt", add_special_tokens=False).to(model.device)
with torch.inference_mode():
    out = model.generate(
        **inputs, max_new_tokens=200, do_sample=False, temperature=None, top_p=None,
    )
new_tokens = out[0, inputs.input_ids.shape[1]:]
raw = tok.decode(new_tokens, skip_special_tokens=False)
print(f"\n=== RAW OUTPUT ===\n{raw}\n")

pieces = [tok.decode([tid], skip_special_tokens=False) for tid in new_tokens.tolist()[:40]]
print(f"=== First 40 tokens ===")
for i, p in enumerate(pieces):
    print(f"  {i:3d}: {json.dumps(p)}")

ids = new_tokens.tolist()
hits = [t for t in ids if t in (48, 49)]
print(f"\n=== VERDICT ===")
if hits:
    print(f"PASS — tool token IDs found: {hits[:5]}")
else:
    print(f"FAIL — no tool tokens in output.")
