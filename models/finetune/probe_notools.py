"""Probe v2 LoRA WITHOUT tools= rendering, since training didn't use it."""
import json
import sys

import torch
from transformers import AutoModelForCausalLM, AutoProcessor

SOURCE = "/home/ubuntu/wave/models/runs/merge-toolcall-v2"

READY_HISTORY = [
    {"role": "user", "content": "About a 6."},
    {"role": "assistant", "content": "Six is a little lower than where you started. Where did you notice the urge most during the last chunk?"},
    {"role": "user", "content": "Mostly in my chest."},
    {"role": "assistant", "content": "Chest is useful information. Try noticing the edges of that pressure for one breath, without pushing it away. What changes?"},
    {"role": "user", "content": "It softened a little."},
    {"role": "assistant", "content": "Softening a little is worth noticing — you stayed with the urge. Ready to continue with the sound anchor?"},
    {"role": "user", "content": "Yes, ready."},
]

SYSTEM_PROMPT = (
    "You are a WAVE clinical check-in agent running between meditation chunks. "
    "Reflect, ask one concrete question at a time, and keep replies to 1-3 "
    "short sentences. When the patient has clearly signalled readiness to "
    "continue, call the endConversation tool — and pair it with a warm 1-2 "
    "sentence closing hand-off in the same response."
)

processor = AutoProcessor.from_pretrained(SOURCE)
tokenizer = processor.tokenizer
model = AutoModelForCausalLM.from_pretrained(SOURCE, torch_dtype=torch.bfloat16, device_map="cuda")
model.eval()

messages = [{"role": "system", "content": SYSTEM_PROMPT}, *READY_HISTORY]

# NO tools= — match the training distribution exactly.
prompt_text = processor.apply_chat_template(
    messages, add_generation_prompt=True, tokenize=False
)
print("=== Rendered prompt (last 500 chars, no tools=) ===")
print(prompt_text[-500:])
print("=== end prompt ===\n")

inputs = tokenizer(prompt_text, return_tensors="pt").to(model.device)
with torch.inference_mode():
    outputs = model.generate(
        **inputs, max_new_tokens=200, do_sample=False, temperature=None, top_p=None,
    )
new_tokens = outputs[0, inputs.input_ids.shape[1]:]
raw = tokenizer.decode(new_tokens, skip_special_tokens=False)
print("=== RAW OUTPUT (special tokens preserved) ===")
print(raw)
print()
print("=== TOKEN BY TOKEN (first 30) ===")
pieces = [tokenizer.decode([tid], skip_special_tokens=False) for tid in new_tokens.tolist()[:30]]
for i, p in enumerate(pieces):
    print(f"  {i:3d}: {json.dumps(p)}")
print()
print("=== VERDICT ===")
tool_ids = {48, 49}
hits = [int(t) for t in new_tokens.tolist() if int(t) in tool_ids]
if hits:
    print(f"PASS — tool token IDs found: {hits[:5]}")
else:
    print("FAIL — no tool token IDs in output.")
