"""Regression probe for phase_narration + reflection surfaces.

After v4 training, the merged model must NOT regress on non-tool-call surfaces.
This script loads N rows of each surface from the test split, generates a
response, and scores it against the validators already used by
train_wave_session_lora.py's eval path.

Pass criterion: JSON-validity pass rate for each surface must be within 10%
of the production-LoRA baseline. (The trainer's `--final-eval-mode generation`
already does this on a real-eval path; this script is a fast standalone probe
for v4 smoke + final verification.)

Usage:
    uv run python finetune/test_regression_phase_reflection.py \
        --source-repo runs/merge-toolcall-v4 \
        --test-jsonl runs/lora-wave-session-toolcall-v4/<TIMESTAMP>/test.jsonl \
        --per-surface 10
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# We reuse the trainer's validators so the bar is consistent with the
# production eval path.
sys.path.insert(0, str(Path(__file__).parent))
from train_wave_session_lora import (
    Example,
    build_prompt_messages,
    render_chat_text,
    tools_for_example,
    validate_phase_output,
    validate_reflection_output,
)


def load_examples_from_test_jsonl(path: Path) -> list[Example]:
    examples: list[Example] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            examples.append(Example(
                example_id=row["example_id"],
                surface=row["surface"],
                prompt=row["prompt"],
                output_payload=row["output_payload"],
                metadata=row["metadata"],
                messages=row["messages"],
                split_key=row["split_key"],
            ))
    return examples


def parse_json_safe(text: str) -> dict[str, Any] | None:
    # Extract the first balanced JSON object from text; tolerant to trailing
    # tokens like <turn|>.
    if not text:
        return None
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if esc:
            esc = False
            continue
        if ch == "\\":
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except Exception:
                    return None
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", required=True, type=str,
                        help="Path or HF id of the merged model.")
    parser.add_argument("--test-jsonl", required=True, type=Path,
                        help="test.jsonl from a training run (post-normalize format).")
    parser.add_argument("--per-surface", type=int, default=10,
                        help="Number of rows per surface to probe (default 10).")
    parser.add_argument("--max-new-tokens", type=int, default=420)
    parser.add_argument("--device", type=str, default="cuda")
    args = parser.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    examples = load_examples_from_test_jsonl(args.test_jsonl)
    by_surface: dict[str, list[Example]] = {}
    for ex in examples:
        by_surface.setdefault(ex.surface, []).append(ex)

    print(f"Loaded {len(examples)} test examples")
    for surface, rows in by_surface.items():
        print(f"  {surface:<18}: {len(rows)}")
    print()

    processor = AutoProcessor.from_pretrained(args.source_repo)
    tokenizer = processor.tokenizer
    model = AutoModelForCausalLM.from_pretrained(
        args.source_repo,
        torch_dtype=torch.bfloat16,
        device_map=args.device,
    )
    model.eval()

    results: dict[str, dict[str, Any]] = {}
    for surface in ("phase_narration", "reflection"):
        pool = by_surface.get(surface, [])
        if not pool:
            print(f"WARN: no {surface} rows in test split; skipping")
            continue
        sample = pool[:args.per_surface]
        json_valid = 0
        schema_pass = 0
        details: list[dict[str, Any]] = []
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
            new_tokens = out[0, inputs.input_ids.shape[1]:]
            text = tokenizer.decode(new_tokens, skip_special_tokens=True)
            parsed = parse_json_safe(text)
            is_json_valid = parsed is not None
            if is_json_valid:
                json_valid += 1
                if surface == "phase_narration":
                    errs = validate_phase_output(parsed)
                else:
                    errs = validate_reflection_output(parsed)
                if not errs:
                    schema_pass += 1
                details.append({"id": ex.example_id, "json_valid": True, "schema_pass": not errs, "errors": errs[:3]})
            else:
                details.append({"id": ex.example_id, "json_valid": False, "first_120_chars": text[:120]})
        n = len(sample)
        results[surface] = {
            "n": n,
            "json_valid_rate": json_valid / n,
            "schema_pass_rate": schema_pass / n,
            "details": details,
        }
        print(f"=== {surface} ===")
        print(f"  n={n}  json_valid={json_valid}/{n}={100*json_valid/n:.0f}%  schema_pass={schema_pass}/{n}={100*schema_pass/n:.0f}%")
        # Show first few failures (if any) for triage.
        fails = [d for d in details if not (d.get("json_valid") and d.get("schema_pass"))]
        if fails:
            print(f"  failures ({len(fails)}):")
            for f in fails[:3]:
                print(f"    {f}")
        print()

    # Final verdict — for v4 smoke, the *direction* matters more than absolute numbers
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for surface, r in results.items():
        print(f"  {surface:<18}: json={100*r['json_valid_rate']:.0f}%  schema={100*r['schema_pass_rate']:.0f}%")


if __name__ == "__main__":
    main()
