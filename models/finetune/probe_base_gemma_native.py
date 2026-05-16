"""Probe base Gemma 4 E2B-it: log every token it emits on a v5-format ending
check_in prompt. Goal is to capture the EXACT native shape so v6 training
data can match it byte-for-byte (instead of designing the protocol from
first principles).

Setup:
* Base model only — no LoRA.
* Loads a real ending check_in row from the v5 dataset (system + user with
  rewritten task block). Does NOT use the test_tool_calling.py READY_HISTORY
  hand-crafted prompt — we want the natural training-distribution input.
* Renders via processor.apply_chat_template(messages[:2], tools=...,
  add_generation_prompt=True). Bypasses train_wave_session_lora.build_prompt_messages
  which has the harness bug.
* Generates up to 600 new tokens, do_sample=False. Does NOT pass
  StoppingCriteria — we want to see whether the base model naturally
  stops at <turn|> after the tool call or keeps going (self-emits a
  <|tool_response>, hallucinates closing speech, etc.).

Output: token-by-token table with id, raw piece (special-token literal if
applicable), and a running decoded view. Also prints the special-token
ID map up front so the reader can decode the dump quickly.

Run on B200:
  cd /workspace/wave/models
  uv run python finetune/probe_base_gemma_native.py \
      --dataset datasets/lora-wave-session-toolcall-v5.jsonl \
      --row-index 0 \
      --max-new-tokens 600 \
      --num-rows 3
"""

from __future__ import annotations

import argparse
import json
import sys
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
                        "none",
                        "cannot_visualize",
                        "mind_wandering",
                        "urge_overwhelming",
                        "breath_tight",
                        "breath_anxiety",
                        "gave_in",
                        "guilt_failure",
                        "physical_discomfort",
                        "sleepiness",
                    ],
                },
            },
        },
    },
}

# Native-vocab special tokens we want to highlight in the dump.
SPECIAL_LABELS = {
    48: "<|tool_call>",
    49: "<tool_call|>",
    50: "<|tool_response>",
    51: "<tool_response|>",
    52: '<|"|>',
}


