"""Compare the chat templates: base Gemma 4 vs Unsloth's gemma-4 install."""
from transformers import AutoTokenizer

base_tok = AutoTokenizer.from_pretrained("unsloth/gemma-4-E2B-it")
base_tpl = base_tok.chat_template or ""
print(f"BASE template length: {len(base_tpl)} chars")
print(f"BASE contains 'tools': {'tools' in base_tpl}")
print(f"BASE contains 'tool_call': {'tool_call' in base_tpl}")

from unsloth.chat_templates import get_chat_template

unsloth_tok = AutoTokenizer.from_pretrained("unsloth/gemma-4-E2B-it")
unsloth_tok = get_chat_template(unsloth_tok, chat_template="gemma-4")
us_tpl = unsloth_tok.chat_template or ""
print(f"\nUNSLOTH gemma-4 template length: {len(us_tpl)} chars")
print(f"UNSLOTH contains 'tools': {'tools' in us_tpl}")
print(f"UNSLOTH contains 'tool_call': {'tool_call' in us_tpl}")

print("\nUNSLOTH template (first 1500 chars):")
print(us_tpl[:1500])

print("\n\n--- Try rendering with tools= via BASE template ---")
TOOL = {"type": "function", "function": {"name": "endConversation", "description": "End the WAVE check-in.", "parameters": {"type": "object", "required": ["cravingScore", "obstacleCategory"], "properties": {"cravingScore": {"type": "integer"}, "obstacleCategory": {"type": "string"}}}}}
messages = [
    {"role": "system", "content": "Test system prompt"},
    {"role": "user", "content": "Yes, ready."},
]
try:
    base_with_tools = base_tok.apply_chat_template(messages, tools=[TOOL], add_generation_prompt=True, tokenize=False)
    base_no_tools = base_tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
    print(f"BASE with tools= length: {len(base_with_tools)}")
    print(f"BASE without tools length: {len(base_no_tools)}")
    print(f"Diff: {len(base_with_tools) - len(base_no_tools)} chars")
    if len(base_with_tools) > len(base_no_tools):
        print("BASE TEMPLATE RESPECTS tools=! Use this for training.")
    print(f"\nBASE rendered with tools (first 1500 chars):")
    print(base_with_tools[:1500])
except Exception as e:
    print(f"BASE template raised: {e}")
