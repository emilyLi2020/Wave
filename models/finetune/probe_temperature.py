"""Verify hypothesis: v3 LoRA suppresses but does not delete tool-call ability.

Generates N samples at temperature > 0 from the same prompt. Counts how many
contain <|tool_call> (id 48). Also dumps top-30 next-token probabilities at
the model-turn boundary, including P(<|tool_call>), so we can see how far
below argmax it sits.
"""
import json
import sys

sys.path.insert(0, "/home/ubuntu/wave/models/finetune")
sys.path.insert(0, "/home/ubuntu/wave/models")

import torch
from transformers import AutoModelForCausalLM, AutoProcessor

MERGE_DIR = "/home/ubuntu/wave/models/runs/merge-toolcall-v3"

# Same probe as test_tool_calling.py
SYSTEM_PROMPT = (
    "You are a WAVE clinical check-in agent running between meditation chunks. "
    "Reflect, ask one concrete question at a time, and keep replies to 1-3 "
    "short sentences. When the patient has clearly signalled readiness to "
    "continue, call the endConversation tool — and pair it with a warm 1-2 "
    "sentence closing hand-off in the same response."
)
HISTORY = [
    {"role": "user", "content": "About a 6."},
    {"role": "assistant", "content": "Six is a little lower than where you started. Where did you notice the urge most during the last chunk?"},
    {"role": "user", "content": "Mostly in my chest."},
    {"role": "assistant", "content": "Chest is useful information. Try noticing the edges of that pressure for one breath, without pushing it away. What changes?"},
    {"role": "user", "content": "It softened a little."},
    {"role": "assistant", "content": "Softening a little is worth noticing — you stayed with the urge. Ready to continue with the sound anchor?"},
    {"role": "user", "content": "Yes, ready."},
]
END_CONVERSATION_TOOL = {
    "type": "function",
    "function": {
        "name": "endConversation",
        "description": "End the WAVE check-in.",
        "parameters": {
            "type": "object",
            "required": ["cravingScore", "obstacleCategory"],
            "properties": {
                "cravingScore": {"type": "integer", "minimum": 1, "maximum": 10},
                "obstacleCategory": {"type": "string", "enum": [
                    "none", "cannot_visualize", "mind_wandering", "urge_overwhelming",
                    "breath_tight", "breath_anxiety", "gave_in", "guilt_failure",
                    "physical_discomfort", "sleepiness",
                ]},
            },
        },
    },
}

processor = AutoProcessor.from_pretrained(MERGE_DIR)
tok = processor.tokenizer
model = AutoModelForCausalLM.from_pretrained(MERGE_DIR, torch_dtype=torch.bfloat16, device_map="cuda")
model.eval()

messages = [{"role": "system", "content": SYSTEM_PROMPT}, *HISTORY]
prompt_text = processor.apply_chat_template(
    messages, tools=[END_CONVERSATION_TOOL], add_generation_prompt=True, tokenize=False,
)
inputs = tok(prompt_text, return_tensors="pt").to(model.device)

# === Part A: dump next-token distribution at the model-turn boundary ===
with torch.inference_mode():
    out = model(**inputs)
logits = out.logits[0, -1].float()
probs = torch.softmax(logits, dim=-1)
top = torch.topk(probs, 30)
print("=== Top-30 next-token probabilities (greedy argmax view) ===")
for rank, (p, tid) in enumerate(zip(top.values.tolist(), top.indices.tolist())):
    tok_repr = tok.decode([tid], skip_special_tokens=False)
    flag = "  <-- TOOL CALL TOKEN" if tid in (48, 49) else ""
    print(f"  {rank+1:>3}. id={tid:>6} p={p:.6f}  tok={json.dumps(tok_repr)}{flag}")
print()
print(f"P(<|tool_call> id=48)      = {probs[48].item():.6f}")
print(f"P(<tool_call|> id=49)      = {probs[49].item():.6f}")
print(f"Argmax: id={int(torch.argmax(logits))} tok={json.dumps(tok.decode([int(torch.argmax(logits))], skip_special_tokens=False))}")
print()

# === Part B: sample N completions at temperature > 0, count tool-token hits ===
N = 20
TEMP = 0.8
TOP_P = 0.95
print(f"=== Sampling {N} completions at temperature={TEMP}, top_p={TOP_P} ===")
tool_hits = 0
samples = []
for i in range(N):
    torch.manual_seed(1000 + i)
    with torch.inference_mode():
        out = model.generate(
            **inputs,
            max_new_tokens=60,
            do_sample=True,
            temperature=TEMP,
            top_p=TOP_P,
        )
    new_tokens = out[0, inputs.input_ids.shape[1]:].tolist()
    has_tool = 48 in new_tokens or 49 in new_tokens
    if has_tool:
        tool_hits += 1
    first_8 = [tok.decode([t], skip_special_tokens=False) for t in new_tokens[:8]]
    flag = "  <-- TOOL CALL" if has_tool else ""
    print(f"  sample {i+1:2d}/20: first_8={first_8}{flag}")
    samples.append((has_tool, new_tokens))

print()
print(f"=== VERDICT ===")
print(f"Tool-call hits: {tool_hits}/{N} = {100*tool_hits/N:.0f}%")
if tool_hits > 0:
    print("PASS-PARTIAL: capability is SUPPRESSED, not deleted. Greedy decoding misses it.")
else:
    print("FAIL: capability is genuinely suppressed below noise floor at this temperature.")
