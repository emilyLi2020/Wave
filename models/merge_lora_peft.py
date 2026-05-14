"""Mac-compatible LoRA merge via PEFT (no unsloth dependency).

We have evidence that the unsloth-merged checkpoint at
Maelstrome/lora-wave-session-r32-merged produces 100% <pad> tokens in plain
PyTorch inference. This script re-merges the LoRA adapter
(Maelstrome/lora-wave-session-r32) onto the base model
(unsloth/gemma-4-E2B-it) using only HF transformers + PEFT, which run cleanly
on darwin.

After saving, the diagnostic (models/diagnose_merged_base.py --source-repo <out-dir>)
should be re-run to confirm coherent generation before pushing or converting.

Usage:
  uv run --project models python models/merge_lora_peft.py \\
    --base unsloth/gemma-4-E2B-it \\
    --adapter Maelstrome/lora-wave-session-r32 \\
    --out-dir models/runs/merge-peft
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, type=str,
                        help="HF repo id of the base (multimodal) model")
    parser.add_argument("--adapter", required=True, type=str,
                        help="HF repo id of the LoRA adapter")
    parser.add_argument("--out-dir", required=True, type=Path,
                        help="Local output directory for the merged model")
    parser.add_argument("--device", type=str, default="cpu",
                        help="cpu | cuda | mps  (mps may OOM on 16 GB)")
    parser.add_argument("--dtype", type=str, default="bfloat16",
                        help="bfloat16 | float16 | float32")
    parser.add_argument("--cache-dir", type=Path, default=None)
    args = parser.parse_args()

    out_dir: Path = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"base    : {args.base}", flush=True)
    print(f"adapter : {args.adapter}", flush=True)
    print(f"out     : {out_dir}", flush=True)
    print(f"device  : {args.device}", flush=True)
    print(f"dtype   : {args.dtype}", flush=True)

    print("\nImporting torch + transformers + peft...", flush=True)
    import torch
    from transformers import AutoTokenizer
    from peft import PeftModel

    dtype = {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "float32": torch.float32,
    }[args.dtype]

    print(f"\nLoading base model {args.base}...", flush=True)
    t0 = time.time()
    base_model = _load_base(args.base, dtype, args.device, args.cache_dir)
    print(f"  loaded in {time.time() - t0:.1f}s", flush=True)

    print(f"\nLoading + applying LoRA adapter {args.adapter}...", flush=True)
    t0 = time.time()
    peft_model = PeftModel.from_pretrained(
        base_model,
        args.adapter,
        cache_dir=str(args.cache_dir) if args.cache_dir else None,
    )
    print(f"  loaded in {time.time() - t0:.1f}s", flush=True)

    print("\nMerging adapter into base weights...", flush=True)
    t0 = time.time()
    merged = peft_model.merge_and_unload()
    print(f"  merged in {time.time() - t0:.1f}s", flush=True)

    print(f"\nSaving merged model to {out_dir}...", flush=True)
    t0 = time.time()
    merged.save_pretrained(
        str(out_dir),
        safe_serialization=True,
        max_shard_size="5GB",
    )
    print(f"  saved in {time.time() - t0:.1f}s", flush=True)

    print("\nCopying tokenizer + processor + chat template...", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(
        args.adapter,
        cache_dir=str(args.cache_dir) if args.cache_dir else None,
    )
    tokenizer.save_pretrained(str(out_dir))

    _copy_runtime_files(args.adapter, args.cache_dir, out_dir)

    manifest = {
        "baseModel": args.base,
        "adapter": args.adapter,
        "outDir": str(out_dir),
        "dtype": args.dtype,
        "device": args.device,
        "mergeMethod": "peft.merge_and_unload",
    }
    (out_dir / "merge-manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nWrote {out_dir / 'merge-manifest.json'}")
    print("Done. Next: run models/diagnose_merged_base.py --source-repo <out-dir>")


def _load_base(repo: str, dtype, device: str, cache_dir):
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
            print(f"  trying {cls_name}...", flush=True)
            return Cls.from_pretrained(
                repo,
                torch_dtype=dtype,
                device_map=device,
                cache_dir=str(cache_dir) if cache_dir else None,
                low_cpu_mem_usage=True,
            )
        except Exception as e:  # noqa: BLE001
            print(f"  {cls_name} failed: {type(e).__name__}: {e}", flush=True)
            last_err = e
    raise RuntimeError(f"All load paths failed; last error: {last_err}")


def _copy_runtime_files(adapter_repo: str, cache_dir, out_dir: Path) -> None:
    """Pull processor_config.json and chat_template.jinja from the adapter repo into out_dir."""
    from huggingface_hub import hf_hub_download

    for fname in ("chat_template.jinja", "processor_config.json"):
        try:
            src = hf_hub_download(
                repo_id=adapter_repo,
                filename=fname,
                cache_dir=str(cache_dir) if cache_dir else None,
            )
            shutil.copy2(src, out_dir / fname)
            print(f"  copied {fname}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"  skipped {fname}: {type(e).__name__}: {e}", flush=True)


if __name__ == "__main__":
    main()
