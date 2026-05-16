from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained("/home/ubuntu/wave/models/runs/merge-toolcall")
samples = [
    "<|tool_call>",
    "<tool_call|>",
    '<|"|>',
    "call:endConversation",
    "<turn|>",
    "<|turn>",
    "<channel|>",
    "<|channel>",
]
for s in samples:
    ids = tok.encode(s, add_special_tokens=False)
    pieces = tok.convert_ids_to_tokens(ids)
    print(f"{s!r:30s} -> ids={ids} pieces={pieces}")

print("---")

# Tokenize an actual ending check-in assistant turn from the training data
asst = '<|tool_call>call:endConversation{cravingScore:7,obstacleCategory:<|"|>mind_wandering<|"|>}<tool_call|>Are you ready?'
ids = tok.encode(asst, add_special_tokens=False)
pieces = tok.convert_ids_to_tokens(ids[:60])
print(f"first 60 of assistant content: {pieces}")

print("---")
print("special tokens map:", tok.special_tokens_map)
print("added tokens:", list(tok.added_tokens_encoder.items())[:20])
