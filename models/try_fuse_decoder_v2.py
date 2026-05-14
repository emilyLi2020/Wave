"""Attempt #2: run optimize_model with opt_level=2 + try to bypass the
shape-inference assertion that's blocking fusion.

The previous run got 'failed in shape inference <class AssertionError>'
which short-circuits the fusion pipeline. Common cause: dynamic dims that
violate ORT's symbolic shape-inference assumptions.
"""
from __future__ import annotations

import sys
import time
from collections import Counter
from pathlib import Path

import onnx
from onnxruntime.transformers.fusion_options import FusionOptions
from onnxruntime.transformers.optimizer import optimize_model

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC = REPO_ROOT / "models" / "runs" / "onnx-export-v3" / "onnx" / "decoder_model_merged_q4f16.onnx"
OUT_DIR = REPO_ROOT / "models" / "runs" / "onnx-fuse-trials"
OUT_DIR.mkdir(parents=True, exist_ok=True)

TARGETS = ["SimplifiedLayerNormalization", "Gelu", "RotaryEmbedding", "GroupQueryAttention"]


def count_ops(path: Path) -> Counter:
    m = onnx.load(str(path), load_external_data=False)
    return Counter(n.op_type for n in m.graph.node)


def try_variant(label: str, **kwargs) -> Path | None:
    out_path = OUT_DIR / f"decoder_fused_{label}.onnx"
    print(f"\n--- {label}: {kwargs} ---", flush=True)
    try:
        t0 = time.time()
        m = optimize_model(str(SRC), **kwargs)
        elapsed = time.time() - t0
        location = out_path.stem + ".onnx_data"
        m.save_model_to_file(
            str(out_path),
            use_external_data_format=True,
            all_tensors_to_one_file=True,
        )
        print(f"  ran in {elapsed:.1f}s; wrote {out_path}", flush=True)
        return out_path
    except Exception as err:
        print(f"  FAILED: {err!r}", flush=True)
        return None


def main() -> None:
    base = count_ops(SRC)
    print(f"baseline: total={sum(base.values())}", flush=True)
    for t in TARGETS:
        print(f"  baseline {t}={base.get(t, 0)}", flush=True)

    # Build aggressive fusion options
    opts = FusionOptions("gpt2")
    # Enable everything that exists on the object
    for attr in dir(opts):
        if attr.startswith("enable_"):
            try:
                setattr(opts, attr, True)
            except Exception:
                pass

    runs = [
        ("gpt2_optL1", dict(model_type="gpt2", num_heads=8, hidden_size=1536, optimization_options=opts, opt_level=1)),
        ("gpt2_optL2", dict(model_type="gpt2", num_heads=8, hidden_size=1536, optimization_options=opts, opt_level=2)),
        ("gpt2_optL99", dict(model_type="gpt2", num_heads=8, hidden_size=1536, optimization_options=opts, opt_level=99)),
        ("phi_safe", dict(model_type="phi", num_heads=8, hidden_size=1536, opt_level=2)),
    ]

    for label, kwargs in runs:
        p = try_variant(label, **kwargs)
        if p is None:
            continue
        counts = count_ops(p)
        delta = sum(counts.values()) - sum(base.values())
        print(f"  {label}: total={sum(counts.values())} (delta {delta:+d})", flush=True)
        for t in TARGETS:
            got = counts.get(t, 0)
            mark = "OK" if got > 0 else "  "
            print(f"    {mark} {t}={got}", flush=True)
        for p_name in ("Pow", "ReduceMean", "Tanh"):
            print(f"      primitive {p_name}: {counts.get(p_name, 0)} (was {base.get(p_name, 0)})", flush=True)


if __name__ == "__main__":
    main()
