"""v5 dataset transform: v4 + system prompt rewrite for check_in rows.

v4 failure mode (diagnosed post-training): base Gemma 4 emits
`{"reply":"...","endConversation":{...}}` JSON because the system prompt
explicitly instructs *"Return only strict JSON matching the output schema
requested in the user prompt"*. The task block mentions `endConversation`,
`cravingScore`, `obstacleCategory` (as tool params) and contains the verb
`reply` ("Otherwise just reply."). The base model assembles these hints into
the v3-schema JSON, and the LoRA's plain-text/tool-call training targets
cannot overpower 1428 steps of the system prompt's contradicting instruction.

v5 fixes the prompt conflict:

* For `check_in` rows: REWRITE the system prompt to drop the JSON instruction
  and add a tool-call instruction. Drop the verb "reply" from the task block
  (replace with "respond") so the model doesn't seed a `reply` JSON key.

* For `phase_narration` and `reflection` rows: leave the system prompt
  unchanged (they DO need JSON output — that's how the current production
  LoRA works).

Everything else from v4 carries forward: multi-turn tool protocol for ending
check_ins, 3× upweight, pass-through for phase/reflection.

Run from `models/`:
  uv run python finetune/transform_to_native_tools_v5.py
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


DEFAULT_INPUT = Path("datasets/lora-wave-session-expanded.jsonl")
DEFAULT_OUTPUT = Path("datasets/lora-wave-session-toolcall-v5.jsonl")

ENDING_UPWEIGHT = 3  # duplicate each ending check_in row this many times


# v5 system prompt for check_in rows — drops "Return only strict JSON ..." and
# replaces with a tool-call instruction. JSON instructions removed so the base
# model doesn't seed itself into JSON output for this surface.
NEW_CHECK_IN_SYSTEM = """You are WAVE, an on-device urge surfing companion for people in Substance Use Disorder recovery.

Write patient-facing support for a structured urge surfing session.
The tone is trauma-informed, calm, concrete, nonjudgmental, and unhurried.
Do not prescribe medication. Do not tell the patient to start, stop, change, increase, decrease, double, or skip a dose.
Do not provide crisis routing. Safety routing is handled by code outside the model.
Respond in plain conversational language. When the patient has clearly signalled readiness to continue to the next part of the practice, call the endConversation tool. Do not output JSON."""


# v5 task block — same as v4 but replaces "reply" verb with "respond" so the
# base model doesn't infer a JSON `reply` key from the task instruction.
NEW_TASK_BLOCK = """<task>
Write the agent's next turn only. Keep it to 1-3 short sentences in patient-facing voice. When the patient has clearly signalled readiness to continue to the next part of the practice, call the endConversation tool with their current cravingScore (integer 1-10) and obstacleCategory (one of the allowed enum values), and pair the call with a warm 1-2 sentence closing hand-off in the same response. Otherwise just respond.
</task>"""

TASK_BLOCK_RE = re.compile(r"<task>.*?</task>", re.DOTALL)


def rewrite_task_block(user_content: str, row_id: str) -> str:
    new_content, n = TASK_BLOCK_RE.subn(NEW_TASK_BLOCK, user_content, count=1)
    if n != 1:
        raise ValueError(f"row {row_id}: expected exactly one <task> block, found {n}")
    return new_content


def rewrite_system_prompt(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replace the system message's content with NEW_CHECK_IN_SYSTEM."""
    if not messages or messages[0].get("role") != "system":
        raise ValueError("first message must be system")
    return [{**messages[0], "content": NEW_CHECK_IN_SYSTEM}] + list(messages[1:])


def transform_intermediate_check_in(row: dict[str, Any]) -> dict[str, Any]:
    """Intermediate check_in: rewrite system + task, unwrap reply."""
    output = row["output"]
    reply = output["reply"]
    messages = row["messages"]
    assert len(messages) == 3, f"row {row.get('id')}: intermediate check_in must have 3 messages"
    messages = rewrite_system_prompt(messages)
    new_user = rewrite_task_block(messages[1]["content"], str(row.get("id")))
    new_messages = [
        messages[0],  # rewritten system
        {**messages[1], "content": new_user},  # user with rewritten task
        {"role": "assistant", "content": reply},
    ]
    return {**row, "messages": new_messages}


