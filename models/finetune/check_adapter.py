"""Diagnose: did the adapter break the tool-call token embeddings/logits?

Plan:
  A. Check tokenizer integrity (special tokens still mapped to right IDs).
  B. Probe the base model directly (no LoRA) with same prompt — sanity check.
  C. Probe the PEFT model (adapter attached, no merge) — does it differ from
     the merged model? If yes, the merge broke something; if no, the LoRA
     itself broke the capability.
  D. Compare logit for token 48 (<|tool_call>) at the position right after
     <|turn>model\\n between base and merged.
"""
import json
import sys

import torch
from transformers import AutoModelForCausalLM, AutoProcessor

BASE_ID = "unsloth/gemma-4-E2B-it"
MERGE_DIR = "/home/ubuntu/wave/models/runs/merge-toolcall-v2"

SYSTEM = (
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
MESSAGES = [{"role": "system", "content": SYSTEM}, *HISTORY]


def render(processor, with_tools: bool) -> str:
    kwargs = dict(add_generation_prompt=True, tokenize=False)
    if with_tools:
        kwargs["tools"] = [{
            "type": "function",
            "function": {
                "name": "endConversation",
                "description": "End the WAVE check-in.",
                "parameters": {
                    "type": "object",
                    "required": ["cravingScore", "obstacleCategory"],
                    "properties": {
                        "cravingScore": {"type": "integer", "minimum": 1, "maximum": 10},
                        "obstacleCategory": {"type": "string", "enum": ["none", "mind_wandering", "physical_discomfort", "guilt_failure", "breath_tight", "sleepiness", "urge_overwhelming"]},
                    },
                },
            },
        }]
    return processor.apply_chat_template(MESSAGES, **kwargs)


def top_k_at_position(model, tokenizer, prompt_text, k=10):
    inputs = tokenizer(prompt_text, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        out = model(**inputs)
    logits = out.logits[0, -1]  # logits for the next token
    probs = torch.softmax(logits, dim=-1)
    top = torch.topk(probs, k)
    results = []
    for prob, tid in zip(top.values.tolist(), top.indices.tolist()):
        tok = tokenizer.decode([tid], skip_special_tokens=False)
        results.append((tid, repr(tok), round(prob, 4)))
    # Always include the tool_call probability
    tool_call_id = 48
    tc_prob = probs[tool_call_id].item()
    return results, tc_prob


def evaluate(source, label, with_tools):
    print(f"\n=== {label} | tools={'YES' if with_tools else 'NO'} ===")
    processor = AutoProcessor.from_pretrained(source)
    tokenizer = processor.tokenizer
    model = AutoModelForCausalLM.from_pretrained(source, torch_dtype=torch.bfloat16, device_map="cuda")
    model.eval()
    prompt_text = render(processor, with_tools)
    print(f"prompt last 200 chars: {prompt_text[-200:]!r}")
    top, tc_prob = top_k_at_position(model, tokenizer, prompt_text)
    print(f"top-10 next-token candidates:")
    for tid, tok_repr, p in top:
        print(f"  id={tid:>6} prob={p:.4f} tok={tok_repr}")
    print(f"P(<|tool_call> id=48) = {tc_prob:.6f}")
    del model
    torch.cuda.empty_cache()


if __name__ == "__main__":
    evaluate(BASE_ID, "BASE Gemma 4", with_tools=True)
    evaluate(BASE_ID, "BASE Gemma 4", with_tools=False)
    evaluate(MERGE_DIR, "MERGED v2 LoRA", with_tools=True)
    evaluate(MERGE_DIR, "MERGED v2 LoRA", with_tools=False)
