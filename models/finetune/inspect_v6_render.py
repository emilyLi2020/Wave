"""Render a few v6 training rows via apply_chat_template so we can eyeball
exactly what the trainer will see — especially the assistant target shape.

For each row type (ending check_in, intermediate check_in, phase_narration,
reflection) prints:
  * row id
  * source output payload
  * the assistant content stored in messages[-1]
  * the FULL rendered conversation (tools= passed for check_in)

Run on the box (needs transformers + tokenizer):
  cd /workspace/wave/models
  uv run python finetune/inspect_v6_render.py \
      --dataset datasets/lora-wave-session-toolcall-v6.jsonl
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


END_CONVERSATION_TOOL = {
    "type": "function",
    "function": {
        "name": "endConversation",
        "description": (
            "End the WAVE check-in after the patient is ready to continue."
        ),
        "parameters": {
            "type": "object",
            "required": ["cravingScore", "obstacleCategory"],
            "properties": {
                "cravingScore": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10,
                    "description": "Patient's current craving score 1-10.",
                },
                "obstacleCategory": {
                    "type": "string",
                    "enum": [
                        "none", "cannot_visualize", "mind_wandering",
                        "urge_overwhelming", "breath_tight", "breath_anxiety",
                        "gave_in", "guilt_failure", "physical_discomfort",
                        "sleepiness",
                    ],
                },
            },
        },
    },
}


def find_sample(rows: list[dict], surface: str, want_ending: bool | None = None) -> dict | None:
    seen: set[str] = set()
    for row in rows:
        if row["input"]["surface"] != surface:
            continue
        if surface == "check_in" and want_ending is not None:
            has_end = bool(row["output"].get("endConversation"))
            if has_end != want_ending:
                continue
        rid = str(row.get("id"))
        if rid in seen:
            continue
        seen.add(rid)
        return row
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--source-repo", default="unsloth/gemma-4-E2B-it")
    args = parser.parse_args()

    rows: list[dict] = []
    with args.dataset.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            rows.append(json.loads(line))
    print(f"Loaded {len(rows)} rows from {args.dataset}")

    from transformers import AutoProcessor
    processor = AutoProcessor.from_pretrained(args.source_repo)
    tokenizer = processor.tokenizer

    samples = [
        ("ending check_in", find_sample(rows, "check_in", want_ending=True), True),
        ("intermediate check_in", find_sample(rows, "check_in", want_ending=False), False),
        ("phase_narration", find_sample(rows, "phase_narration"), False),
        ("reflection", find_sample(rows, "reflection"), False),
    ]

    for label, row, use_tools in samples:
        print("\n" + "=" * 78)
        print(f"  {label.upper()}")
        print("=" * 78)
        if row is None:
            print("  (no row found)")
            continue
        print(f"id: {row.get('id')!r}")
        print(f"output payload: {json.dumps(row['output'], ensure_ascii=False)[:200]}")
        print(f"\nmessage roles: {[m['role'] for m in row['messages']]}")
        assistant_msg = row["messages"][-1]
        print(f"\n--- assistant content (the training target) ---")
        print(assistant_msg.get("content", "<no content>"))
        print(f"--- end assistant content ---")

        kwargs = {"add_generation_prompt": False, "tokenize": False}
        if use_tools:
            kwargs["tools"] = [END_CONVERSATION_TOOL]
        rendered = processor.apply_chat_template(row["messages"], **kwargs)

        print(f"\n--- FULL rendered training example ({len(rendered)} chars) ---")
        print(rendered)
        print(f"--- end rendered ---")

        # Show just the assistant turn region so we can spot the loss target shape.
        # Look for the LAST `<|turn>model\n` marker in the render.
        marker = "<|turn>model"
        last_model_idx = rendered.rfind(marker)
        if last_model_idx >= 0:
            tail = rendered[last_model_idx:]
            print(f"\n--- final model turn region ({len(tail)} chars) ---")
            print(tail)
            print(f"--- end model turn region ---")

        # Tokenize just to confirm no special-token surprises in the assistant
        # content (we want plain text endConversation{...}, NOT <|tool_call>).
        if use_tools and row["output"].get("endConversation"):
            asst_content = assistant_msg["content"]
            ids = tokenizer(asst_content, add_special_tokens=False).input_ids
            print(f"\n--- assistant content tokenized ({len(ids)} tokens) ---")
            for i, tid in enumerate(ids[:40]):
                piece = tokenizer.convert_ids_to_tokens(tid)
                print(f"  {i:>3}  id={tid:>6}  {piece!r}")
            if len(ids) > 40:
                print(f"  ... {len(ids) - 40} more tokens")


if __name__ == "__main__":
    main()
