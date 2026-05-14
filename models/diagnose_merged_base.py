"""Smoke-test a merged-16bit Gemma 4 E2B checkpoint in plain PyTorch.

Goal: rule out the merged-base itself before sinking more time into ONNX/MLC
conversion. If this script produces coherent text, any downstream failure is
purely a conversion bug. If this prints garbage or pad-only output, the merge
itself is broken and we need to re-merge the LoRA adapter.

Usage:
  uv run --project models python models/diagnose_merged_base.py \\
    --source-repo Maelstrome/lora-wave-session-r32-merged \\
    --prompts "I'm feeling anxious right now. What's one small thing I can do?" \\
              "What is the capital of France? Answer in one sentence."
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _load(repo: str, dtype, device_map, cache_dir):
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(repo, cache_dir=cache_dir)

    last_err = None
    for cls_name in (
        "AutoModelForCausalLM",
        "AutoModelForImageTextToText",
        "Gemma4ForConditionalGeneration",
    ):
        try:
            if cls_name == "AutoModelForCausalLM":
                from transformers import AutoModelForCausalLM as Cls  # type: ignore
            elif cls_name == "AutoModelForImageTextToText":
                from transformers import AutoModelForImageTextToText as Cls  # type: ignore
            else:
                from transformers import Gemma4ForConditionalGeneration as Cls  # type: ignore
            print(f"Trying {cls_name}...", flush=True)
            model = Cls.from_pretrained(
                repo,
                torch_dtype=dtype,
                device_map=device_map,
                cache_dir=cache_dir,
            )
            print(f"Loaded via {cls_name}", flush=True)
            return model, tokenizer
        except Exception as e:  # noqa: BLE001
            print(f"{cls_name} failed: {type(e).__name__}: {e}", flush=True)
            last_err = e
    raise RuntimeError(f"All load paths failed; last error: {last_err}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", required=True, type=str,
                        help="HF repo id or local path to the merged checkpoint")
    parser.add_argument("--prompts", nargs="+", required=True, type=str)
    parser.add_argument("--max-new-tokens", type=int, default=80)
    parser.add_argument("--cache-dir", type=Path, default=None)
    parser.add_argument("--device", type=str, default="auto",
                        help="auto | cpu | mps | cuda")
    parser.add_argument("--dtype", type=str, default="bfloat16",
                        help="bfloat16 | float16 | float32")
    args = parser.parse_args()

    print("Importing torch + transformers...", flush=True)
    import torch

    if args.device == "auto":
        if torch.cuda.is_available():
            device_map = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            device_map = "mps"
        else:
            device_map = "cpu"
    else:
        device_map = args.device

    dtype = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}[args.dtype]
    print(f"device_map={device_map}, dtype={dtype}", flush=True)

    print(f"\nLoading {args.source_repo} (10+ GB; first time pulls from HF)...", flush=True)
    model, tokenizer = _load(args.source_repo, dtype, device_map, args.cache_dir)
    model.eval()
    print("Model loaded.\n", flush=True)

    pad_id = tokenizer.pad_token_id

    n_pass = 0
    for prompt in args.prompts:
        print(f"=== PROMPT: {prompt}", flush=True)
        messages = [{"role": "user", "content": prompt}]
        chat = tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=False
        )
        inputs = tokenizer(chat, return_tensors="pt").to(model.device)
        with torch.inference_mode():
            out = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
            )
        gen_ids = out[0, inputs.input_ids.shape[1]:]
        text_raw = tokenizer.decode(gen_ids, skip_special_tokens=False)
        text_clean = tokenizer.decode(gen_ids, skip_special_tokens=True)
        total = int(gen_ids.numel())
        pad_count = int((gen_ids == pad_id).sum().item()) if pad_id is not None else 0
        pad_ratio = pad_count / max(total, 1)
        coherent = pad_ratio < 0.5 and any(c.isalpha() for c in text_clean)
        if coherent:
            n_pass += 1
        print(f"  pad ratio: {pad_count}/{total} = {pad_ratio:.0%}", flush=True)
        print(f"  raw    : {text_raw[:240]}", flush=True)
        print(f"  cleaned: {text_clean[:240]}\n", flush=True)

    print(f"\n=== Verdict: {n_pass}/{len(args.prompts)} prompts produced coherent text.", flush=True)
    if n_pass == 0:
        print("FAIL: merged-base appears broken. Re-merging the LoRA is the next step.", flush=True)
        sys.exit(2)
    print("PASS: merged-base generates coherent text. Conversion pipeline is the issue, not the weights.", flush=True)


if __name__ == "__main__":
    main()
