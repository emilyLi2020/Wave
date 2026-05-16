"""v6 dataset transform: match base Gemma 4's natural emission shape.

Diagnosed via finetune/probe_base_gemma_native.py: base Gemma 4 + v5
prompt + tools= emits the tool call as LITERAL TEXT, NOT special tokens:

  endConversation{cravingScore:N,obstacleCategory:CAT}
  <closing speech>
  <turn|>

Zero `<|tool_call>` (id 48), `<tool_call|>` (49), `<|tool_response>` (50),
`<tool_response|>` (51), or `<|"|>` (52) tokens are emitted. The chat
template injects the tool declaration into the *prompt*, but the model
responds with plain text wrapped in a single assistant turn.

v4/v5 trained against the wrong shape:
  [system, user, asst(tool_calls=...), tool(synthetic ack), asst(reply)]
which renders as one model turn containing self-emitted `<|tool_response>`
that the runtime would never produce. The model learned to either skip
the tool call entirely (just emit closing speech) or hallucinate a tool
response mid-turn.

v6 matches base shape byte-for-byte. Ending check_in becomes a 3-message
conversation with a SINGLE plain-text assistant turn:

  [
    {role: system,    content: <v5 rewritten system>},
    {role: user,      content: <v5 rewritten user>},
    {role: assistant, content: "endConversation{cravingScore:N,obstacleCategory:CAT}\\n<closing speech>"},
  ]

Production parsing: regex the first line of the assistant output
  ^endConversation\\{cravingScore:(\\d+),obstacleCategory:(\\w+)\\}$
strip it, render the remainder as patient-facing text.

Other surfaces:
* Intermediate check_in: identical to v5 (plain-text reply, no JSON wrapper).
* phase_narration / reflection: pass through unchanged (they want JSON).

Run from `models/`:
  uv run python finetune/transform_to_native_tools_v6.py
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


DEFAULT_INPUT = Path("datasets/lora-wave-session-expanded.jsonl")
DEFAULT_OUTPUT = Path("datasets/lora-wave-session-toolcall-v6.jsonl")

ENDING_UPWEIGHT = 3  # duplicate each ending check_in row ×3

NEW_CHECK_IN_SYSTEM = """You are WAVE, an on-device urge surfing companion for people in Substance Use Disorder recovery.

