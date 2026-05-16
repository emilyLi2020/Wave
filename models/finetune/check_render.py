"""Verify what the trainer rendered for ending check_in rows.

Loads the dataset, finds an ending check_in row, runs it through the same
chat-template path as the trainer, and checks whether the tool-call special
tokens survived as single-token IDs in the resulting input_ids.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, "E:/Github/Wave/models/finetune")
sys.path.insert(0, "E:/Github/Wave/models")

# Import a few helpers from the trainer module.
from finetune.train_wave_session_lora import (
    Example,
    normalize_prepared_example,
    build_full_messages,
    render_chat_text,
    tools_for_example,
)

# Load tokenizer with the SAME logic the patched trainer uses: preserve the
# base template (which supports tools=) after Unsloth's get_chat_template.
from unsloth.chat_templates import get_chat_template
from transformers import AutoTokenizer

base_id = "unsloth/gemma-4-E2B-it"
tok = AutoTokenizer.from_pretrained(base_id)
base_template = tok.chat_template
tok = get_chat_template(tok, chat_template="gemma-4")
if base_template:
    tok.chat_template = base_template

# Find the first ending check_in row.
ds_path = Path("E:/Github/Wave/models/datasets/lora-wave-session-toolcall-v4.jsonl")
example = None
with ds_path.open("r", encoding="utf-8") as f:
    for line_no, line in enumerate(f, 1):
        raw = json.loads(line)
        if raw["input"]["surface"] != "check_in":
            continue
        if raw["output"].get("endConversation") is None:
            continue
        example = normalize_prepared_example(raw, line_no)
        break

assert example is not None
print(f"Example ID: {example.example_id}")
print(f"messages[-1].content (first 200 chars): {example.messages[-1]['content'][:200]!r}")

full_messages = build_full_messages(example)
assistant_content = full_messages[-1]["content"]
print(f"\nbuild_full_messages -> assistant content (first 200 chars): {assistant_content[:200]!r}")

# Now render via the trainer's chat-template path (now with tools=).
text = render_chat_text(
    tok, full_messages, add_generation_prompt=False, tools=tools_for_example(example),
).removeprefix("<bos>")
print(f"\nTotal rendered chars: {len(text)}")
print(f"\nContains 'endConversation' substring? {'endConversation' in text}")
print(f"Contains 'cravingScore' in prompt context? {text.count('cravingScore')} occurrences")
print(f"Contains 'function' substring? {text.count('function')}")
print(f"Contains '<|tool_call>' substring? {text.count('<|tool_call>')}")

# Also try rendering without tools= for comparison
no_tools_text = render_chat_text(
    tok, full_messages, add_generation_prompt=False, tools=None,
).removeprefix("<bos>")
print(f"\nLength WITH tools=: {len(text)}")
print(f"Length WITHOUT tools=: {len(no_tools_text)}")
print(f"Length difference: {len(text) - len(no_tools_text)} chars")

# Show the diff between with and without — find the first divergent character
import difflib
for i, (a, b) in enumerate(zip(text, no_tools_text)):
    if a != b:
        print(f"\nFirst divergence at char {i}:")
        print(f"  with tools (next 300 chars): {text[i:i+300]!r}")
        print(f"  without tools (next 300 chars): {no_tools_text[i:i+300]!r}")
        break
else:
    print("\nTexts are identical up to common length — tools= did NOT alter the rendering!")

# Find the assistant span via the response marker the trainer uses.
marker = "<|turn>model\n"
idx = text.rfind(marker)
if idx >= 0:
    asst_start = idx + len(marker)
    asst_span = text[asst_start : asst_start + 200]
    print(f"\nRendered assistant span (first 200 chars after '{marker.strip()}'):")
    print(repr(asst_span))

# Tokenize and check whether <|tool_call> is the actual token ID 48.
ids = tok.encode(text, add_special_tokens=False)
# Show tokens around the assistant marker
print(f"\nTotal tokens: {len(ids)}")
# Find index of tok_id corresponding to start of assistant content.
# Locate <|tool_call> (id 48) presence
for special_id, name in [(48, "<|tool_call>"), (49, "<tool_call|>"), (52, '<|"|>')]:
    count = ids.count(special_id)
    print(f"  {name} (id {special_id}): {count} occurrences in this row")

# Show ~25 tokens around the first <|tool_call>
try:
    pos = ids.index(48)
    pieces = tok.convert_ids_to_tokens(ids[max(0, pos - 3) : pos + 25])
    print(f"\nContext around first <|tool_call> token:")
    print(pieces)
except ValueError:
    print("\n<|tool_call> NOT FOUND in rendered+tokenized training row!")
