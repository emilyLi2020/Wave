"""v4 dataset transform: multi-turn tool protocol + task block rewrite + class rebalance.

Per the v4 handoff plan in https://github.com/emilyLi2020/Wave/issues/10, this
script replaces v1-v3's raw-string approach with the structured multi-turn
shape that base Gemma 4 was pretrained on.

Per-surface rules:

* phase_narration, reflection: pass through byte-for-byte. The current
  production LoRA already handles them well; we must not regress.

* check_in INTERMEDIATE turns (output.endConversation is null):
    - User's <task>...</task> block rewritten to drop "Return strict JSON".
    - Assistant content becomes plain text (the existing output.reply).
    - Still a 3-message conversation.

* check_in ENDING turns (output.endConversation is an object):
    - User's <task>...</task> block rewritten (same as intermediate).
    - Single assistant message split into THREE messages:
        1. {role: assistant, tool_calls: [endConversation(cravingScore, obstacleCategory)]}
        2. {role: tool,      content: '{"status":"acknowledged"}'}  (synthetic ack)
        3. {role: assistant, content: <closing reply>}
    - Duplicate the row 3x to upweight the minority class (5.6% -> 14.4%).

Output shape verified against the base Gemma 4 chat template in
verify_multiturn_tool.py: renders as a single model turn ending in <turn|>.

Run from `models/`:
  uv run python finetune/transform_to_native_tools_v4.py
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


DEFAULT_INPUT = Path("datasets/lora-wave-session-expanded.jsonl")
DEFAULT_OUTPUT = Path("datasets/lora-wave-session-toolcall-v4.jsonl")

ENDING_UPWEIGHT = 3  # duplicate each ending check_in row this many times

# The replacement task block. Drops the "Return strict JSON" instruction that
# was the dominant shortcut token in v3.
NEW_TASK_BLOCK = """<task>
Write the agent's next turn only. Keep it to 1-3 short sentences in patient-facing voice. When the patient has clearly signalled readiness to continue to the next part of the practice, call the endConversation tool with their current cravingScore (integer 1-10) and obstacleCategory (one of the allowed enum values), and pair the call with a warm 1-2 sentence closing hand-off in the same response. Otherwise just reply.
</task>"""

TASK_BLOCK_RE = re.compile(r"<task>.*?</task>", re.DOTALL)


def rewrite_task_block(user_content: str, row_id: str) -> str:
    new_content, n = TASK_BLOCK_RE.subn(NEW_TASK_BLOCK, user_content, count=1)
    if n != 1:
        raise ValueError(f"row {row_id}: expected exactly one <task> block, found {n}")
    return new_content


def transform_intermediate_check_in(row: dict[str, Any]) -> dict[str, Any]:
    """Intermediate (no tool call) check_in: rewrite task, unwrap reply."""
    output = row["output"]
    reply = output["reply"]
    messages = row["messages"]
    assert len(messages) == 3, f"row {row.get('id')}: intermediate check_in must have 3 messages"
    new_user = rewrite_task_block(messages[1]["content"], str(row.get("id")))
    new_messages = [
        messages[0],  # system unchanged
        {**messages[1], "content": new_user},  # user with rewritten task
        {"role": "assistant", "content": reply},  # plain text, no JSON wrapper
    ]
    return {**row, "messages": new_messages}


def transform_ending_check_in(row: dict[str, Any]) -> dict[str, Any]:
    """Ending (tool call required) check_in: rewrite task, split into multi-turn."""
    output = row["output"]
    reply = output["reply"]
    end_conv = output["endConversation"]
    craving_score = end_conv["cravingScore"]
    obstacle_category = end_conv["obstacleCategory"]
    assert isinstance(craving_score, int), (
        f"row {row.get('id')}: cravingScore is not int: {craving_score!r}"
    )
    assert isinstance(obstacle_category, str), (
        f"row {row.get('id')}: obstacleCategory is not str: {obstacle_category!r}"
    )

    messages = row["messages"]
    assert len(messages) == 3, f"row {row.get('id')}: ending check_in must have 3 messages in source"
    new_user = rewrite_task_block(messages[1]["content"], str(row.get("id")))

    new_messages = [
        messages[0],  # system unchanged
        {**messages[1], "content": new_user},  # user with rewritten task
        {
            "role": "assistant",
            "tool_calls": [{
                "type": "function",
                "function": {
                    "name": "endConversation",
                    "arguments": {
                        "cravingScore": craving_score,
                        "obstacleCategory": obstacle_category,
                    },
                },
            }],
        },
        {"role": "tool", "content": '{"status":"acknowledged"}'},
        {"role": "assistant", "content": reply},
    ]
    return {**row, "messages": new_messages}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--ending-upweight", type=int, default=ENDING_UPWEIGHT,
        help="Duplicate each ending check_in row this many times.",
    )
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Input not found: {args.input.resolve()}")

    surface_counts: Counter[str] = Counter()
    check_in_endings_unique = 0
    check_in_intermediate = 0
    transformed_rows: list[dict[str, Any]] = []

    with args.input.open("r", encoding="utf-8") as src:
        for line_no, line in enumerate(src, start=1):
            line = line.rstrip("\n")
            if not line:
                continue
            row = json.loads(line)
            surface = row["input"]["surface"]
            surface_counts[surface] += 1

            if surface != "check_in":
                # Phase narration / reflection: pass through byte-for-byte.
                transformed_rows.append(row)
                continue

            end_conv = row["output"].get("endConversation")
            if end_conv is None:
                transformed_rows.append(transform_intermediate_check_in(row))
                check_in_intermediate += 1
            else:
                ending_row = transform_ending_check_in(row)
                check_in_endings_unique += 1
                # Duplicate to upweight the minority class.
                for _ in range(args.ending_upweight):
                    transformed_rows.append(ending_row)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as dst:
        for row in transformed_rows:
            dst.write(json.dumps(row, ensure_ascii=False) + "\n")

    expected_total = (
        surface_counts["phase_narration"]
        + surface_counts["reflection"]
        + check_in_intermediate
        + check_in_endings_unique * args.ending_upweight
    )
    positive_class_pct = (
        100.0 * check_in_endings_unique * args.ending_upweight / expected_total
        if expected_total else 0.0
    )

    print("=== transform_to_native_tools_v4.py summary ===")
    print(f"input  : {args.input.resolve()}")
    print(f"output : {args.output.resolve()}")
    print(f"source rows : {sum(surface_counts.values())}")
    for surface in ("check_in", "phase_narration", "reflection"):
        print(f"  {surface:<16}: {surface_counts[surface]}")
    print(f"check_in ending (unique)   : {check_in_endings_unique}")
    print(f"check_in ending (upweight) : {check_in_endings_unique * args.ending_upweight} "
          f"(×{args.ending_upweight})")
    print(f"check_in intermediate      : {check_in_intermediate}")
    print(f"output rows written        : {len(transformed_rows)}")
    print(f"expected                   : {expected_total}")
    print(f"positive class (ending check_in / total): {positive_class_pct:.1f}%")

    # ---- Acceptance checks --------------------------------------------------
    failures: list[str] = []

    if len(transformed_rows) != expected_total:
        failures.append(
            f"row count {len(transformed_rows)} != expected {expected_total}"
        )

    for idx, row in enumerate(transformed_rows):
        rid = f"{row.get('id')}#{idx}"
        surface = row["input"]["surface"]
        msgs = row["messages"]

        if surface != "check_in":
            # Phase / reflection: should be passed through unchanged from source.
            if len(msgs) != 3:
                failures.append(f"row {rid}: passthrough surface={surface} has {len(msgs)} messages, expected 3")
            continue

        # check_in row: user prompt must have new task block, no "Return strict JSON"
        user_content = msgs[1]["content"]
        if "Return strict JSON" in user_content:
            failures.append(f"row {rid}: check_in user still contains 'Return strict JSON' (task rewrite failed)")
        if "<task>\nWrite the agent's next turn only." not in user_content:
            failures.append(f"row {rid}: check_in user missing new task block opening")

        end_conv = row["output"].get("endConversation")
        if end_conv is None:
            # Intermediate: 3 messages, assistant content is the reply
            if len(msgs) != 3:
                failures.append(f"row {rid}: intermediate check_in has {len(msgs)} messages, expected 3")
                continue
            if msgs[2].get("role") != "assistant" or "tool_calls" in msgs[2]:
                failures.append(f"row {rid}: intermediate check_in assistant should not have tool_calls")
            if msgs[2].get("content") != row["output"]["reply"]:
                failures.append(f"row {rid}: intermediate check_in assistant content != output.reply")
        else:
            # Ending: 5 messages, multi-turn structure
            if len(msgs) != 5:
                failures.append(f"row {rid}: ending check_in has {len(msgs)} messages, expected 5")
                continue
            roles = [m.get("role") for m in msgs]
            if roles != ["system", "user", "assistant", "tool", "assistant"]:
                failures.append(f"row {rid}: ending check_in roles {roles} != expected sequence")
                continue
            tc_msg = msgs[2]
            if "tool_calls" not in tc_msg or not isinstance(tc_msg["tool_calls"], list) or len(tc_msg["tool_calls"]) != 1:
                failures.append(f"row {rid}: ending check_in assistant[2] missing/malformed tool_calls")
                continue
            tc = tc_msg["tool_calls"][0]
            fn = tc.get("function", {})
            if fn.get("name") != "endConversation":
                failures.append(f"row {rid}: tool_call name != 'endConversation' (got {fn.get('name')!r})")
            args_dict = fn.get("arguments", {})
            if "cravingScore" not in args_dict or "obstacleCategory" not in args_dict:
                failures.append(f"row {rid}: tool_call arguments missing required keys (got {list(args_dict.keys())})")
            if not isinstance(args_dict.get("cravingScore"), int):
                failures.append(f"row {rid}: tool_call cravingScore not int")
            if msgs[3].get("role") != "tool" or "acknowledged" not in (msgs[3].get("content") or ""):
                failures.append(f"row {rid}: synthetic tool ack message malformed")
            if msgs[4].get("content") != row["output"]["reply"]:
                failures.append(f"row {rid}: ending check_in closing speech != output.reply")

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
