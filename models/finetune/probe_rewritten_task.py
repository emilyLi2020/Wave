"""Test if v3 LoRA can emit tool calls when the user prompt's <task> block
asks for tool calling instead of JSON."""
import json
import re
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

NEW_TASK_BLOCK = """<task>
Write the agent's next turn only. Keep it to 1-3 short sentences in patient-facing voice. When the patient has clearly signalled readiness to continue, also call the endConversation tool with their current cravingScore (integer 1-10) and obstacleCategory (one of the allowed enum values), and pair it with a warm 1-2 sentence closing hand-off in the same response. Otherwise just reply.
</task>"""

target = None
with TEST_JSONL.open("r", encoding="utf-8") as f:
    for line in f:
        row = json.loads(line)
        if row["surface"] != "check_in":
            continue
        if row["output_payload"].get("endConversation") is None:
            continue
        # Rewrite the <task> block.
        new_prompt = re.sub(
            r"<task>.*?</task>", NEW_TASK_BLOCK, row["prompt"], flags=re.DOTALL,
        )
        assert new_prompt != row["prompt"], "task block not found"
        # Mirror the rewrite into messages so build_prompt_messages picks it up.
        new_messages = [
            {"role": "system", "content": row["messages"][0]["content"]},
            {"role": "user", "content": new_prompt},
        ]
        target = Example(
            example_id=row["example_id"],
            surface=row["surface"],
            prompt=new_prompt,
            output_payload=row["output_payload"],
            metadata=row["metadata"],
            messages=new_messages,
            split_key=row["split_key"],
        )
        break
assert target is not None
print(f"Using test row id={target.example_id}")
print(f"Expected ending: {target.output_payload['endConversation']}")

tok = AutoTokenizer.from_pretrained(MERGE_DIR)
model = AutoModelForCausalLM.from_pretrained(MERGE_DIR, torch_dtype=torch.bfloat16, device_map="cuda")
model.eval()

prompt_text = render_chat_text(
    tok,
    build_prompt_messages(target),
    add_generation_prompt=True,
    tools=tools_for_example(target),
).removeprefix("<bos>")

print(f"\n--- Rendered prompt (last 600 chars) ---")
print(prompt_text[-600:])

inputs = tok(prompt_text, return_tensors="pt", add_special_tokens=False).to(model.device)
with torch.inference_mode():
    out = model.generate(**inputs, max_new_tokens=200, do_sample=False, temperature=None, top_p=None)
new_tokens = out[0, inputs.input_ids.shape[1]:]
print(f"\n=== RAW OUTPUT ===\n{tok.decode(new_tokens, skip_special_tokens=False)}\n")

ids = new_tokens.tolist()
hits = [t for t in ids if t in (48, 49)]
print(f"=== VERDICT ===")
if hits:
    print(f"PASS — tool token IDs present: {hits[:5]}. Theory confirmed: prompt's task block was the blocker.")
else:
    print(f"FAIL — still no tool tokens. Theory wrong; something else.")
