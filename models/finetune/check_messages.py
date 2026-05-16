"""Compare training data row structure vs probe message structure."""
import json
from pathlib import Path

ds = Path("/home/ubuntu/wave/models/datasets/lora-wave-session-toolcall.jsonl")
ending = None
intermediate = None
with ds.open("r", encoding="utf-8") as f:
    for line in f:
        row = json.loads(line)
        if row["input"]["surface"] != "check_in":
            continue
        if row["output"].get("endConversation") is not None and ending is None:
            ending = row
        elif row["output"].get("endConversation") is None and intermediate is None:
            intermediate = row
        if ending and intermediate:
            break

print("=== Ending check_in row ===")
print(f"messages count: {len(ending['messages'])}")
for i, m in enumerate(ending['messages']):
    role = m['role']
    content = m['content']
    print(f"  [{i}] role={role!r} len={len(content)}")
    print(f"      first 300 chars: {content[:300]!r}")
    print(f"      last 200 chars: {content[-200:]!r}")

print()
print("=== First 6 lines of intermediate check_in user prompt ===")
print(intermediate['messages'][1]['content'][:1500])
