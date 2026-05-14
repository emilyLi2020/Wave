"""Run onnxruntime.transformers.optimize_model on our v3 decoder to see what
fusions land. Tries gpt2 + phi + bert model_types and reports node counts +
fused contrib ops vs upstream's reference.

Saves the fused output to a sibling path so we can quantize/test/keep it.

Usage:
  python try_fuse_decoder.py
"""
from __future__ import annotations

import shutil
import sys
import time
from collections import Counter
from pathlib import Path

import onnx
from onnxruntime.transformers.fusion_options import FusionOptions
from onnxruntime.transformers.optimizer import optimize_model

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "models" / "runs" / "onnx-export-v3" / "onnx"
SRC_DECODER = SRC_DIR / "decoder_model_merged_q4f16.onnx"
WORK_DIR = REPO_ROOT / "models" / "runs" / "onnx-fuse-trials"
WORK_DIR.mkdir(parents=True, exist_ok=True)

TARGET_OP_COUNTS = {
    "SimplifiedLayerNormalization": 242,
    "Gelu": 70,
    "RotaryEmbedding": 50,
    "GroupQueryAttention": 12,
}


def count_ops(path: Path) -> Counter:
    m = onnx.load(str(path), load_external_data=False)
    return Counter(n.op_type for n in m.graph.node)


def report(label: str, counts: Counter, baseline: Counter | None = None) -> None:
    total = sum(counts.values())
    print(f"\n=== {label} (total nodes={total}) ===", flush=True)
    if baseline is not None:
        delta = total - sum(baseline.values())
        print(f"  delta vs baseline: {delta:+d}", flush=True)
    print(f"  target contrib ops:", flush=True)
    for op, target in TARGET_OP_COUNTS.items():
        got = counts.get(op, 0)
        mark = "OK" if got == target else "  "
        print(f"    {mark}  {op:<35} got={got:<4} target={target}", flush=True)
    print(f"  primitive ops we want to see DROP:", flush=True)
    for op in ("Pow", "ReduceMean", "Tanh"):
        before = baseline.get(op, 0) if baseline else None
        got = counts.get(op, 0)
        if baseline:
            print(f"    {op:<15} got={got:<4} (was {before})", flush=True)
        else:
            print(f"    {op:<15} got={got:<4}", flush=True)


def try_fuse(model_type: str, num_heads: int, hidden_size: int) -> Path | None:
    label = f"{model_type}_h{num_heads}_d{hidden_size}"
    out_path = WORK_DIR / f"decoder_fused_{label}.onnx"
    print(f"\n--- attempting fusion: model_type={model_type!r} num_heads={num_heads} hidden_size={hidden_size} ---", flush=True)
    try:
        t0 = time.time()
        # Use file path to avoid loading all external data into memory
        opts = FusionOptions(model_type)
        optimized = optimize_model(
            str(SRC_DECODER),
            model_type=model_type,
            num_heads=num_heads,
            hidden_size=hidden_size,
            optimization_options=opts,
            opt_level=0,  # skip ORT graph optimizations; we just want fusion
            use_gpu=False,
            only_onnxruntime=False,
        )
        elapsed = time.time() - t0
        print(f"  fusion ran in {elapsed:.1f}s", flush=True)
        # Save with external data
        location = out_path.stem + ".onnx_data"
        optimized.save_model_to_file(
            str(out_path),
            use_external_data_format=True,
            all_tensors_to_one_file=True,
        )
        print(f"  wrote {out_path}", flush=True)
        return out_path
    except Exception as err:
        print(f"  FAILED: {err!r}", flush=True)
        return None


def main() -> None:
    if not SRC_DECODER.exists():
        sys.exit(f"missing source decoder: {SRC_DECODER}")

    print(f"Source: {SRC_DECODER}", flush=True)
    baseline = count_ops(SRC_DECODER)
    report("baseline (v3 decoder, decomposed)", baseline)

    # Gemma 4 E2B text config:
    #   hidden_size: 1536
    #   num_attention_heads: 8
    #   num_key_value_heads: 1
    #   head_dim: 256 (sliding) / 512 (full)
    # ORT optimizer typically wants num_heads + hidden_size as hints.
    candidates = [
        ("gpt2", 8, 1536),
        ("phi", 8, 1536),
        ("bert", 8, 1536),
        ("qwen3", 8, 1536),
        ("gpt_neox", 8, 1536),
    ]

    results: list[tuple[str, Path | None]] = []
    for mt, nh, hs in candidates:
        out = try_fuse(mt, nh, hs)
        results.append((f"{mt}_h{nh}_d{hs}", out))

    print("\n\n========== SUMMARY ==========", flush=True)
    for label, p in results:
        if p is None:
            print(f"\n{label}: FAILED", flush=True)
            continue
        counts = count_ops(p)
        report(label, counts, baseline)


if __name__ == "__main__":
    main()