Write patient-facing support for a structured urge surfing session.
The tone is trauma-informed, calm, concrete, nonjudgmental, and unhurried.
Do not prescribe medication. Do not tell the patient to start, stop, change, increase, decrease, double, or skip a dose.
Do not provide crisis routing. Safety routing is handled by code outside the model.
Respond in plain conversational language. When the patient has clearly signalled readiness to continue to the next part of the practice, call the endConversation tool. Do not output JSON."""

NEW_TASK_BLOCK = """<task>
Write the agent's next turn only. Keep it to 1-3 short sentences in patient-facing voice. When the patient has clearly signalled readiness to continue to the next part of the practice, call the endConversation tool with their current cravingScore (integer 1-10) and obstacleCategory (one of the allowed enum values), and pair the call with a warm 1-2 sentence closing hand-off in the same response. Otherwise just respond.
</task>"""

TASK_BLOCK_RE = re.compile(r"<task>.*?</task>", re.DOTALL)

TOOL_CALL_LINE_RE = re.compile(
    r"^endConversation\{cravingScore:(?P<score>\d+),obstacleCategory:(?P<cat>[a-z_]+)\}$"
)


def rewrite_task_block(user_content: str, row_id: str) -> str:
    new_content, n = TASK_BLOCK_RE.subn(NEW_TASK_BLOCK, user_content, count=1)
    if n != 1:
        raise ValueError(f"row {row_id}: expected exactly one <task> block, found {n}")
    return new_content


def rewrite_system_prompt(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not messages or messages[0].get("role") != "system":
        raise ValueError("first message must be system")
    return [{**messages[0], "content": NEW_CHECK_IN_SYSTEM}] + list(messages[1:])


def format_tool_call_line(craving_score: int, obstacle_category: str) -> str:
    """Match base Gemma 4 emission exactly: no spaces, lowercase enum, plain text."""
    return f"endConversation{{cravingScore:{craving_score},obstacleCategory:{obstacle_category}}}"


def transform_intermediate_check_in(row: dict[str, Any]) -> dict[str, Any]:
    output = row["output"]
    reply = output["reply"]
    messages = row["messages"]
    assert len(messages) == 3, f"row {row.get('id')}: intermediate check_in must have 3 messages"
    messages = rewrite_system_prompt(messages)
    new_user = rewrite_task_block(messages[1]["content"], str(row.get("id")))
    new_messages = [
        messages[0],
        {**messages[1], "content": new_user},
        {"role": "assistant", "content": reply},
    ]
    return {**row, "messages": new_messages}


def transform_ending_check_in(row: dict[str, Any]) -> dict[str, Any]:
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

    tool_call_line = format_tool_call_line(craving_score, obstacle_category)
    assistant_content = f"{tool_call_line}\n{reply}"

    new_messages = [
        messages[0],
        {**messages[1], "content": new_user},
        {"role": "assistant", "content": assistant_content},
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
        for line in src:
            line = line.rstrip("\n")
            if not line:
                continue
            row = json.loads(line)
            surface = row["input"]["surface"]
            surface_counts[surface] += 1

            if surface != "check_in":
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

    print("=== transform_to_native_tools_v6.py summary ===")
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
            sys_content = msgs[0].get("content", "")
            if "Return only strict JSON" not in sys_content:
                failures.append(f"row {rid}: passthrough surface={surface} missing JSON instruction in system")
            continue

        sys_content = msgs[0].get("content", "")
        if "Return only strict JSON" in sys_content:
            failures.append(f"row {rid}: check_in system still contains 'Return only strict JSON'")
        if "endConversation tool" not in sys_content:
            failures.append(f"row {rid}: check_in system missing tool-call instruction")
        if "Do not output JSON" not in sys_content:
            failures.append(f"row {rid}: check_in system missing 'Do not output JSON' negative constraint")

        user_content = msgs[1]["content"]
        if "Return strict JSON" in user_content:
            failures.append(f"row {rid}: check_in user contains 'Return strict JSON'")
        if "Otherwise just respond." not in user_content:
            failures.append(f"row {rid}: check_in user missing 'Otherwise just respond.'")

        if len(msgs) != 3:
            failures.append(f"row {rid}: check_in must have 3 messages (got {len(msgs)})")
            continue

        asst = msgs[2]
        if asst.get("role") != "assistant":
            failures.append(f"row {rid}: msg[2] role != assistant")
            continue
        if "tool_calls" in asst:
            failures.append(f"row {rid}: assistant must not have tool_calls (v6 is plain text)")
        content = asst.get("content") or ""

        end_conv = row["output"].get("endConversation")
        if end_conv is None:
            # Intermediate: must NOT contain a tool-call line.
            if content.startswith("endConversation{"):
                failures.append(f"row {rid}: intermediate assistant starts with endConversation{{ (should be plain reply)")
            if content != row["output"]["reply"]:
                failures.append(f"row {rid}: intermediate assistant content != output.reply")
        else:
            # Ending: first line must match the tool-call regex, rest is closing speech.
            lines = content.split("\n", 1)
            if len(lines) != 2:
                failures.append(f"row {rid}: ending assistant content missing newline split (got {len(lines)} lines)")
                continue
            tool_line, closing = lines
            m = TOOL_CALL_LINE_RE.match(tool_line)
            if not m:
                failures.append(f"row {rid}: ending tool-call line {tool_line!r} doesn't match regex")
                continue
            if int(m.group("score")) != end_conv["cravingScore"]:
                failures.append(f"row {rid}: cravingScore in line {m.group('score')} != source {end_conv['cravingScore']}")
            if m.group("cat") != end_conv["obstacleCategory"]:
                failures.append(f"row {rid}: obstacleCategory in line {m.group('cat')} != source {end_conv['obstacleCategory']}")
            if closing != row["output"]["reply"]:
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
