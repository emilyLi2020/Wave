"""Print the full user prompt of an ending check_in row to see the <task> instruction."""
import json
from pathlib import Path

ds = Path("/home/ubuntu/wave/models/datasets/lora-wave-session-toolcall.jsonl")
with ds.open("r", encoding="utf-8") as f:
    for line in f:
        row = json.loads(line)
        if row["input"]["surface"] != "check_in":
            continue
        if row["output"].get("endConversation") is None:
            continue
        user_content = row["messages"][1]["content"]
        # Find every <task>...</task> block
        print("=== Full user prompt (first 2500 chars) ===")
        print(user_content[:2500])
        print("\n=== Last 1500 chars ===")
        print(user_content[-1500:])
        break
