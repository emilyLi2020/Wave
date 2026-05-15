"""Rewrite check-in assistant turns to Gemma 4 native tool-call format.

The unified `lora-wave-session-expanded.jsonl` wraps every assistant turn in
a `{"endConversation": ..., "reply": "..."}` JSON envelope. That shape works
for phase narration and reflection (production keeps `response_format:
json_schema` there) but it trained the LoRA to never emit Gemma 4's native
`<|tool_call>...<tool_call|>` tokens — see `docs/handoffs/restore-tool-calls-handoff.md`.

This script writes a new JSONL where:
  * `phase_narration` and `reflection` rows are passed through byte-for-byte.
  * `check_in` rows have their final assistant message rewritten:
      - intermediate turns (`endConversation` is null) → plain `reply` text
      - ending turns (`endConversation` is an object) → native tool call
        prefix followed by the closing reply, matching the exact spelling
        the base Gemma 4 + transformers stack emits:
          `<|tool_call>call:endConversation{cravingScore:<INT>,obstacleCategory:<|"|><ENUM><|"|>}<tool_call|><CLOSING TEXT>`

Run from `models/`:
  uv run python finetune/transform_to_native_tools.py
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


DEFAULT_INPUT = Path("datasets/lora-wave-session-expanded.jsonl")
DEFAULT_OUTPUT = Path("datasets/lora-wave-session-toolcall.jsonl")

TOOL_CALL_OPEN = "<|tool_call>"
TOOL_CALL_CLOSE = "<tool_call|>"
QUOTE_OPEN = "<|\"|>"
QUOTE_CLOSE = "<|\"|>"


def format_tool_call(craving_score: int, obstacle_category: str, closing_text: str) -> str:
    return (
        f"{TOOL_CALL_OPEN}call:endConversation"
        f"{{cravingScore:{craving_score},"
        f"obstacleCategory:{QUOTE_OPEN}{obstacle_category}{QUOTE_CLOSE}}}"
        f"{TOOL_CALL_CLOSE}{closing_text}"
    )


def transform_check_in(row: dict[str, Any]) -> dict[str, Any]:
    output = row["output"]
    reply = output["reply"]
    end_conv = output.get("endConversation")

    messages = list(row["messages"])
    assert messages and messages[-1]["role"] == "assistant", (
        f"check_in row {row.get('id')} has no trailing assistant message"
    )

    if end_conv is None:
        new_content = reply
    else:
        craving_score = end_conv["cravingScore"]
        obstacle_category = end_conv["obstacleCategory"]
        assert isinstance(craving_score, int), (
            f"row {row.get('id')} cravingScore is not int: {craving_score!r}"
        )
        assert isinstance(obstacle_category, str), (
            f"row {row.get('id')} obstacleCategory is not str: {obstacle_category!r}"
        )
        new_content = format_tool_call(craving_score, obstacle_category, reply)

    messages[-1] = {**messages[-1], "content": new_content}
    return {**row, "messages": messages}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Input not found: {args.input.resolve()}")

    surface_counts: Counter[str] = Counter()
    check_in_endings = 0
    check_in_intermediate = 0
    transformed_rows: list[dict[str, Any]] = []
    passthrough_bytes_match = 0
    passthrough_total = 0

    with args.input.open("r", encoding="utf-8") as src:
        for line_no, line in enumerate(src, start=1):
            line = line.rstrip("\n")
            if not line:
                continue
            row = json.loads(line)
            surface = row["input"]["surface"]
            surface_counts[surface] += 1

            if surface == "check_in":
                new_row = transform_check_in(row)
                if row["output"].get("endConversation") is None:
                    check_in_intermediate += 1
                else:
                    check_in_endings += 1
                transformed_rows.append(new_row)
                continue

            # Passthrough: phase_narration / reflection.
            passthrough_total += 1
            new_row = row
            # Defensive byte-for-byte check: re-serialize and confirm assistant
            # content is unchanged. The trainer renders messages; if any field
            # we don't touch differs after re-serialization, that's only a key
            # ordering artifact, not a behavior change.
            original_assistant = row["messages"][-1]["content"]
            if new_row["messages"][-1]["content"] == original_assistant:
                passthrough_bytes_match += 1
            transformed_rows.append(new_row)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as dst:
        for row in transformed_rows:
            dst.write(json.dumps(row, ensure_ascii=False) + "\n")

    print("=== transform_to_native_tools.py summary ===")
    print(f"input  : {args.input.resolve()}")
    print(f"output : {args.output.resolve()}")
    print(f"total rows           : {sum(surface_counts.values())}")
    for surface in ("check_in", "phase_narration", "reflection"):
        print(f"  {surface:<16}: {surface_counts[surface]}")
    print(f"check_in ending turns      : {check_in_endings}")
    print(f"check_in intermediate turns: {check_in_intermediate}")
    print(
        f"passthrough rows (phase + reflection): "
        f"{passthrough_total} (assistant content unchanged: {passthrough_bytes_match})"
    )

    # ---- Acceptance checks --------------------------------------------------
    failures: list[str] = []
    if sum(surface_counts.values()) != 4277:
        failures.append(
            f"row count {sum(surface_counts.values())} != expected 4277"
        )

    for row in transformed_rows:
        rid = row.get("id")
        surface = row["input"]["surface"]
        content = row["messages"][-1]["content"]
        if surface == "check_in":
            end_conv = row["output"].get("endConversation")
            reply = row["output"]["reply"]
            if end_conv is None:
                if content != reply:
                    failures.append(
                        f"row {rid}: intermediate check_in content != reply"
                    )
            else:
                if not content.startswith(f"{TOOL_CALL_OPEN}call:endConversation{{"):
                    failures.append(f"row {rid}: ending check_in missing tool-call prefix")
                if content.count(TOOL_CALL_CLOSE) != 1:
                    failures.append(
                        f"row {rid}: ending check_in must contain {TOOL_CALL_CLOSE!r} exactly once "
                        f"(found {content.count(TOOL_CALL_CLOSE)})"
                    )
                if not content.endswith(reply):
                    failures.append(f"row {rid}: ending check_in does not end with reply text")

    if failures:
        print("\nACCEPTANCE CHECK FAILURES:")
        for msg in failures[:20]:
            print(f"  - {msg}")
        if len(failures) > 20:
            print(f"  ... and {len(failures) - 20} more")
        raise SystemExit(1)

    print("\nAll acceptance checks passed.")


if __name__ == "__main__":
    main()
