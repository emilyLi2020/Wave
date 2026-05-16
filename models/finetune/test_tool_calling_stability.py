"""Gate 6 — stability of native tool-call emission across N ending check_in rows.

The single-prompt `test_tool_calling.py` only tells us the model emits the
tool on ONE READY_HISTORY context. Gate 6 in the v4 plan says we need
>= 8/10 success across 10 ending check_in rows from the test split. This
script iterates the test rows, builds the prompt with the same chat-template
path as the trainer (incl. `tools=`), generates with do_sample=False, and
counts how many start with the `<|tool_call>` token id (48).

Usage:
    uv run python finetune/test_tool_calling_stability.py \
        --source-repo runs/merge-toolcall-v4 \
        --test-jsonl runs/lora-wave-session-toolcall-v4/<TIMESTAMP>/test.jsonl \
        --n 10
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from train_wave_session_lora import (
    Example,
    build_prompt_messages,
    render_chat_text,
    tools_for_example,
)

TOOL_CALL_OPEN_ID = 48   # <|tool_call>
TOOL_CALL_CLOSE_ID = 49  # <tool_call|>


def load_ending_check_in_rows(path: Path) -> list[Example]:
    out: list[Example] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            if row.get("surface") != "check_in":
                continue
            if not (row.get("output_payload") or {}).get("endConversation"):
                continue
            out.append(Example(
                example_id=row["example_id"],
                surface=row["surface"],
                prompt=row["prompt"],
                output_payload=row["output_payload"],
                metadata=row["metadata"],
                messages=row["messages"],
                split_key=row["split_key"],
            ))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", required=True, type=str)
    parser.add_argument("--test-jsonl", required=True, type=Path)
    parser.add_argument("--n", type=int, default=10,
                        help="Number of ending check_in rows to probe (default 10).")
    parser.add_argument("--max-new-tokens", type=int, default=200)
    parser.add_argument("--device", type=str, default="cuda")
    args = parser.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    pool = load_ending_check_in_rows(args.test_jsonl)
    print(f"Loaded {len(pool)} ending check_in rows from test split")
    sample = pool[:args.n]
    if len(sample) < args.n:
        print(f"WARN: only {len(sample)} rows available (asked for {args.n})")

    processor = AutoProcessor.from_pretrained(args.source_repo)
    tokenizer = processor.tokenizer
    model = AutoModelForCausalLM.from_pretrained(
        args.source_repo, torch_dtype=torch.bfloat16, device_map=args.device,
    )
    model.eval()

    pass_count = 0
    details: list[dict] = []
    for ex in sample:
        prompt_text = render_chat_text(
            tokenizer, build_prompt_messages(ex),
            add_generation_prompt=True,
            tools=tools_for_example(ex),
        ).removeprefix("<bos>")
        inputs = tokenizer(prompt_text, return_tensors="pt", add_special_tokens=False).to(model.device)
        with torch.inference_mode():
            out = model.generate(
                **inputs, max_new_tokens=args.max_new_tokens,
                do_sample=False, temperature=None, top_p=None,
            )
        new_tokens = out[0, inputs.input_ids.shape[1]:].tolist()
        # First *generated* token. Some models prepend whitespace; we also
        # accept tool_call after a leading newline/whitespace token.
        first_real = None
        for t in new_tokens[:5]:
            piece = tokenizer.convert_ids_to_tokens(t)
            if piece and piece.strip():
                first_real = (t, piece)
                break
        tool_emitted = TOOL_CALL_OPEN_ID in new_tokens[:10]
        is_first = first_real and first_real[0] == TOOL_CALL_OPEN_ID
        passed = bool(is_first)
        pass_count += int(passed)
        details.append({
            "id": ex.example_id,
            "first_real_token": first_real[1] if first_real else None,
            "first_real_id": first_real[0] if first_real else None,
            "tool_call_in_first_10": tool_emitted,
            "passed": passed,
            "preview": tokenizer.decode(new_tokens[:30], skip_special_tokens=False),
        })

    print("\n" + "=" * 60)
    print("STABILITY PROBE")
    print("=" * 60)
    n = len(sample)
    for d in details:
        mark = "PASS" if d["passed"] else ("(tool emitted, not first)" if d["tool_call_in_first_10"] else "FAIL")
        print(f"  {d['id'][:8]}  first={d['first_real_token']!r:<20}  {mark}")
        if not d["passed"]:
            print(f"    preview: {d['preview']!r}")
    rate = pass_count / n if n else 0.0
    print()
    print(f"VERDICT: {pass_count}/{n} = {100*rate:.0f}% emit <|tool_call> as first token")
    print(f"Gate 6 target: >= 8/10 = 80%")
    print(f"Gate 6: {'PASS' if rate >= 0.8 else 'FAIL'}")


if __name__ == "__main__":
    main()