def transform_ending_check_in(row: dict[str, Any]) -> dict[str, Any]:
    """Ending check_in: rewrite system + task, split into multi-turn."""
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
    messages = rewrite_system_prompt(messages)
    new_user = rewrite_task_block(messages[1]["content"], str(row.get("id")))

    new_messages = [
        messages[0],  # rewritten system
        {**messages[1], "content": new_user},
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
                # Phase / reflection: passthrough unchanged (their system
                # prompt's JSON instruction is correct for those surfaces).
                transformed_rows.append(row)
                continue

            end_conv = row["output"].get("endConversation")
            if end_conv is None:
                transformed_rows.append(transform_intermediate_check_in(row))
                check_in_intermediate += 1
            else:
                ending_row = transform_ending_check_in(row)
                check_in_endings_unique += 1
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

    print("=== transform_to_native_tools_v5.py summary ===")
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
            # Phase / reflection: pass-through; system prompt should still
            # contain the JSON instruction.
            sys_content = msgs[0].get("content", "")
            if "Return only strict JSON" not in sys_content:
                failures.append(f"row {rid}: passthrough surface={surface} missing JSON instruction in system")
            continue

        # check_in: system prompt MUST be rewritten (no "Return strict JSON")
        sys_content = msgs[0].get("content", "")
        if "Return only strict JSON" in sys_content:
            failures.append(f"row {rid}: check_in system still contains 'Return only strict JSON'")
        if "endConversation tool" not in sys_content:
            failures.append(f"row {rid}: check_in system missing tool-call instruction")
        if "Do not output JSON" not in sys_content:
            failures.append(f"row {rid}: check_in system missing 'Do not output JSON' negative constraint")

        # task block must be rewritten
        user_content = msgs[1]["content"]
        if "Return strict JSON" in user_content:
            failures.append(f"row {rid}: check_in user contains 'Return strict JSON'")
        if "Otherwise just respond." not in user_content:
            failures.append(f"row {rid}: check_in user missing 'Otherwise just respond.' (still has 'reply'?)")
        if "Otherwise just reply" in user_content:
            failures.append(f"row {rid}: check_in user still contains 'Otherwise just reply' (verb hint)")

        end_conv = row["output"].get("endConversation")
        if end_conv is None:
            if len(msgs) != 3:
                failures.append(f"row {rid}: intermediate has {len(msgs)} messages, expected 3")
                continue
            if msgs[2].get("role") != "assistant" or "tool_calls" in msgs[2]:
                failures.append(f"row {rid}: intermediate assistant should not have tool_calls")
            if msgs[2].get("content") != row["output"]["reply"]:
                failures.append(f"row {rid}: intermediate assistant content != output.reply")
        else:
            if len(msgs) != 5:
                failures.append(f"row {rid}: ending has {len(msgs)} messages, expected 5")
                continue
            roles = [m.get("role") for m in msgs]
            if roles != ["system", "user", "assistant", "tool", "assistant"]:
                failures.append(f"row {rid}: ending roles {roles} != expected")
                continue
            tc = msgs[2]["tool_calls"][0]
            fn = tc.get("function", {})
            if fn.get("name") != "endConversation":
                failures.append(f"row {rid}: tool_call name != 'endConversation'")
            args_dict = fn.get("arguments", {})
            if "cravingScore" not in args_dict or "obstacleCategory" not in args_dict:
                failures.append(f"row {rid}: tool_call args missing required keys")
            if not isinstance(args_dict.get("cravingScore"), int):
                failures.append(f"row {rid}: cravingScore not int")
            if msgs[3].get("role") != "tool" or "acknowledged" not in (msgs[3].get("content") or ""):
                failures.append(f"row {rid}: synthetic tool ack malformed")
            if msgs[4].get("content") != row["output"]["reply"]:
                failures.append(f"row {rid}: closing speech != output.reply")

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
