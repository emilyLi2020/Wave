"""Dump full text of N distinct intermediate check_in rows from v6 dataset.

Shows system prompt, user prompt (with task block + dialogue), and assistant
target for each row. No truncation.

Run on the box:
  cd /workspace/wave/models
  uv run python finetune/inspect_v6_intermediate.py \
      --dataset datasets/lora-wave-session-toolcall-v6.jsonl \
      --n 4
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
                    "type": "integer", "minimum": 1, "maximum": 10,
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--n", type=int, default=4)
    parser.add_argument("--source-repo", default="unsloth/gemma-4-E2B-it")
    args = parser.parse_args()

    rows: list[dict] = []
    with args.dataset.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            rows.append(json.loads(line))

    intermediates: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        if row["input"]["surface"] != "check_in":
            continue
        if row["output"].get("endConversation") is not None:
            continue
        rid = str(row.get("id"))
        if rid in seen:
            continue
        seen.add(rid)
        intermediates.append(row)
        if len(intermediates) >= args.n:
            break

    print(f"Found {len(intermediates)} distinct intermediate check_in rows.\n")

    from transformers import AutoProcessor
    processor = AutoProcessor.from_pretrained(args.source_repo)

    for idx, row in enumerate(intermediates):
        msgs = row["messages"]
        print("\n" + "#" * 80)
        print(f"### ROW {idx}   id={row.get('id')!r}")
        print("#" * 80)
        print(f"\noutput payload: {json.dumps(row['output'], ensure_ascii=False)}")
        print(f"message roles: {[m['role'] for m in msgs]}")

        print(f"\n>>> SYSTEM ({len(msgs[0]['content'])} chars):")
        print(msgs[0]["content"])

        print(f"\n>>> USER ({len(msgs[1]['content'])} chars):")
        print(msgs[1]["content"])

        print(f"\n>>> ASSISTANT (training target, {len(msgs[2]['content'])} chars):")
        print(msgs[2]["content"])

        # Render with tools= (production inference passes tools for every
        # check_in turn so the model can decide whether to call). The
        # trainer should match — flag for review.
        rendered_with_tools = processor.apply_chat_template(
            msgs, tools=[END_CONVERSATION_TOOL],
            add_generation_prompt=False, tokenize=False,
        )
        rendered_no_tools = processor.apply_chat_template(
            msgs, add_generation_prompt=False, tokenize=False,
        )

        print(f"\n>>> RENDERED WITH tools= ({len(rendered_with_tools)} chars):")
        print(rendered_with_tools)
        print(f"\n>>> RENDERED WITHOUT tools= ({len(rendered_no_tools)} chars):")
        print(rendered_no_tools)


if __name__ == "__main__":
    main()