def load_ending_check_in_rows(path: Path, limit: int) -> list[dict]:
    """Dedupe by row id — the v5 dataset upweights ending rows ×3."""
    out: list[dict] = []
    seen: set[str] = set()
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            row = json.loads(line)
            if row.get("input", {}).get("surface") != "check_in":
                continue
            if not (row.get("output") or {}).get("endConversation"):
                continue
            rid = str(row.get("id"))
            if rid in seen:
                continue
            seen.add(rid)
            out.append(row)
            if len(out) >= limit:
                break
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", default="unsloth/gemma-4-E2B-it")
    parser.add_argument("--dataset", type=Path, required=True,
                        help="Path to v5 dataset jsonl")
    parser.add_argument("--num-rows", type=int, default=3,
                        help="How many distinct ending check_in rows to probe")
    parser.add_argument("--max-new-tokens", type=int, default=600)
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()

    rows = load_ending_check_in_rows(args.dataset, args.num_rows)
    print(f"Loaded {len(rows)} ending check_in rows (need {args.num_rows})", flush=True)
    if not rows:
        sys.exit("No ending check_in rows found in dataset.")

    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    print(f"Loading {args.source_repo} (bf16, no LoRA)...", flush=True)
    processor = AutoProcessor.from_pretrained(args.source_repo)
    tokenizer = processor.tokenizer
    model = AutoModelForCausalLM.from_pretrained(
        args.source_repo, torch_dtype=torch.bfloat16, device_map=args.device,
    )
    model.eval()

    # Print special-token id map and label any we know about.
    print("\n=== Special token id map (relevant tokens) ===", flush=True)
    for tid, label in SPECIAL_LABELS.items():
        piece = tokenizer.convert_ids_to_tokens(tid)
        print(f"  id={tid:>3}  expected={label!r:<22}  piece={piece!r}", flush=True)
    # Also: tokenizer's own specials (BOS / EOS / turn markers).
    for name in ("bos_token", "eos_token", "pad_token", "unk_token"):
        tok = getattr(tokenizer, name, None)
        if tok is not None:
            tid = tokenizer.convert_tokens_to_ids(tok)
            print(f"  {name}={tok!r}  id={tid}", flush=True)
    # Probe a few likely turn-marker token strings.
    for s in ("<turn|>", "<|turn>", "<end_of_turn>", "<eos>"):
        tid = tokenizer.convert_tokens_to_ids(s)
        if tid is not None and tid != tokenizer.unk_token_id:
            print(f"  literal {s!r}  id={tid}", flush=True)

    for row_idx, row in enumerate(rows):
        messages = row["messages"][:2]  # system + user only (drop targets)
        print(f"\n\n{'=' * 70}", flush=True)
        print(f"ROW {row_idx}  id={row.get('id')!r}", flush=True)
        print(f"{'=' * 70}", flush=True)
        print(f"\n--- system (first 250) ---", flush=True)
        print(messages[0]["content"][:250], flush=True)
        print(f"\n--- user (last 600) ---", flush=True)
        print(messages[1]["content"][-600:], flush=True)
        print(f"\n--- expected (training target) ---", flush=True)
        for m in row["messages"][2:]:
            print(f"  {m['role']}: {json.dumps(m, ensure_ascii=False)[:300]}", flush=True)

        prompt_text = processor.apply_chat_template(
            messages,
            tools=[END_CONVERSATION_TOOL],
            add_generation_prompt=True,
            tokenize=False,
        )

        # Dump the FULL rendered prompt for row 0 so we can confirm
        # tools= injection. Subsequent rows: just the tail.
        if row_idx == 0:
            print(f"\n--- FULL rendered prompt ({len(prompt_text)} chars) ---", flush=True)
            print(prompt_text, flush=True)
            print(f"--- end full prompt ---", flush=True)
        else:
            print(f"\n--- rendered prompt tail (last 500 chars) ---", flush=True)
            print(prompt_text[-500:], flush=True)

        inputs = tokenizer(prompt_text, return_tensors="pt", add_special_tokens=False).to(model.device)
        with torch.inference_mode():
            outputs = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                temperature=None,
                top_p=None,
            )
        new_token_ids = outputs[0, inputs.input_ids.shape[1]:].tolist()

        print(f"\n--- TOKEN-BY-TOKEN ({len(new_token_ids)} tokens) ---", flush=True)
        print(f"{'idx':>4}  {'id':>6}  {'piece':<26}  {'decoded':<26}  cumulative_text", flush=True)
        cum_text = ""
        for i, tid in enumerate(new_token_ids):
            piece = tokenizer.convert_ids_to_tokens(tid)
            decoded = tokenizer.decode([tid], skip_special_tokens=False)
            cum_text += decoded
            label = SPECIAL_LABELS.get(tid, "")
            tag = f" <-- {label}" if label else ""
            piece_repr = repr(piece)[:24]
            dec_repr = repr(decoded)[:24]
            # Truncate cumulative to keep the line readable.
            cum_short = cum_text[-50:].replace("\n", "\\n")
            print(f"{i:>4}  {tid:>6}  {piece_repr:<26}  {dec_repr:<26}  ...{cum_short}{tag}", flush=True)

        print(f"\n--- RAW OUTPUT (specials preserved) ---", flush=True)
        print(tokenizer.decode(new_token_ids, skip_special_tokens=False), flush=True)
        print(f"\n--- CLEAN OUTPUT (specials stripped) ---", flush=True)
        print(tokenizer.decode(new_token_ids, skip_special_tokens=True), flush=True)

        # Quick stats: where does each special token appear?
        print(f"\n--- special-token occurrences ---", flush=True)
        for tid, label in SPECIAL_LABELS.items():
            positions = [i for i, t in enumerate(new_token_ids) if t == tid]
            print(f"  {label:<22} (id={tid}): positions={positions}", flush=True)
        eos_id = tokenizer.eos_token_id
        if eos_id is not None:
            positions = [i for i, t in enumerate(new_token_ids) if t == eos_id]
            print(f"  eos_token (id={eos_id}): positions={positions}", flush=True)


if __name__ == "__main__":
    main()
